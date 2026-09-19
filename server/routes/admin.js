const router = require('express').Router();
const db     = require('../db');
const admin  = require('../middleware/admin');
const moderation = require('../moderation');
const { pool, toId } = require('../db');

// GET /api/admin/users
router.get('/users', admin, async (req, res) => {
  // Colonnes listées : le hash du mot de passe ne quitte jamais la base
  const r = await pool.query(
    `SELECT id, name, email, phone, is_agent, is_admin, email_verified, banned, created_at
       FROM users ORDER BY id`);
  res.json(r.rows);
});

// PUT /api/admin/users/:id/ban
router.put('/users/:id/ban', admin, async (req, res) => {
  const { banned } = req.body;
  await db.users.update({ id: toId(req.params.id) ?? 0 }, { banned: !!banned });
  res.json({ ok: true });
});

// GET /api/admin/properties
router.get('/properties', admin, async (req, res) => {
  const { status } = req.query;
  res.json(await db.properties.find(status ? { status: String(status) } : {}));
});

// GET /api/admin/moderation?status=pending|rejected — file de modération (les plus anciennes d'abord)
router.get('/moderation', admin, async (req, res) => {
  const status = req.query.status === 'rejected' ? 'rejected' : 'pending';
  const r = await pool.query(
    `SELECT p.id, p.title, p.description, p.mode, p.type_bien, p.price, p.surface_m2, p.rooms,
            p.wilaya, p.commune, p.address, p.image, p.photos, p.status, p.created_at,
            p.moderation_reason, p.moderated_at, p.published_at,
            u.id AS owner_id, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone,
            u.email_verified AS owner_verified, u.created_at AS owner_since,
            (SELECT COUNT(*)::int FROM properties x WHERE x.owner_id = p.owner_id AND x.status = 'active') AS owner_active,
            a.name AS agency_name
       FROM properties p
       LEFT JOIN users u    ON u.id = p.owner_id
       LEFT JOIN agencies a ON a.id = p.agency_id
      WHERE p.status = $1
      ORDER BY p.created_at ${status === 'pending' ? 'ASC' : 'DESC'}`, [status]);
  const counts = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected FROM properties`);
  res.json({ items: r.rows, counts: counts.rows[0], enabled: moderation.enabled() });
});

// PUT /api/admin/properties/:id/moderate — { decision: 'approve' | 'reject', reason }
router.put('/properties/:id/moderate', admin, async (req, res) => {
  const { decision, reason } = req.body;
  if (!['approve', 'reject'].includes(decision))
    return res.status(400).json({ error: 'Décision invalide.' });
  const approve = decision === 'approve';
  const motif = String(reason || '').trim();
  if (!approve && motif.length < 5)
    return res.status(400).json({ error: 'Un motif de refus (5 caractères minimum) est obligatoire.' });

  const property = await db.properties.findById(req.params.id);
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });

  const status = approve ? 'active' : 'rejected';
  await pool.query(
    `UPDATE properties
        SET status = $1,
            published_at = CASE WHEN $1 = 'active' THEN COALESCE(published_at, NOW()) ELSE published_at END,
            moderation_reason = $2, moderated_at = NOW(), moderated_by = $3
      WHERE id = $4`,
    [status, approve ? null : motif.slice(0, 500), req.user.id, property.id]);

  // Notifier le propriétaire, sauf si l'annonce était déjà dans l'état demandé
  if (property.status !== status) moderation.notifyOwnerDecision(property, approve, motif).catch(() => {});
  res.json({ ok: true, status });
});

// PUT /api/admin/properties/:id/status
router.put('/properties/:id/status', admin, async (req, res) => {
  const { status } = req.body;
  const VALIDES = ['active','sold','rented','archived'];
  if (!VALIDES.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  if (status === 'active') {
    // Publication manuelle : on date la publication (alertes email) et on lève un éventuel refus
    await pool.query(
      `UPDATE properties SET status = 'active', published_at = COALESCE(published_at, NOW()),
              moderation_reason = NULL WHERE id = $1`, [toId(req.params.id) ?? 0]);
  } else {
    await db.properties.update({ id: toId(req.params.id) ?? 0 }, { status });
  }
  res.json({ ok: true });
});

// PUT /api/admin/properties/:id/verify
router.put('/properties/:id/verify', admin, async (req, res) => {
  await db.properties.update({ id: toId(req.params.id) ?? 0 }, { verified: true });
  res.json({ ok: true });
});

// DELETE /api/admin/properties/:id
router.delete('/properties/:id', admin, async (req, res) => {
  await db.properties.delete({ id: toId(req.params.id) ?? 0 });
  res.json({ ok: true });
});

// GET /api/admin/agencies
router.get('/agencies', admin, async (req, res) => {
  res.json(await db.agencies.find());
});

// PUT /api/admin/agencies/:id/verify
router.put('/agencies/:id/verify', admin, async (req, res) => {
  await db.agencies.update({ id: toId(req.params.id) ?? 0 }, { verified: true });
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
    [status, toId(req.params.id) ?? 0]
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
