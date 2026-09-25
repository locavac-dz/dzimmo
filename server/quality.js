// ── Qualité des annonces ─────────────────────────────────────────────────────
// Signaux calculés à la publication et à chaque modification importante :
//   duplicate_own    même annonceur, annonce très semblable (titre ou texte identique, prix à ±5 %) → avertissement
//   duplicate_other  texte identique à celui d'une annonce d'un AUTRE annonceur (copie, arnaque classique) → modération
//   price_low        prix au m² inférieur au quart de la médiane des annonces comparables → modération
//   price_high       prix au m² supérieur à 4 fois cette médiane → modération
// Les signaux « modération » envoient l'annonce en validation même pour un compte de confiance (agence vérifiée) ;
// seuls les administrateurs publient sans contrôle. Les signaux sont stockés à part (listing_quality) : ils ne sont visibles
// que de l'annonceur (avertissement à la publication) et des modérateurs.
const crypto = require('crypto');
const db = require('./db');

const MIN_TEXT = 60;              // caractères normalisés minimum pour comparer deux descriptions
const PRICE_TOLERANCE = 0.05;     // « même prix » = à ±5 %
const LOW_RATIO = 0.25, HIGH_RATIO = 4;
const MIN_LOCAL = 5;              // annonces comparables (même wilaya, mode et type) pour juger un prix
const MIN_NATIONAL = 15;          // à défaut, comparaison à l'échelle du pays (même mode et type)
const DOUBLE_SUBMIT_SECONDS = 120;
const BLOCKING = ['duplicate_other', 'price_low', 'price_high', 'content_bypass'];

// Détection de contact direct dans le corps d'une annonce (contournement de la plateforme)
const PHONE_RE = /(?:0[5-7]\d{8}|\+213\s*[5-7]\d{8}|00\s*213\s*[5-7]\d{8})/;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
const URL_RE   = /https?:\/\/|(?:^|\s)www\.[a-z]/i;

function contentFlags(title, description) {
  const text = String(title || '') + ' ' + String(description || '');
  if (PHONE_RE.test(text)) return 'contact_phone';
  if (EMAIL_RE.test(text)) return 'contact_email';
  if (URL_RE.test(text))   return 'contact_url';
  return null;
}

