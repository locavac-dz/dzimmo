const cron = require('node-cron');
const { pool } = require('./db');
const { sendSearchAlerts } = require('./alerts-job');

// Nettoyage quotidien des tokens expirés
cron.schedule('0 3 * * *', async () => {
  try {
    const r = await pool.query(`DELETE FROM password_reset_tokens WHERE expires_at < NOW() RETURNING id`);
    if (r.rowCount > 0) console.log(`[cron] ${r.rowCount} token(s) expiré(s) supprimé(s).`);
  } catch (e) {
    console.error('[cron] Erreur nettoyage tokens :', e.message);
  }
});

// Archivage des propriétés vendues/louées depuis plus de 6 mois
cron.schedule('0 4 * * 0', async () => {
  try {
    const r = await pool.query(`
      UPDATE properties SET status = 'archived'
      WHERE status IN ('sold','rented')
        AND created_at < NOW() - INTERVAL '6 months'
        AND status != 'archived'
      RETURNING id
    `);
    if (r.rowCount > 0) console.log(`[cron] ${r.rowCount} annonce(s) archivée(s).`);
  } catch (e) {
    console.error('[cron] Erreur archivage :', e.message);
  }
});

// Reconfirmation des annonces : rappels aux annonceurs, retrait des annonces restées sans réponse (voir server/expiry.js)
cron.schedule('30 3 * * *', async () => {
  try {
    const r = await require('./expiry').run();
    if (r.reminded || r.expired) console.log(`[cron] annonces : ${r.reminded} rappel(s), ${r.expired} retrait(s).`);
  } catch (e) {
    console.error('[cron] Erreur expiration des annonces :', e.message);
  }
});

// Newsletter : envoi par lots des campagnes en file (chaque minute ; réservation atomique, voir server/newsletter.js)
cron.schedule('* * * * *', async () => {
  try {
    const r = await require('./newsletter').sendDue();
    if (r.sent || r.failed) console.log(`[cron] newsletter : ${r.sent} envoyé(s), ${r.failed} échec(s).`);
  } catch (e) {
    console.error('[cron] Erreur envoi de la newsletter :', e.message);
  }
});

// Newsletter : inscriptions jamais confirmées, effacées après 7 jours
cron.schedule('45 3 * * *', async () => {
  try {
    const n = await require('./newsletter').purgeUnconfirmed();
    if (n) console.log(`[cron] newsletter : ${n} inscription(s) non confirmée(s) effacée(s).`);
  } catch (e) {
    console.error('[cron] Erreur purge de la newsletter :', e.message);
  }
});

// Envoi des alertes email — toutes les heures
cron.schedule('0 * * * *', () => sendSearchAlerts());

// Compteurs de limitation de débit : fenêtres terminées (server/rate-store.js)
cron.schedule('17 * * * *', async () => {
  try { await require('./rate-store').purge(); }
  catch (e) { console.error('[cron] Erreur purge des compteurs :', e.message); }
});
