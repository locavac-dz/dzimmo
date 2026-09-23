const cron = require('node-cron');
const { pool } = require('./db');
const { sendSearchAlerts } = require('./alerts-job');
const { guard, alert } = require('./monitor');
const backup = require('./backup');
const { sendVisitReminders } = require('./visit-reminders');
const { sendPriceDropDigest } = require('./price-drop');

// Chaque tâche est entourée de guard() : une erreur est journalisée ET signalée par email (server/monitor.js, une alerte par heure
// et par tâche), au lieu de n'apparaître que dans des journaux que personne ne lit.

// Nettoyage quotidien des tokens expirés
cron.schedule('0 3 * * *', guard('nettoyage des tokens', async () => {
  const r = await pool.query(`DELETE FROM password_reset_tokens WHERE expires_at < NOW() RETURNING id`);
  if (r.rowCount > 0) console.log(`[cron] ${r.rowCount} token(s) expiré(s) supprimé(s).`);
}));

// Archivage des propriétés vendues/louées depuis plus de 6 mois
cron.schedule('0 4 * * 0', guard('archivage', async () => {
  const r = await pool.query(`
    UPDATE properties SET status = 'archived'
    WHERE status IN ('sold','rented')
      AND created_at < NOW() - INTERVAL '6 months'
      AND status != 'archived'
    RETURNING id
  `);
  if (r.rowCount > 0) console.log(`[cron] ${r.rowCount} annonce(s) archivée(s).`);
}));

// Reconfirmation des annonces : rappels aux annonceurs, retrait des annonces restées sans réponse (voir server/expiry.js)
cron.schedule('30 3 * * *', guard('expiration des annonces', async () => {
  const r = await require('./expiry').run();
  if (r.reminded || r.expired) console.log(`[cron] annonces : ${r.reminded} rappel(s), ${r.expired} retrait(s).`);
}));

// Newsletter : envoi par lots des campagnes en file (chaque minute ; réservation atomique, voir server/newsletter.js)
cron.schedule('* * * * *', guard('newsletter', async () => {
  const r = await require('./newsletter').sendDue();
  if (r.sent || r.failed) console.log(`[cron] newsletter : ${r.sent} envoyé(s), ${r.failed} échec(s).`);
}));

// Newsletter : inscriptions jamais confirmées, effacées après 7 jours
cron.schedule('45 3 * * *', guard('purge de la newsletter', async () => {
  const n = await require('./newsletter').purgeUnconfirmed();
  if (n) console.log(`[cron] newsletter : ${n} inscription(s) non confirmée(s) effacée(s).`);
}));

// Rappels de visite J-1 : visites confirmées prévues demain
cron.schedule('0 8 * * *', guard('rappels de visite', async () => {
  const n = await sendVisitReminders();
  if (n) console.log(`[cron] ${n} rappel(s) de visite envoyé(s).`);
}));

// Résumé quotidien des baisses de prix : un seul email par membre avec la liste de ses favoris en baisse
cron.schedule('0 18 * * *', guard('résumé baisses de prix', async () => {
  const n = await sendPriceDropDigest();
  if (n) console.log(`[cron] ${n} résumé(s) de baisse de prix envoyé(s).`);
}));

// Badge « Réactif » : mise à jour quotidienne — 80 % des demandes répondues en < 24 h sur 30 jours (min. 3)
cron.schedule('0 5 * * *', guard('badge réactif', async () => {
  const r = await pool.query(`
    UPDATE users u
       SET responsive = (
         SELECT COUNT(*) FILTER (WHERE cr.responded_at IS NOT NULL
                                    AND cr.responded_at - cr.created_at <= INTERVAL '24 hours')::float
              / NULLIF(COUNT(*), 0) >= 0.8
              AND COUNT(*) >= 3
           FROM contact_requests cr
           JOIN properties p ON p.id = cr.property_id
          WHERE p.owner_id = u.id
            AND cr.created_at >= NOW() - INTERVAL '30 days'
       )
     WHERE EXISTS (
       SELECT 1 FROM contact_requests cr2
       JOIN properties p2 ON p2.id = cr2.property_id
       WHERE p2.owner_id = u.id AND cr2.created_at >= NOW() - INTERVAL '30 days'
     )
    RETURNING id`);
  if (r.rowCount) console.log(`[cron] ${r.rowCount} badge(s) réactif mis à jour.`);
}));

// Bilan hebdomadaire : chaque lundi à 08:30 (après les rappels de visite, avant les alertes)
cron.schedule('30 8 * * 1', guard('bilan hebdomadaire', async () => {
  const n = await require('./weekly-digest').sendWeeklyDigest();
  if (n) console.log(`[cron] ${n} bilan(s) hebdomadaire(s) envoyé(s).`);
}));

// Envoi des alertes email — toutes les heures
cron.schedule('0 * * * *', guard('alertes de recherche', () => sendSearchAlerts()));

// Compteurs de limitation de débit : fenêtres terminées (server/rate-store.js)
cron.schedule('17 * * * *', guard('purge des compteurs', () => require('./rate-store').purge()));

// Sauvegardes de la base (server/backup.js) : actives en production, ou BACKUP_ENABLED=true
if (backup.enabled()) {
  // Chaque nuit : vidage, rotation des anciens fichiers
  cron.schedule('30 2 * * *', guard('sauvegarde', async () => {
    const r = await backup.backup();
    console.log(`[cron] sauvegarde ${r.file} (${Math.round(r.size / 1024)} Ko)${r.pruned.length ? `, ${r.pruned.length} ancienne(s) supprimée(s)` : ''}.`);
  }, 'backup'));
  // Chaque dimanche : la dernière sauvegarde se restaure-t-elle vraiment ?
  cron.schedule('30 5 * * 0', guard('test de restauration', async () => {
    const last = backup.list()[0];
    if (!last) throw new Error('aucune sauvegarde à vérifier');
    const v = await backup.verify(last.path);
    console.log(`[cron] test de restauration (${v.mode}) : ${last.file}, ${v.tables} tables.`);
  }, 'backup'));
  // Chaque matin : si la sauvegarde ne tourne plus (instance 0 arrêtée, cron bloqué), on le dit
  cron.schedule('30 6 * * *', guard('fraîcheur des sauvegardes', async () => {
    const problem = backup.staleProblem();
    if (problem) await alert('backup:stale', new Error(problem), 'sauvegarde');
  }, 'backup'));
}
