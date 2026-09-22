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

// GET /api/stats/market — tendances du marché : médiane prix/m² par wilaya (public, cache 10 min)
router.get('/market', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=600');
  const result = await db.pool.query(
    `SELECT wilaya,
            COUNT(*)::int AS count,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price::numeric / surface_m2))::int AS median_price_m2
       FROM properties
      WHERE status = 'active' AND surface_m2 > 0 AND price > 0
      GROUP BY wilaya
      HAVING COUNT(*) >= 3
      ORDER BY median_price_m2 DESC
      LIMIT 20`,
  );
  res.json({ wilayas: result.rows });
});

module.exports = router;
