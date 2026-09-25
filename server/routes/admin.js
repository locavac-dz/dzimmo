const router = require('express').Router();
const db     = require('../db');
const admin  = require('../middleware/admin');
const moderation = require('../moderation');
const mailer = require('../mailer');
const newsletter = require('../newsletter');
const audit  = require('../audit');
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
  const uid = toId(req.params.id) ?? 0;
  await db.users.update({ id: uid }, { banned: !!banned });
  audit.log(req.user.id, banned ? 'ban_user' : 'unban_user', 'user', uid).catch(() => {});
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
    columns: 'id, title, wilaya, mode, type_bien, price, status, verified, featured_until, owner_id, created_at',
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
            lq.flags AS quality_flags, lq.details AS quality_details,
            (SELECT COUNT(*)::int FROM properties x WHERE x.owner_id = p.owner_id AND x.status = 'active') AS owner_active,
            a.name AS agency_name`,
    from: `properties p
       LEFT JOIN users u    ON u.id = p.owner_id
       LEFT JOIN agencies a ON a.id = p.agency_id
       LEFT JOIN listing_quality lq ON lq.property_id = p.id` });
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

  const status = await moderation.decide(property, approve, motif, req.user.id);
  res.json({ ok: true, status });
});

// PUT /api/admin/properties/:id/status
router.put('/properties/:id/status', admin, async (req, res) => {
  const { status } = req.body;
  const VALIDES = ['active','sold','rented','archived'];
  if (!VALIDES.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  const pid = toId(req.params.id) ?? 0;
  if (status === 'active') {
    // Publication manuelle : on date la publication (alertes email) et on lève un éventuel refus
    await pool.query(
      `UPDATE properties SET status = 'active', published_at = COALESCE(published_at, NOW()),
              moderation_reason = NULL WHERE id = $1`, [pid]);
  } else {
    await db.properties.update({ id: pid }, { status });
  }
  audit.log(req.user.id, 'status_property', 'property', pid, { status }).catch(() => {});
  res.json({ ok: true });
});

// PUT /api/admin/properties/:id/une { days } — met une annonce à la une gratuitement (days 1 à 365, prolonge l'éventuelle mise en avant en cours) ou retire la mise à la une (days 0)
router.put('/properties/:id/une', admin, async (req, res) => {
  const featured = require('../featured');
  const days = req.body && req.body.days;
  if (!Number.isInteger(days) || days < 0 || days > featured.MAX_DAYS) return res.status(400).json({ error: 'Durée invalide.' });
  const pid = toId(req.params.id) ?? 0;
  const r = await featured.grant(pid, days);
  if (!r) return res.status(404).json({ error: 'Annonce introuvable.' });
  audit.log(req.user.id, days > 0 ? 'feature_property' : 'unfeature_property', 'property', pid, days > 0 ? { days } : {}).catch(() => {});
  res.json({ ok: true, featured_until: r.featured_until });
});

// PUT /api/admin/properties/:id/verify
router.put('/properties/:id/verify', admin, async (req, res) => {
  await db.properties.update({ id: toId(req.params.id) ?? 0 }, { verified: true });
  res.json({ ok: true });
});

// DELETE /api/admin/properties/:id
router.delete('/properties/:id', admin, async (req, res) => {
  const pid = toId(req.params.id) ?? 0;
  await db.properties.delete({ id: pid });
  audit.log(req.user.id, 'delete_property', 'property', pid).catch(() => {});
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
// Chaque ligne porte l'état de l'annonce et le nombre de signalements encore en attente sur elle (une annonce très signalée saute aux yeux).
router.get('/signalements', admin, async (req, res) => {
  const filtre = ['pending', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : null;
  const [list, pending] = await Promise.all([
    paginate(pool, {
      columns: `s.*, p.title AS property_title, p.status AS property_status, u.name AS reporter_name,
        (SELECT COUNT(*)::int FROM signalements x WHERE x.property_id = s.property_id AND x.status = 'pending') AS property_pending`,
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

// PUT /api/admin/signalements/:id/resolve { status: 'resolved' | 'dismissed', action?: 'reject', reason? }
// `action: 'reject'` refuse aussi l'annonce (motif obligatoire, 5 caractères au moins) : le propriétaire est prévenu et tous les
// signalements en attente sur cette annonce sont classés comme fondés (moderation.decide).
router.put('/signalements/:id/resolve', admin, async (req, res) => {
  const { status, action, reason } = req.body;
  const VALIDES = ['resolved', 'dismissed'];
  if (!VALIDES.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  const sid = toId(req.params.id) ?? 0;
  const sig = (await pool.query('SELECT id, property_id FROM signalements WHERE id = $1', [sid])).rows[0];
  if (!sig) return res.status(404).json({ error: 'Signalement introuvable.' });
  if (action === 'reject') {
    if (status !== 'resolved') return res.status(400).json({ error: 'Statut invalide.' });
    const motif = String(reason || '').trim();
    if (motif.length < 5) return res.status(400).json({ error: 'Un motif de refus (5 caractères minimum) est obligatoire.' });
    const property = await db.properties.findById(sig.property_id);
    if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
    await moderation.decide(property, false, motif, req.user.id);
  }
  await pool.query(
    `UPDATE signalements SET status = $1, resolved_at = COALESCE(resolved_at, NOW()), resolved_by = COALESCE(resolved_by, $2)
      WHERE id = $3 AND status = 'pending'`, [status, req.user.id, sid]);
  audit.log(req.user.id, status === 'resolved' ? 'resolve_report' : 'dismiss_report', 'signalement', sid,
    action === 'reject' ? { action: 'reject' } : {}).catch(() => {});
  res.json({ ok: true });
});

// ── Newsletter (voir server/newsletter.js) ───────────────────────────────────
// GET /api/admin/newsletter : abonnés (confirmés ou en attente de confirmation) et nombre de destinataires possibles
router.get('/newsletter', admin, async (req, res) => {
  const page = await paginate(pool, {
    columns: 'id, email, lang, created_at, confirmed_at', from: 'newsletter_subscribers', orderBy: 'created_at DESC, id DESC', query: req.query });
  page.confirmed = (await pool.query('SELECT COUNT(*)::int AS n FROM newsletter_subscribers WHERE confirmed_at IS NOT NULL')).rows[0].n;
  page.smtp = mailer.configured();
  res.json(page);
});

// GET /api/admin/newsletter/campaigns : campagnes avec envoyés, échecs et total
router.get('/newsletter/campaigns', admin, async (req, res) => {
  res.json(await paginate(pool, {
    columns: 'c.id, c.subject_fr, c.subject_ar, c.created_at, c.canceled_at, c.total, c.sent, c.failed',
    from: newsletter.CAMPAIGNS_FROM, countFrom: 'newsletter_campaigns', orderBy: 'c.created_at DESC, c.id DESC', query: req.query }));
});

// POST /api/admin/newsletter/campaigns { subject_fr, body_fr, subject_ar, body_ar } : met l'envoi en file pour les abonnés confirmés
router.post('/newsletter/campaigns', admin, async (req, res) => {
  const { campaign, error } = newsletter.parseCampaign(req.body);
  if (error) return res.status(400).json({ error });
  if (!mailer.configured()) return res.status(503).json({ error: "Envoi d'emails non configuré sur le serveur." });
  if (!(await pool.query('SELECT 1 FROM newsletter_subscribers WHERE confirmed_at IS NOT NULL LIMIT 1')).rowCount)
    return res.status(400).json({ error: 'Aucun abonné confirmé.' });
  const r = await newsletter.createCampaign(campaign, req.user.id);
  res.status(201).json({ id: r.id, recipients: r.recipients });
});

// POST /api/admin/newsletter/campaigns/:id/cancel : les envois pas encore partis sont abandonnés
router.post('/newsletter/campaigns/:id/cancel', admin, async (req, res) => {
  if (!(await newsletter.cancelCampaign(toId(req.params.id) ?? 0))) return res.status(404).json({ error: 'Campagne introuvable.' });
  res.json({ ok: true });
});

// POST /api/admin/newsletter/test : même mise en forme, envoyée à l'adresse de l'administrateur seulement
router.post('/newsletter/test', admin, async (req, res) => {
  const { campaign, error } = newsletter.parseCampaign(req.body);
  if (error) return res.status(400).json({ error });
  if (!mailer.configured()) return res.status(503).json({ error: "Envoi d'emails non configuré sur le serveur." });
  const me = await db.users.findById(req.user.id);
  const ok = me && await newsletter.sendTest(campaign, me.email, me.lang === 'ar' ? 'ar' : 'fr');
  if (!ok) return res.status(503).json({ error: "L'email de test n'a pas pu être envoyé." });
  res.json({ ok: true });
});

// GET /api/admin/audit?page=1&per_page=25 — journal d'audit paginé (les plus récentes d'abord)
router.get('/audit', admin, async (req, res) => {
  res.json(await paginate(pool, {
    columns: `l.id, l.action, l.target_type, l.target_id, l.details, l.created_at,
              u.name AS admin_name`,
    from: `admin_logs l LEFT JOIN users u ON u.id = l.admin_id`,
    countFrom: 'admin_logs l',
    orderBy: 'l.created_at DESC, l.id DESC',
    query: req.query,
  }));
});

module.exports = router;
