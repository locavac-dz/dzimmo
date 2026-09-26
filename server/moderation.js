// ── Modération des annonces ──────────────────────────────────────────────────
// Circuit : une annonce d'un utilisateur ordinaire est créée « pending », un admin
// l'approuve (« active ») ou la refuse (« rejected » + motif). Sont publiées
// directement : les annonces des admins et des propriétaires d'une agence vérifiée.
// MODERATION=off (dans .env) désactive tout le circuit.
const db     = require('./db');
const ws     = require('./ws');
const mailer = require('./mailer');
const audit  = require('./audit');
const { notif, translateReason } = require('./messages');

const enabled = () => String(process.env.MODERATION || 'on').toLowerCase() !== 'off';

const siteUrl = () => (process.env.APP_URL || 'http://localhost:3001').replace(/\/+$/, '');
const listingUrl = id => `${siteUrl()}/annonce/${id}`;

// Statuts jamais visibles du public (le propriétaire et les admins les voient)
const HIDDEN_STATUSES = ['pending', 'rejected'];

// Publication directe : modération désactivée, admin, ou propriétaire d'une agence vérifiée
async function isTrusted(user) {
  if (!enabled() || user.is_admin) return true;
  const r = await db.pool.query(
    'SELECT 1 FROM agencies WHERE owner_id = $1 AND verified = true LIMIT 1', [user.id]);
  return r.rowCount > 0;
}

// Une modification de ces champs sur une annonce publiée la remet en modération
const CONTENT_FIELDS = ['title', 'description', 'image', 'photos', 'video_url', 'tour_url', 'condition'];

function contentChanged(property, changes) {
  return CONTENT_FIELDS.some(k => {
    if (changes[k] === undefined) return false;
    const before = k === 'photos' ? JSON.stringify(property.photos || []) : String(property[k] ?? '');
    return before !== String(changes[k] ?? '');
  });
}

// ── Notifications ────────────────────────────────────────────────────────────
// Prévient les admins (temps réel + email) qu'une annonce attend une validation
async function notifyAdminsPending(property, ownerName) {
  const admins = (await db.pool.query(
    'SELECT id, email, lang FROM users WHERE is_admin = true AND banned = false')).rows;
  for (const a of admins) {
    ws.send(a.id, {
      type: 'notif', notif_type: 'moderation_pending',
      ...notif(a.lang, 'mod_pending', { title: property.title }),
      link_id: property.id, time: new Date().toISOString(),
    });
    mailer.mailAdminPending({
      to: a.email, lang: a.lang, ownerName, propertyTitle: property.title, url: `${siteUrl()}/`,
    }).catch(() => {});
  }
}

// Prévient le propriétaire de la décision (approbation ou refus avec motif)
async function notifyOwnerDecision(property, approved, reason) {
  const owner = await db.users.findById(property.owner_id);
  if (!owner) return;
  ws.send(owner.id, {
    type: 'notif', notif_type: 'moderation_decision',
    ...(approved
      ? notif(owner.lang, 'mod_approved', { title: property.title })
      : notif(owner.lang, 'mod_rejected', { title: property.title, reason: translateReason(reason, owner.lang) })),
    link_id: property.id, time: new Date().toISOString(),
  });
  mailer.mailModerationDecision({
    to: owner.email, lang: owner.lang, name: owner.name, propertyTitle: property.title,
    approved, reason, url: listingUrl(property.id),
  }).catch(() => {});
}

// Prévient les administrateurs qu'une annonce refusée avait une mise à la une payante → remboursement manuel.
async function notifyAdminsFeaturedRefund(property) {
  const promo = (await db.pool.query(
    `SELECT amount, days FROM promotions WHERE property_id = $1 AND status = 'paid' AND provider != 'admin' ORDER BY paid_at DESC LIMIT 1`,
    [property.id])).rows[0];
  if (!promo) return;
  const admins = (await db.pool.query('SELECT id, email, lang FROM users WHERE is_admin = true AND banned = false')).rows;
  for (const a of admins) {
    mailer.mailFeaturedRefundAlert({
      to: a.email, lang: a.lang, propertyTitle: property.title,
      days: promo.days, amount: promo.amount, featuredUntil: property.featured_until,
      url: `${siteUrl()}/`,
    }).catch(() => {});
  }
}

// Décision d'un administrateur (approbation ou refus avec motif) : commune à la file de modération et aux signalements.
// Les signalements encore en attente sur l'annonce sont classés du même coup : sans suite si elle est approuvée, fondés si elle est refusée.
async function decide(property, approve, motif, adminId) {
  const status = approve ? 'active' : 'rejected';
  await db.pool.query(
    `UPDATE properties
        SET status = $1,
            published_at = CASE WHEN $1 = 'active' THEN COALESCE(published_at, NOW()) ELSE published_at END,
            last_confirmed_at = CASE WHEN $1 = 'active' THEN NOW() ELSE last_confirmed_at END,
            expiry_notified_at = CASE WHEN $1 = 'active' THEN NULL ELSE expiry_notified_at END,
            moderation_reason = $2, moderated_at = NOW(), moderated_by = $3
      WHERE id = $4`,
    [status, approve ? null : String(motif).slice(0, 500), adminId, property.id]);
  await db.pool.query(
    `UPDATE signalements SET status = $1, resolved_at = NOW(), resolved_by = $2
      WHERE property_id = $3 AND status = 'pending'`,
    [approve ? 'dismissed' : 'resolved', adminId, property.id]);
  // Le propriétaire n'est prévenu que si l'annonce change d'état
  if (property.status !== status) notifyOwnerDecision(property, approve, motif).catch(() => {});
  if (approve) require('./search-alerts').notifyMatchingAlerts({ ...property, status: 'active' }).catch(() => {});
  // Mise à la une payante encore active sur une annonce refusée → alerter les admins pour le remboursement
  if (!approve && property.featured_until && new Date(property.featured_until) > new Date())
    notifyAdminsFeaturedRefund(property).catch(() => {});
  audit.log(adminId, approve ? 'moderate_approve' : 'moderate_reject', 'property', property.id,
    approve ? {} : { reason: motif }).catch(() => {});
  return status;
}

module.exports = {
  enabled, isTrusted, contentChanged, notifyAdminsPending, notifyOwnerDecision, decide, HIDDEN_STATUSES,
};
