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

// Envoi des alertes email — toutes les heures
cron.schedule('0 * * * *', () => sendSearchAlerts());
