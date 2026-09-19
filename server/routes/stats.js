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

  const active  = await db.properties.count(p => p.status === 'active');
  const sold    = await db.properties.count(p => p.status === 'sold');
  const rented  = await db.properties.count(p => p.status === 'rented');
  const pending = await db.contact_requests.count(c => c.status === 'pending');

  res.json({ users, properties, contacts, agencies, active, sold, rented, pending_contacts: pending });
});

// GET /api/stats/public — statistiques publiques de la plateforme (sans auth)
router.get('/public', async (req, res) => {
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
  res.json({
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
  });
});

// GET /api/stats/me — statistiques du propriétaire connecté
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const uid = req.user.id;
  const myProps   = await db.properties.find(p => p.owner_id === uid);
  const propIds   = new Set(myProps.map(p => p.id));
  const contacts  = await db.contact_requests.find(c => propIds.has(c.property_id));
  const totalViews = myProps.reduce((s, p) => s + (p.views || 0), 0);

  res.json({
    properties:   myProps.length,
    active:       myProps.filter(p => p.status === 'active').length,
    contacts:     contacts.length,
    pending:      contacts.filter(c => c.status === 'pending').length,
    total_views:  totalViews,
  });
});

module.exports = router;
