const router = require('express').Router();
const db     = require('../db');
const admin  = require('../middleware/admin');

// GET /api/stats — statistiques globales (admin)
router.get('/', admin, async (req, res) => {
  const [users, properties, contacts, agencies] = await Promise.all([
    db.users.count(),
    db.properties.count(),
    db.contact_requests.count(),
    db.agencies.count(),
  ]);

  const [active, sold, rented, pending, pending_props] = await Promise.all([
    db.properties.count({ status: 'active' }),
    db.properties.count({ status: 'sold' }),
    db.properties.count({ status: 'rented' }),
    db.contact_requests.count({ status: 'pending' }),
    db.properties.count({ status: 'pending' }),
  ]);

  res.json({ users, properties, contacts, agencies, active, sold, rented, pending_contacts: pending, pending_props });
});

// GET /api/stats/details — métriques avancées (admin) : activité 7j/30j, signalements, newsletter
router.get('/details', admin, async (req, res) => {
  const { pool } = db;
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '7 days')    AS new_users_7d,
      (SELECT COUNT(*)::int FROM users WHERE created_at >= NOW() - INTERVAL '30 days')   AS new_users_30d,
      (SELECT COUNT(*)::int FROM users WHERE verified_kind IS NOT NULL)                  AS verified_users,
      (SELECT COUNT(*)::int FROM users WHERE banned = true)                              AS banned_users,
      (SELECT COUNT(*)::int FROM properties
         WHERE status = 'active' AND featured_until > NOW())                             AS featured_active,
      (SELECT COUNT(*)::int FROM contact_requests
         WHERE created_at >= NOW() - INTERVAL '7 days')                                  AS contacts_7d,
      (SELECT COUNT(*)::int FROM contact_requests
         WHERE created_at >= NOW() - INTERVAL '30 days')                                 AS contacts_30d,
      (SELECT COALESCE(SUM(views), 0)::bigint FROM property_views_daily
         WHERE day >= CURRENT_DATE - 6)                                                  AS views_7d,
      (SELECT COALESCE(SUM(views), 0)::bigint FROM property_views_daily
         WHERE day >= CURRENT_DATE - 29)                                                 AS views_30d,
      (SELECT COUNT(*)::int FROM signalements WHERE status = 'pending')                  AS signalements_pending,
      (SELECT COUNT(*)::int FROM signalements
         WHERE status IN ('resolved', 'ignored'))                                        AS signalements_closed,
      (SELECT COUNT(*)::int FROM newsletter_subscribers
         WHERE confirmed_at IS NOT NULL)                                                 AS newsletter_subscribers
  `);
  res.json(rows[0]);
});

// GET /api/stats/public — statistiques publiques de la plateforme (sans auth)
// Cache mémoire de 60 s (par processus) : évite de relancer les agrégats SQL à chaque appel
const PUBLIC_STATS_TTL_MS = 60 * 1000;
let publicStatsCache = { data: null, expires: 0 };

router.get('/public', async (req, res) => {
  const now = Date.now();
  res.set('Cache-Control', 'public, max-age=60');
  if (publicStatsCache.data && now < publicStatsCache.expires) {
    return res.json(publicStatsCache.data);
  }

  const { pool } = db;
  const [global, topWilayas, topTypes] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='active')        AS active,
        COUNT(*) FILTER (WHERE status='sold')          AS sold,
        COUNT(*) FILTER (WHERE status='rented')        AS rented,
        COUNT(*) FILTER (WHERE mode='vente')           AS vente,
        COUNT(*) FILTER (WHERE mode='location_longue') AS loc_longue,
        COUNT(*) FILTER (WHERE mode='location_courte') AS loc_courte,
        COALESCE(SUM(views),0)::bigint                 AS total_views,
        (SELECT COUNT(*) FROM users)::int              AS users,
        (SELECT COUNT(*) FROM agencies)::int           AS agencies
      FROM properties`),
    pool.query(
      `SELECT wilaya, COUNT(*)::int AS count
       FROM properties WHERE status='active'
       GROUP BY wilaya ORDER BY count DESC LIMIT 8`),
    pool.query(
      `SELECT type_bien, COUNT(*)::int AS count
       FROM properties WHERE status='active'
       GROUP BY type_bien ORDER BY count DESC LIMIT 6`),
  ]);
  const g = global.rows[0];
  const data = {
    active:      parseInt(g.active),
    sold:        parseInt(g.sold),
    rented:      parseInt(g.rented),
    vente:       parseInt(g.vente),
    loc_longue:  parseInt(g.loc_longue),
    loc_courte:  parseInt(g.loc_courte),
    total_views: parseInt(g.total_views),
    users:       parseInt(g.users),
    agencies:    parseInt(g.agencies),
    top_wilayas: topWilayas.rows,
    top_types:   topTypes.rows,
  };
  publicStatsCache = { data, expires: now + PUBLIC_STATS_TTL_MS };
  res.json(data);
});

