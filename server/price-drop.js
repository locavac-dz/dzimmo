// ── Alerte de baisse de prix ─────────────────────────────────────────────────
// Quand l'annonceur baisse le prix d'une annonce, les membres qui l'ont mise en favori en sont prévenus (notification + email,
// dans leur langue), sauf s'ils ont coupé l'alerte dans leur profil (users.notify_price_drop). Garde-fous contre l'abus
// (l'annonceur ne doit pas pouvoir inonder les favoris ni simuler une « promotion ») :
//   - la baisse doit atteindre MIN_PERCENT % du prix précédent ;
//   - le nouveau prix doit être inférieur à **tous** les prix des 30 derniers jours (monter puis « baisser » ne compte pas) ;
//   - une seule alerte par annonce et par COOLDOWN_DAYS jours (réservation atomique en SQL, commune aux workers) ;
//   - annonces `active` seulement, jamais l'annonceur lui-même, jamais un compte suspendu, au plus MAX_RECIPIENTS membres.
// L'email n'est envoyé qu'à une adresse confirmée. Aucune adresse ni identité dans les journaux.
const db     = require('./db');
const ws     = require('./ws');
const mailer = require('./mailer');
const { notif, normalize } = require('./messages');

const MIN_PERCENT    = 3;
const COOLDOWN_DAYS  = 7;
const LOOKBACK_DAYS  = 30;
const MAX_RECIPIENTS = 500;

// Fonction pure : { percent } si c'est une vraie baisse, sinon null.
// `lowestRecent` = le plus bas prix des LOOKBACK_DAYS derniers jours, prix précédent compris.
function dropInfo(oldPrice, newPrice, lowestRecent = oldPrice) {
  const o = Number(oldPrice), n = Number(newPrice), low = Number(lowestRecent);
  if (![o, n, low].every(Number.isFinite) || o <= 0 || n <= 0 || n >= o || n >= low) return null;
  const percent = Math.floor((o - n) / o * 100);
  return percent >= MIN_PERCENT ? { percent } : null;
}

// Plus bas prix des 30 derniers jours (à lire AVANT d'enregistrer le nouveau prix dans price_history)
async function lowestRecent(propertyId, currentPrice) {
  const r = await db.pool.query(
    `SELECT MIN(price) AS low FROM price_history WHERE property_id = $1 AND changed_at > NOW() - make_interval(days => $2)`,
    [propertyId, LOOKBACK_DAYS]);
  const low = r.rows[0] && r.rows[0].low;
  return low === null || low === undefined ? Number(currentPrice) : Math.min(Number(low), Number(currentPrice));
}

const money = (lang, n) => `${Number(n).toLocaleString('fr-DZ')} ${normalize(lang) === 'ar' ? 'د.ج' : 'DZD'}`;

// Prévient les membres qui suivent l'annonce. Renvoie le nombre de membres prévenus
// (0 si la baisse ne compte pas, si l'annonce n'est plus publiée ou si une alerte a déjà eu lieu récemment).
async function notifyDrop(propertyId, oldPrice, newPrice, lowest) {
  const info = dropInfo(oldPrice, newPrice, lowest);
  if (!info) return 0;
  // Réservation atomique : deux workers, ou deux modifications rapprochées, ne déclenchent qu'une alerte
  const claim = await db.pool.query(
    `UPDATE properties SET price_drop_notified_at = NOW()
      WHERE id = $1 AND status = 'active' AND price = $3
        AND (price_drop_notified_at IS NULL OR price_drop_notified_at < NOW() - make_interval(days => $2))
      RETURNING *`, [propertyId, COOLDOWN_DAYS, newPrice]);
  const p = claim.rows[0];
  if (!p) return 0;
  const followers = (await db.pool.query(
    `SELECT u.id, u.name, u.email, u.lang, u.email_verified
       FROM favorites f JOIN users u ON u.id = f.user_id
      WHERE f.property_id = $1 AND u.id <> $2 AND u.banned = false AND u.notify_price_drop
      ORDER BY f.id LIMIT $3`, [p.id, p.owner_id, MAX_RECIPIENTS])).rows;
  const seo = require('./seo');
  const path = seo.propertyPath(p);
  for (const u of followers) {
    const lang = normalize(u.lang);
    ws.send(u.id, { type: 'notif', notif_type: 'price_drop',
      ...notif(lang, 'price_drop', { title: p.title, price: money(lang, newPrice), percent: info.percent }),
      link_id: p.id, time: new Date().toISOString() });
    if (u.email_verified)
      await mailer.mailPriceDrop({ to: u.email, lang, name: u.name, propertyTitle: p.title, oldPrice: Number(oldPrice), newPrice: Number(newPrice),
        percent: info.percent, url: `${mailer.siteUrl()}${seo.localized(lang, path)}` }).catch(() => {});
  }
  return followers.length;
}

module.exports = { MIN_PERCENT, COOLDOWN_DAYS, LOOKBACK_DAYS, MAX_RECIPIENTS, dropInfo, lowestRecent, notifyDrop, money };
