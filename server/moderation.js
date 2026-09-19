// ── Modération des annonces ──────────────────────────────────────────────────
// Circuit : une annonce d'un utilisateur ordinaire est créée « pending », un admin
// l'approuve (« active ») ou la refuse (« rejected » + motif). Sont publiées
// directement : les annonces des admins et des propriétaires d'une agence vérifiée.
// MODERATION=off (dans .env) désactive tout le circuit.
const db     = require('./db');
const ws     = require('./ws');
const mailer = require('./mailer');

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
const CONTENT_FIELDS = ['title', 'description', 'image', 'photos'];

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
    'SELECT id, email FROM users WHERE is_admin = true AND banned = false')).rows;
  for (const a of admins) {
    ws.send(a.id, {
      type: 'notif', notif_type: 'moderation_pending',
      title: 'Annonce à valider',
      body: `« ${property.title} » attend une validation.`,
      link_id: property.id, time: new Date().toISOString(),
    });
    mailer.mailAdminPending({
      to: a.email, ownerName, propertyTitle: property.title, url: `${siteUrl()}/`,
    }).catch(() => {});
  }
}

// Prévient le propriétaire de la décision (approbation ou refus avec motif)
async function notifyOwnerDecision(property, approved, reason) {
  const owner = await db.users.findById(property.owner_id);
  if (!owner) return;
  ws.send(owner.id, {
    type: 'notif', notif_type: 'moderation_decision',
    title: approved ? 'Annonce publiée' : 'Annonce refusée',
    body: approved
      ? `« ${property.title} » est maintenant visible sur DzImmo.`
      : `« ${property.title} » a été refusée : ${reason}`,
    link_id: property.id, time: new Date().toISOString(),
  });
  mailer.mailModerationDecision({
    to: owner.email, name: owner.name, propertyTitle: property.title,
    approved, reason, url: listingUrl(property.id),
  }).catch(() => {});
}

module.exports = {
  enabled, isTrusted, contentChanged, notifyAdminsPending, notifyOwnerDecision, HIDDEN_STATUSES,
};
