// Rapport mensuel pour les administrateurs : envoyé le 1er de chaque mois à 09:00.
const { pool } = require('./db');
const mailer   = require('./mailer');

async function sendMonthlyReport() {
  const admins = (await pool.query(
    `SELECT id, email, lang FROM users WHERE is_admin = true AND banned = false AND email IS NOT NULL`)).rows;
  if (!admins.length) return 0;

  const { rows: [s] } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users
         WHERE created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
           AND created_at <  DATE_TRUNC('month', NOW()))                                 AS new_users,
      (SELECT COUNT(*)::int FROM properties
         WHERE created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
           AND created_at <  DATE_TRUNC('month', NOW()))                                 AS new_listings,
      (SELECT COUNT(*)::int FROM properties
         WHERE status IN ('sold','rented')
           AND updated_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
           AND updated_at <  DATE_TRUNC('month', NOW()))                                 AS sold_rented,
      (SELECT COUNT(*)::int FROM signalements
         WHERE status IN ('resolved','dismissed')
           AND resolved_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
           AND resolved_at <  DATE_TRUNC('month', NOW()))                                AS reports_closed,
      (SELECT COALESCE(SUM(amount),0)::int FROM promotions
         WHERE status = 'paid' AND provider != 'admin'
           AND created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
           AND created_at <  DATE_TRUNC('month', NOW()))                                 AS featured_revenue,
      (SELECT COALESCE(SUM(views),0)::bigint FROM property_views_daily
         WHERE day >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')::date
           AND day <  DATE_TRUNC('month', NOW())::date)                                  AS total_views
  `);

  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const month = d.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  const monthAr = d.toLocaleString('ar-DZ', { month: 'long', year: 'numeric' });

  let sent = 0;
  for (const a of admins) {
    const ok = await mailer.sendMail({
      to: a.email,
      ...mailer.buildMonthlyReport(a.lang === 'ar' ? 'ar' : 'fr', {
        month: a.lang === 'ar' ? monthAr : month,
        ...s,
      }),
    });
    if (ok) sent++;
  }
  return sent;
}

module.exports = { sendMonthlyReport };
