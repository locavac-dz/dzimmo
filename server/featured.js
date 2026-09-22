// Mise en avant « À la une » : formules, activation après paiement, attribution par un administrateur.
// L'état vient d'une seule colonne, properties.featured_until : à la une tant qu'elle est dans le futur (rien à expirer par tâche planifiée).
// Toute écriture est atomique en SQL (pm2 en cluster : deux workers ne doivent pas compter un paiement deux fois).

const { pool } = require('./db');
const payments = require('./payments');
const mailer   = require('./mailer');

const DEFAULT_PRICES = '7:1500,15:2500,30:4000';   // jours:prix en DZD
const MAX_DAYS = 365;

// Formules « jours:prix » de FEATURED_PRICES ; une entrée illisible est ignorée (config-check l'annonce), aucune formule valide : les défauts
function plans(env = process.env) {
  const parse = raw => String(raw).split(',').map(s => s.trim().split(':')).filter(p => p.length === 2)
    .map(([d, m]) => ({ days: Number(d), price: Number(m) }))
    .filter(p => Number.isInteger(p.days) && p.days >= 1 && p.days <= MAX_DAYS && Number.isFinite(p.price) && p.price >= 0 && /^\d+$/.test(String(p.price)));
  const own = env.FEATURED_PRICES ? parse(env.FEATURED_PRICES) : [];
  const list = own.length ? own : parse(DEFAULT_PRICES);
  const seen = new Set();
  return list.filter(p => !seen.has(p.days) && seen.add(p.days)).sort((a, b) => a.days - b.days).slice(0, 6);
}

// Ouvert par défaut en développement (paiement simulé), fermé en production tant que FEATURED_ENABLED n'est pas mis à true
function enabled(env = process.env) {
  const v = String(env.FEATURED_ENABLED ?? '').trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return env.NODE_ENV !== 'production';
}

// Prolonge la mise à la une d'une annonce : à partir de la fin en cours si elle n'est pas terminée, sinon d'aujourd'hui
const EXTEND = `UPDATE properties SET featured_until = GREATEST(COALESCE(featured_until, now()), now()) + ($2::int * interval '1 day')
                 WHERE id = $1 RETURNING featured_until`;

// Paiement confirmé : la promotion passe de « pending » à « paid » (une seule fois, même si la confirmation arrive deux fois) et prolonge l'annonce.
// Un email de reçu est envoyé au propriétaire (sans bloquer la réponse).
async function activate(promotionId) {
  const done = await pool.query(
    `UPDATE promotions SET status = 'paid', paid_at = now() WHERE id = $1 AND status = 'pending' RETURNING property_id, days, amount`, [promotionId]);
  if (!done.rows[0]) return null;
  const { property_id, days, amount } = done.rows[0];
  const r = await pool.query(EXTEND, [property_id, days]);
  if (!r.rows[0]) return null;
  const featuredUntil = r.rows[0].featured_until;
  pool.query(
    `SELECT u.email, u.lang, u.name, p.title FROM properties p JOIN users u ON u.id = p.owner_id WHERE p.id = $1`,
    [property_id]).then(({ rows }) => {
    const info = rows[0];
    if (!info) return;
    mailer.mailFeaturedReceipt({
      to: info.email, lang: info.lang, name: info.name, propertyTitle: info.title,
      days, amount, featuredUntil, url: `${mailer.siteUrl()}/annonce/${property_id}`,
    }).catch(() => {});
  }).catch(() => {});
  return featuredUntil;
}

// Attribution par un administrateur : days > 0 prolonge (offert, historisé à 0 DZD), days = 0 retire la mise à la une
async function grant(propertyId, days) {
  if (days === 0) {
    const r = await pool.query('UPDATE properties SET featured_until = NULL WHERE id = $1 RETURNING id', [propertyId]);
    return r.rows[0] ? { featured_until: null } : null;
  }
  const exists = await pool.query('SELECT owner_id FROM properties WHERE id = $1', [propertyId]);
  if (!exists.rows[0]) return null;
  await pool.query(
    `INSERT INTO promotions (property_id, owner_id, days, amount, provider, status, paid_at) VALUES ($1, $2, $3, 0, 'admin', 'paid', now())`,
    [propertyId, exists.rows[0].owner_id, days]);
  const r = await pool.query(EXTEND, [propertyId, days]);
  return { featured_until: r.rows[0].featured_until };
}

module.exports = { plans, enabled, activate, grant, MAX_DAYS, DEFAULT_PRICES, payments };
