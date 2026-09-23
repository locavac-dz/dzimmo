// Bilan hebdomadaire des annonceurs : envoyé chaque lundi (cron.js 08:30) aux propriétaires ayant
// au moins 1 annonce active et une semaine d'activité (vues, demandes ou favoris > 0).
// Les annonceurs sans aucune activité la semaine écoulée ne reçoivent pas d'email.
const { pool } = require('./db');
const mailer   = require('./mailer');

const MAX_RECIPIENTS = 500;

async function sendWeeklyDigest() {
  const { rows: owners } = await pool.query(`
    SELECT u.id, u.name, u.email, u.lang
    FROM users u
    WHERE u.banned = false
      AND u.email_verified = true
      AND EXISTS (
        SELECT 1 FROM properties p WHERE p.owner_id = u.id AND p.status = 'active'
      )
    ORDER BY u.id
    LIMIT $1
  `, [MAX_RECIPIENTS]);

  let sent = 0;
  for (const owner of owners) {
    const [totalsRes, topRes] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(v.views), 0)::int   AS views_7d,
          COUNT(DISTINCT cr.id)::int        AS contacts_7d,
          COUNT(DISTINCT f.id)::int         AS fav_7d,
          COUNT(DISTINCT p.id)::int         AS active_count
        FROM properties p
        LEFT JOIN property_views_daily v ON v.property_id = p.id AND v.day >= CURRENT_DATE - 6
        LEFT JOIN contact_requests cr   ON cr.property_id = p.id AND cr.created_at >= CURRENT_DATE - 6
        LEFT JOIN favorites f           ON f.property_id  = p.id AND f.created_at  >= CURRENT_DATE - 6
        WHERE p.owner_id = $1 AND p.status = 'active'
      `, [owner.id]),
      pool.query(`
        SELECT p.id, p.title, COALESCE(SUM(v.views), 0)::int AS views_7d
        FROM properties p
        LEFT JOIN property_views_daily v ON v.property_id = p.id AND v.day >= CURRENT_DATE - 6
        WHERE p.owner_id = $1 AND p.status = 'active'
        GROUP BY p.id, p.title
        ORDER BY views_7d DESC
        LIMIT 3
      `, [owner.id]),
    ]);

    const totals = totalsRes.rows[0];
    if (!totals.views_7d && !totals.contacts_7d && !totals.fav_7d) continue;

    await mailer.mailWeeklyDigest({
      email: owner.email,
      name:  owner.name,
      lang:  owner.lang || 'fr',
      properties: topRes.rows,
      totals,
    });
    sent++;
  }
  return sent;
}

module.exports = { sendWeeklyDigest };
