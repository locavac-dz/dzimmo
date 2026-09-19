const cron = require('node-cron');
const { pool } = require('./db');
const mailer = require('./mailer');

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

// Envoi des alertes email — toutes les heures
cron.schedule('0 * * * *', async () => {
  try {
    const alerts = await pool.query(`
      SELECT sa.*, u.email, u.name
      FROM search_alerts sa
      JOIN users u ON u.id = sa.user_id
      WHERE u.banned = false
    `);
    let sent = 0;
    for (const alert of alerts.rows) {
      const conditions = ['p.status = $1', 'p.created_at > $2'];
      const params = ['active', alert.last_sent];
      let idx = 3;
      if (alert.wilaya)      { conditions.push(`p.wilaya = $${idx++}`);      params.push(alert.wilaya); }
      if (alert.mode)        { conditions.push(`p.mode = $${idx++}`);        params.push(alert.mode); }
      if (alert.type_bien)   { conditions.push(`p.type_bien = $${idx++}`);   params.push(alert.type_bien); }
      if (alert.min_price)   { conditions.push(`p.price >= $${idx++}`);      params.push(alert.min_price); }
      if (alert.max_price)   { conditions.push(`p.price <= $${idx++}`);      params.push(alert.max_price); }
      if (alert.min_surface) { conditions.push(`p.surface_m2 >= $${idx++}`); params.push(alert.min_surface); }

      const r = await pool.query(
        `SELECT p.id, p.title, p.price, p.wilaya FROM properties p
         WHERE ${conditions.join(' AND ')}
         ORDER BY p.created_at DESC LIMIT 10`,
        params
      );

      // Avancer la fenêtre dans tous les cas
      await pool.query('UPDATE search_alerts SET last_sent = NOW() WHERE id = $1', [alert.id]);

      if (r.rows.length > 0) {
        await mailer.mailSearchAlert({
          email: alert.email,
          name: alert.name,
          properties: r.rows,
          alertCriteria: alert,
        });
        sent++;
        console.log(`[cron] Alerte #${alert.id} → ${r.rows.length} annonce(s) → ${alert.email}`);
      }
    }
    if (sent > 0) console.log(`[cron] ${sent} alerte(s) email envoyée(s).`);
  } catch (e) {
    console.error('[cron] Erreur alertes email :', e.message);
  }
});
