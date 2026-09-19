const router = require('express').Router();
const db     = require('../db');
const admin  = require('../middleware/admin');
const { pool } = require('../db');

// GET /api/admin/users
router.get('/users', admin, async (req, res) => {
  const users = await db.users.find();
  res.json(users.map(u => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    is_agent: u.is_agent, is_admin: u.is_admin,
    email_verified: u.email_verified, banned: u.banned,
    created_at: u.created_at,
  })));
});

// PUT /api/admin/users/:id/ban
router.put('/users/:id/ban', admin, async (req, res) => {
  const { banned } = req.body;
  await db.users.update(u => u.id === Number(req.params.id), { banned: !!banned });
  res.json({ ok: true });
});

// GET /api/admin/properties
router.get('/properties', admin, async (req, res) => {
  const { status } = req.query;
  const props = status
    ? await db.properties.find(p => p.status === status)
    : await db.properties.find();
  res.json(props);
});

// PUT /api/admin/properties/:id/status
router.put('/properties/:id/status', admin, async (req, res) => {
  const { status } = req.body;
  const VALIDES = ['active','sold','rented','archived'];
  if (!VALIDES.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  await db.properties.update(p => p.id === Number(req.params.id), { status });
  res.json({ ok: true });
});

// PUT /api/admin/properties/:id/verify
router.put('/properties/:id/verify', admin, async (req, res) => {
  await db.properties.update(p => p.id === Number(req.params.id), { verified: true });
  res.json({ ok: true });
});

// DELETE /api/admin/properties/:id
router.delete('/properties/:id', admin, async (req, res) => {
  await db.properties.delete(p => p.id === Number(req.params.id));
  res.json({ ok: true });
});

// GET /api/admin/agencies
router.get('/agencies', admin, async (req, res) => {
  const agencies = await db.agencies.find();
  res.json(agencies);
});

// PUT /api/admin/agencies/:id/verify
router.put('/agencies/:id/verify', admin, async (req, res) => {
  await db.agencies.update(a => a.id === Number(req.params.id), { verified: true });
  res.json({ ok: true });
});

// GET /api/admin/signalements
router.get('/signalements', admin, async (req, res) => {
  const r = await pool.query(`
    SELECT s.*, p.title AS property_title, u.name AS reporter_name
    FROM signalements s
    LEFT JOIN properties p ON p.id = s.property_id
    LEFT JOIN users u ON u.id = s.user_id
    ORDER BY s.created_at DESC
  `);
  res.json(r.rows);
});

// PUT /api/admin/signalements/:id/resolve
router.put('/signalements/:id/resolve', admin, async (req, res) => {
  const { status } = req.body;
  const VALIDES = ['resolved', 'dismissed'];
  if (!VALIDES.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  const r = await pool.query(
    'UPDATE signalements SET status = $1 WHERE id = $2 RETURNING id',
    [status, req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'Signalement introuvable.' });
  res.json({ ok: true });
});

// GET /api/admin/newsletter
router.get('/newsletter', admin, async (req, res) => {
  const r = await pool.query('SELECT * FROM newsletter_subscribers ORDER BY created_at DESC');
  res.json(r.rows);
});

module.exports = router;
