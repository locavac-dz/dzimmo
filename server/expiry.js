// ── Expiration et reconfirmation des annonces ────────────────────────────────
// Une annonce publiée doit être reconfirmée par son annonceur : sans nouvelles, elle reste en ligne bien après avoir été vendue
// ou louée, ce qui détruit la confiance des visiteurs. Cycle :
//   1. LISTING_CONFIRM_DAYS (30) jours sans confirmation → rappel (email + notification) avec un lien « toujours disponible » ;
//   2. LISTING_EXPIRE_GRACE_DAYS (14) jours plus tard, toujours rien → l'annonce est retirée (« archived » + expired_at) ;
//   3. l'annonceur peut la renouveler en un clic (tableau de bord ou lien du dernier email).
// Une confirmation = création, modification par son propriétaire, « toujours disponible » ou renouvellement.
const crypto = require('crypto');
const db     = require('./db');
const ws     = require('./ws');
const mailer = require('./mailer');
const { notif } = require('./messages');

// Nombre de jours entier de 1 à 365, en chiffres seulement (« 1e2 », « 1.5 », « abc », vide = valeur par défaut)
const days = (name, def) => { const raw = String(process.env[name] ?? '').trim(); const n = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN; return n >= 1 && n <= 365 ? n : def; };
const confirmDays = () => days('LISTING_CONFIRM_DAYS', 30);
const graceDays   = () => days('LISTING_EXPIRE_GRACE_DAYS', 14);
const siteUrl     = () => (process.env.APP_URL || 'http://localhost:3001').replace(/\/+$/, '');

// Jeton du lien de l'email : dépend de la date de dernière confirmation, donc à usage unique (toute confirmation l'invalide)
function token(id, confirmedAt) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`renew:${id}:${new Date(confirmedAt).getTime()}`).digest('hex').slice(0, 40);
}
function validToken(id, confirmedAt, given) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(token(id, confirmedAt)), b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const linkFor = p => `${siteUrl()}${require('./seo').propertyPath(p)}?renew=${token(p.id, p.last_confirmed_at)}`;

// ── Rappels ──────────────────────────────────────────────────────────────────
async function remindDue(limit = 200) {
  const due = (await db.pool.query(
    `SELECT p.*, u.email, u.name AS owner_name, u.lang AS owner_lang
       FROM properties p JOIN users u ON u.id = p.owner_id
      WHERE p.status = 'active' AND u.banned = false AND p.expiry_notified_at IS NULL
        AND p.last_confirmed_at < NOW() - make_interval(days => $1)
      ORDER BY p.last_confirmed_at LIMIT $2`, [confirmDays(), limit])).rows;
  let sent = 0;
  for (const p of due) {
    // Réservation atomique : deux instances (ou deux passages) n'envoient jamais deux rappels pour la même annonce
    // (l'ancienneté est revérifiée en base : l'annonceur a pu confirmer entre-temps ; une date relue en JavaScript perd les microsecondes)
    const claim = await db.pool.query(
      `UPDATE properties SET expiry_notified_at = NOW()
        WHERE id = $1 AND status = 'active' AND expiry_notified_at IS NULL AND last_confirmed_at < NOW() - make_interval(days => $2)
        RETURNING id`, [p.id, confirmDays()]);
    if (!claim.rowCount) continue;
    sent++;
    ws.send(p.owner_id, { type: 'notif', notif_type: 'expiry_reminder', ...notif(p.owner_lang, 'expiry_reminder', { name: p.owner_name, title: p.title }),
      link_id: p.id, time: new Date().toISOString() });
    mailer.mailExpiryReminder({ to: p.email, lang: p.owner_lang, name: p.owner_name, propertyTitle: p.title,
      days: confirmDays(), graceDays: graceDays(), confirmUrl: linkFor(p) }).catch(() => {});
  }
  return sent;
}

// ── Retrait ──────────────────────────────────────────────────────────────────
async function expireDue() {
  const gone = (await db.pool.query(
    `UPDATE properties SET status = 'archived', expired_at = NOW()
      WHERE status = 'active' AND expiry_notified_at IS NOT NULL
        AND expiry_notified_at < NOW() - make_interval(days => $1) AND last_confirmed_at < expiry_notified_at
      RETURNING *`, [graceDays()])).rows;
  for (const p of gone) {
    const u = await db.users.findById(p.owner_id);
    if (!u) continue;
    ws.send(u.id, { type: 'notif', notif_type: 'expiry_expired', ...notif(u.lang, 'expiry_expired', { name: u.name, title: p.title }),
      link_id: p.id, time: new Date().toISOString() });
    if (!u.banned) mailer.mailListingExpired({ to: u.email, lang: u.lang, name: u.name, propertyTitle: p.title, renewUrl: linkFor(p) }).catch(() => {});
  }
  return gone.length;
}

async function run() {
  const reminded = await remindDue();
  const expired = await expireDue();
  return { reminded, expired };
}

// ── Actions de l'annonceur ───────────────────────────────────────────────────
// Annonce active, ou retirée automatiquement (pas archivée volontairement, ni vendue, ni en modération)
const RENEWABLE = `(status = 'active' OR (status = 'archived' AND expired_at IS NOT NULL))`;

// « Toujours disponible » / renouvellement : remet le compteur à zéro et remet en ligne une annonce expirée
async function renew(id) {
  const r = await db.pool.query(
    `UPDATE properties
        SET last_confirmed_at = NOW(), expiry_notified_at = NULL, expired_at = NULL,
            status = CASE WHEN status = 'archived' THEN 'active' ELSE status END
      WHERE id = $1 AND ${RENEWABLE}
      RETURNING id, status, last_confirmed_at`, [id]);
  return r.rows[0] || null;
}

// « Vendue » ou « Louée » : le bien n'est plus disponible
async function close(id, mode) {
  const r = await db.pool.query(
    `UPDATE properties SET status = $2, expiry_notified_at = NULL, expired_at = NULL
      WHERE id = $1 AND ${RENEWABLE} RETURNING id, status`, [id, mode === 'vente' ? 'sold' : 'rented']);
  return r.rows[0] || null;
}

module.exports = { confirmDays, graceDays, token, validToken, linkFor, remindDue, expireDue, run, renew, close };