// GET /api/stats/me — statistiques du propriétaire connecté
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const uid = req.user.id;
  const [props, contacts] = await Promise.all([
    db.pool.query(
      `SELECT COUNT(*)::int AS properties,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active,
              COALESCE(SUM(views), 0)::int AS total_views
         FROM properties WHERE owner_id = $1`, [uid]),
    db.pool.query(
      `SELECT COUNT(*)::int AS contacts,
              COUNT(*) FILTER (WHERE c.status = 'pending')::int AS pending
         FROM contact_requests c
         JOIN properties p ON p.id = c.property_id
        WHERE p.owner_id = $1`, [uid]),
  ]);
  res.json({ ...props.rows[0], ...contacts.rows[0], ...(await require('../clicks').totalsForOwner(uid)) });
});

// GET /api/stats/market?mode=&type_bien= — tendances du marché : médiane prix/m² par wilaya (public, cache 5 min)
// trend_pct : variation vs la médiane observée 30-60 jours plus tôt (NULL si pas d'historique).
const VALID_MODES = ['vente','location_longue','location_courte'];
const VALID_TYPES = ['appartement','villa','maison','bureau','local_commercial','terrain','ferme','entrepot'];
router.get('/market', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  const modeFilter = VALID_MODES.includes(req.query.mode) ? req.query.mode : null;
  const typeFilter = VALID_TYPES.includes(req.query.type_bien) ? req.query.type_bien : null;
  const params = [];
  let extraCurr = '', extraHist = '';
  if (modeFilter) {
    params.push(modeFilter);
    extraCurr += ` AND mode = $${params.length}`;
    extraHist += ` AND p.mode = $${params.length}`;
  }
  if (typeFilter) {
    params.push(typeFilter);
    extraCurr += ` AND type_bien = $${params.length}`;
    extraHist += ` AND p.type_bien = $${params.length}`;
  }
  const result = await db.pool.query(`
    WITH current AS (
      SELECT wilaya,
             COUNT(*)::int AS count,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price::numeric / surface_m2) AS med_now
        FROM properties
       WHERE status = 'active' AND surface_m2 > 0 AND price > 0 ${extraCurr}
       GROUP BY wilaya
      HAVING COUNT(*) >= 3
    ),
    hist AS (
      SELECT p.wilaya,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY h.price::numeric / p.surface_m2) AS med_hist
        FROM price_history h
        JOIN properties p ON p.id = h.property_id
       WHERE h.changed_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'
         AND p.surface_m2 > 0 AND h.price > 0 ${extraHist}
       GROUP BY p.wilaya
    )
    SELECT c.wilaya,
           c.count,
           ROUND(c.med_now)::int AS median_price_m2,
           CASE WHEN h.med_hist IS NOT NULL AND h.med_hist > 0
                THEN ROUND((c.med_now - h.med_hist) / h.med_hist * 100)::int
                ELSE NULL
           END AS trend_pct
      FROM current c
      LEFT JOIN hist h ON h.wilaya = c.wilaya
     ORDER BY c.med_now DESC
     LIMIT 20`, params);
  res.json({ wilayas: result.rows, mode: modeFilter, type_bien: typeFilter });
});

// GET /api/stats/evolution?days=30|60|90 — courbes temporelles (admin)
// Retourne des séries journalières (GENERATE_SERIES) pour : inscriptions, annonces publiées, vues, demandes.
router.get('/evolution', admin, async (req, res) => {
  const days = Math.min(90, Math.max(7, parseInt(req.query.days) || 30));
  res.set('Cache-Control', 'no-cache');
  const { pool } = db;
  const { rows } = await pool.query(`
    WITH dates AS (
      SELECT d::date AS day
        FROM generate_series(CURRENT_DATE - $1 + 1, CURRENT_DATE, interval '1 day') d
    )
    SELECT
      d.day::text,
      COALESCE(u.cnt, 0)::int   AS new_users,
      COALESCE(p.cnt, 0)::int   AS new_listings,
      COALESCE(v.cnt, 0)::bigint AS views,
      COALESCE(c.cnt, 0)::int   AS contacts
    FROM dates d
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*)::int AS cnt
        FROM users GROUP BY 1
    ) u ON u.day = d.day
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*)::int AS cnt
        FROM properties GROUP BY 1
    ) p ON p.day = d.day
    LEFT JOIN (
      SELECT day, SUM(views)::bigint AS cnt
        FROM property_views_daily GROUP BY 1
    ) v ON v.day = d.day
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*)::int AS cnt
        FROM contact_requests GROUP BY 1
    ) c ON c.day = d.day
    ORDER BY d.day
  `, [days]);
  res.json({ days, series: rows });
});

module.exports = router;