// Sans accents, casse ni ponctuation ; les lettres arabes sont conservées
const normalize = s => String(s || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
  .replace(/[^a-z0-9\p{Script=Arabic}]+/gu, ' ').trim();

// Empreinte de la description (identique si le texte est identique, aux accents, majuscules et ponctuation près)
function fingerprint(description) {
  const n = normalize(description);
  return n.length >= MIN_TEXT ? crypto.createHash('sha1').update(n).digest('hex') : null;
}

const isBlocking = flags => flags.some(f => BLOCKING.includes(f));

// Prix au m² de l'annonce comparé à la médiane des annonces comparables ; { flag, ppm2, median, sample, scope } ou null
async function priceCheck(c, excludeId) {
  const surface = Number(c.surface_m2), price = Number(c.price);
  if (!(surface > 5) || !(price > 0)) return null;
  const ppm2 = price / surface;
  const stats = async wilaya => (await db.pool.query(
    `SELECT COUNT(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY price::numeric / surface_m2) AS median
       FROM properties
      WHERE status = 'active' AND mode = $1 AND type_bien = $2 AND surface_m2 > 5 AND price > 0 AND id <> $3
        ${wilaya ? 'AND wilaya = $4' : ''}`,
    wilaya ? [c.mode, c.type_bien, excludeId, wilaya] : [c.mode, c.type_bien, excludeId])).rows[0];
  let s = await stats(c.wilaya), scope = 'wilaya';
  if (s.n < MIN_LOCAL) { s = await stats(null); scope = 'pays'; if (s.n < MIN_NATIONAL) return null; }
  const median = Number(s.median);
  if (!(median > 0)) return null;
  const ratio = ppm2 / median;
  return { flag: ratio < LOW_RATIO ? 'price_low' : ratio > HIGH_RATIO ? 'price_high' : null, ppm2: Math.round(ppm2), median: Math.round(median), ratio: +ratio.toFixed(2), sample: s.n, scope };
}

// candidate : { owner_id, title, description, mode, type_bien, wilaya, price, surface_m2 } ; excludeId : annonce en cours de modification
async function assess(c, { excludeId = 0 } = {}) {
  const titleKey = normalize(c.title) || null;
  const fp = fingerprint(c.description);
  const flags = [], details = {};

  const own = await db.pool.query(
    `SELECT p.id, p.title, p.created_at
       FROM properties p JOIN listing_quality q ON q.property_id = p.id
      WHERE p.owner_id = $1 AND p.id <> $2 AND p.status IN ('active', 'pending')
        AND p.mode = $3 AND p.type_bien = $4 AND p.wilaya = $5
        AND ABS(p.price - $6::numeric) <= $6::numeric * $7
        AND (q.title_key = $8 OR ($9::text IS NOT NULL AND q.fingerprint = $9))
      ORDER BY p.id LIMIT 1`,
    [c.owner_id, excludeId, c.mode, c.type_bien, c.wilaya, Number(c.price), PRICE_TOLERANCE, titleKey, fp]);
  let doubleSubmit = false;
  if (own.rows[0]) {
    flags.push('duplicate_own');
    details.duplicate_own = { id: own.rows[0].id, title: own.rows[0].title };
    // Même annonce envoyée deux fois de suite (double clic, réseau lent) : refusée à la publication
    const age = (Date.now() - new Date(own.rows[0].created_at).getTime()) / 1000;
    const same = await db.pool.query(
      'SELECT 1 FROM properties WHERE id = $1 AND price = $2::numeric AND title = $3', [own.rows[0].id, Number(c.price), String(c.title).trim()]);
    doubleSubmit = age < DOUBLE_SUBMIT_SECONDS && same.rowCount > 0;
  }

  if (fp) {
    const other = await db.pool.query(
      `SELECT p.id FROM listing_quality q JOIN properties p ON p.id = q.property_id
        WHERE q.fingerprint = $1 AND p.owner_id <> $2 AND p.id <> $3 AND p.status IN ('active', 'pending') LIMIT 1`,
      [fp, c.owner_id, excludeId]);
    if (other.rows[0]) { flags.push('duplicate_other'); details.duplicate_other = { id: other.rows[0].id }; }
  }

  const price = await priceCheck(c, excludeId);
  if (price) {
    details.price = price;
    if (price.flag) flags.push(price.flag);
  }
  const cf = contentFlags(c.title, c.description);
  if (cf) { flags.push('content_bypass'); details.content_bypass = { reason: cf }; }
  return { flags, details, titleKey, fingerprint: fp, doubleSubmit, blocking: isBlocking(flags) };
}

async function save(propertyId, a) {
  await db.pool.query(
    `INSERT INTO listing_quality (property_id, flags, details, title_key, fingerprint, assessed_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (property_id) DO UPDATE
       SET flags = EXCLUDED.flags, details = EXCLUDED.details, title_key = EXCLUDED.title_key,
           fingerprint = EXCLUDED.fingerprint, assessed_at = NOW()`,
    [propertyId, JSON.stringify(a.flags), JSON.stringify(a.details), a.titleKey, a.fingerprint]);
}

// Avertissements montrés à l'annonceur : jamais l'identité ni le contenu d'une annonce d'un autre annonceur
function warningsFor(a) {
  const w = [];
  if (a.flags.includes('duplicate_own')) w.push({ code: 'duplicate_own', id: a.details.duplicate_own.id, title: a.details.duplicate_own.title });
  if (a.flags.includes('duplicate_other')) w.push({ code: 'duplicate_other' });
  if (a.flags.includes('price_low')) w.push({ code: 'price_low', ratio: a.details.price.ratio });
  if (a.flags.includes('price_high')) w.push({ code: 'price_high', ratio: a.details.price.ratio });
  if (a.flags.includes('content_bypass')) w.push({ code: 'content_bypass' });
  return w;
}

// Annonces publiées avant la détection des doublons : on calcule leur titre normalisé et leur empreinte (sans juger leur prix)
async function backfill(batch = 500) {
  const rows = (await db.pool.query(
    `SELECT p.id, p.title, p.description FROM properties p LEFT JOIN listing_quality q ON q.property_id = p.id
      WHERE q.property_id IS NULL ORDER BY p.id LIMIT $1`, [batch])).rows;
  for (const r of rows)
    await db.pool.query(
      'INSERT INTO listing_quality (property_id, title_key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [r.id, normalize(r.title) || null, fingerprint(r.description)]);
  return rows.length;
}

module.exports = { assess, save, backfill, warningsFor, isBlocking, contentFlags, normalize, fingerprint, BLOCKING, LOW_RATIO, HIGH_RATIO, MIN_LOCAL, MIN_NATIONAL };
