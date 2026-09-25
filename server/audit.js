// Journal d'audit des actions administrateurs (table admin_logs).
// Ne bloque jamais l'action principale : les erreurs d'écriture sont silencieuses.
const { pool } = require('./db');

async function log(adminId, action, targetType, targetId, details = {}) {
  try {
    await pool.query(
      `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, action, targetType, targetId || null, JSON.stringify(details)]
    );
  } catch (_) { /* ne jamais bloquer l'action principale */ }
}

module.exports = { log };
