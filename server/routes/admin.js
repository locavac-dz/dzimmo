const router = require('express').Router();
const db     = require('../db');
const admin  = require('../middleware/admin');
const moderation = require('../moderation');
const { pool, toId } = require('../db');
const { paginate, likePattern } = require('../pagination');

// Recherche admin : texte (ILIKE sur les colonnes données) ou numéro d'annonce / de compte (« 42 » ou « #42 »)
function searchCondition(q, columns, params) {
  const like = likePattern(q);
  if (!like) return null;
  params.push(like);
  const parts = columns.map(c => `${c} ILIKE $${params.length}`);
  const id = /^#?\d{1,10}$/.test(String(q).trim()) ? toId(String(q).trim().replace('#', '')) : null;
  if (id) { params.push(id); parts.push(`id = $${params.length}`); }
  return '(' + parts.join(' OR ') + ')';
}

// Listes paginées : ?page=1&per_page=25 (100 max), réponse { items, total, page, pages, per_page }, plus récents d'abord.

// GET /api/admin/users?q=
router.get('/users', admin, async (req, res) => {
  const params = [];
  const cond = searchCondition(req.query.q, ['name', 'email'], params);
  // Colonnes listées : le hash du mot de passe ne quitte jamais la base
  res.json(await paginate(pool, {
    columns: 'id, name, email, phone, is_agent, is_admin, email_verified, verified_kind, banned, created_at',
    from: 'users', where: cond ? 'WHERE ' + cond : '', params, orderBy: 'id DESC', query: req.query }));
});

// PUT /api/admin/users/:id/ban
router.put('/users/:id/ban', admin, async (req, res) => {
  const { banned } = req.body;
  await db.users.update({ id: toId(req.params.id) ?? 0 }, { banned: !!banned });
  res.json({ ok: true });
});

// GET /api/admin/properties?status=&q=
router.get('/properties', admin, async (req, res) => {
  const { status } = req.query;
  const params = [], conds = [];
  if (status) { params.push(String(status)); conds.push(`status = $${params.length}`); }
  const cond = searchCondition(req.query.q, ['title', 'wilaya'], params);
  if (cond) conds.push(cond);
  res.json(await paginate(pool, {
    columns: 'id, title, wilaya, mode, type_bien, price, status, verified, owner_id, created_at',
    from: 'properties', where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params, orderBy: 'id DESC', query: req.query }));
});

// GET /api/admin/moderation?status=pending|rejected — file de modération (les plus anciennes d'abord), 10 fiches par page
router.get('/moderation', admin, async (req, res) => {
  const status = req.query.status === 'rejected' ? 'rejected' : 'pending';
  const list = await paginate(pool, { defaut: 10, query: req.query, params: [status],
    where: 'WHERE p.status = $1', countFrom: 'properties p',
    orderBy: `p.created_at ${status === 'pending' ? 'ASC' : 'DESC'}, p.id`,
    columns: `p.id, p.title, p.description, p.mode, p.type_bien, p.price, p.surface_m2, p.rooms,
            p.wilaya, p.commune, p.address, p.image, p.photos, p.status, p.created_at,
            p.moderation_reason, p.moderated_at, p.published_at,
            u.id AS owner_id, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone,
            u.email_verified AS owner_verified, u.created_at AS owner_since,
            (SELECT COUNT(*)::int FROM properties x WHERE x.owner_id = p.owner_id AND x.status = 'active') AS owner_active,
            a.name AS agency_name`,
    from: `properties p
       LEFT JOIN users u    ON u.id = p.owner_id
       LEFT JOIN agencies a ON a.id = p.agency_id` });
  const counts = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected FROM properties`);
  res.json({ ...list, counts: counts.rows[0], enabled: moderation.enabled() });
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
            last_confirmed_at = CASE WHEN $1 = 'active' THEN NOW() ELSE last_confirmed_at END,
            expiry_notified_at = CASE WHEN $1 = 'active' THEN NULL ELSE expiry_notified_at END,
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

// GET /api/admin/agencies?q=
router.get('/agencies', admin, async (req, res) => {
  const params = [];
  const cond = searchCondition(req.query.q, ['name', 'wilaya'], params);
  res.json(await paginate(pool, {
    columns: '*', from: 'agencies', where: cond ? 'WHERE ' + cond : '', params, orderBy: 'id DESC', query: req.query }));
});

// PUT /api/admin/agencies/:id/verify
router.put('/agencies/:id/verify', admin, async (req, res) => {
  await db.agencies.update({ id: toId(req.params.id) ?? 0 }, { verified: true });
  res.json({ ok: true });
});

// GET /api/admin/signalements?status=pending|resolved|dismissed — `pending` = nombre en attente, tous filtres confondus
router.get('/signalements', admin, async (req, res) => {
  const filtre = ['pending', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : null;
  const [list, pending] = await Promise.all([
    paginate(pool, {
      columns: 's.*, p.title AS property_title, u.name AS reporter_name',
      from: `signalements s
        LEFT JOIN properties p ON p.id = s.property_id
        LEFT JOIN users u ON u.id = s.user_id`,
      countFrom: 'signalements s',
      where: filtre ? 'WHERE s.status = $1' : '', params: filtre ? [filtre] : [],
      orderBy: 's.created_at DESC, s.id DESC', query: req.query }),
    db.pool.query(`SELECT COUNT(*)::int AS n FROM signalements WHERE status = 'pending'`),
  ]);
  res.json({ ...list, pending: pending.rows[0].n });
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
  res.json(await paginate(pool, {
    columns: '*', from: 'newsletter_subscribers', orderBy: 'created_at DESC, id DESC', query: req.query }));
});

module.exports = router;
