// ── Programmes neufs des promoteurs ──────────────────────────────────────────────────────────────────────────────
// Un programme (résidence, lotissement…) regroupe des lots, qui sont des annonces ordinaires rattachées par properties.project_id.
// Prix « à partir de », lots disponibles et vendus se calculent depuis ces annonces : le promoteur ne les saisit jamais, ils
// ne peuvent donc pas diverger des annonces. Seuls les promoteurs dont le registre de commerce / l'agrément est vérifié
// (agencies.verified) publient un programme : c'est ce qui tient lieu de modération, un programme trompeur étant plus coûteux
// qu'une annonce isolée. Si la vérification est retirée, les programmes disparaissent du site sans être supprimés.
const db      = require('./db');
const WILAYAS = require('./wilayas');
const { paginate } = require('./pagination');
const search = require('./search');

const STATUSES = ['sur_plan', 'en_construction', 'livre'];
// Équipements de la résidence (libellés FR / AR dans public/index.html)
const FEATURES = ['ascenseur', 'parking', 'espaces_verts', 'securite', 'aire_jeux', 'commerces', 'gaz_ville', 'fibre'];

const { UPLOAD_PATH: IMAGE_PATH } = require('./images');   // règle unique des images envoyées sur ce site
const MAX_PHOTOS = 12;

const text = (v, max) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return s.length > max ? undefined : (s || null);
};
const image = v => { const s = text(v, 300); return s === null || s === undefined ? s : (IMAGE_PATH.test(s) ? s : undefined); };

// Valide le corps d'une création ou d'une modification : { values } ou { error }
function cleanProject(body, { creating = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const values = {};
  const has = k => b[k] !== undefined;
  const bad = error => ({ error });

  if (creating && (!b.name || !b.wilaya)) return bad('Nom et wilaya requis.');
  if (has('name')) {
    const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
    if (name.length < 2 || name.length > 120) return bad('Nom du programme invalide (2 à 120 caractères).');
    values.name = name;
  }
  if (has('wilaya')) {
    if (!WILAYAS.includes(b.wilaya)) return bad('Wilaya invalide.');
    values.wilaya = b.wilaya;
  }
  for (const [k, max] of [['description', 3000], ['commune', 80], ['address', 200]]) {
    if (!has(k)) continue;
    const v = text(b[k], max);
    if (v === undefined) return bad('Texte trop long.');
    values[k] = v;
  }
  if (has('status')) {
    if (!STATUSES.includes(b.status)) return bad('Avancement du programme invalide.');
    values.status = b.status;
  }
  const int = (raw, min, max) => {
    if (raw === null || raw === '') return null;
    const n = typeof raw === 'number' || (typeof raw === 'string' && /^\d{1,4}$/.test(raw)) ? Number(raw) : NaN;
    return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
  };
  const year = new Date().getFullYear();
  if (has('delivery_year')) {
    const v = int(b.delivery_year, 2000, year + 15);
    if (v === undefined) return bad('Date de livraison invalide.');
    values.delivery_year = v;
  }
  if (has('delivery_quarter')) {
    const v = int(b.delivery_quarter, 1, 4);
    if (v === undefined) return bad('Date de livraison invalide.');
    values.delivery_quarter = v;
  }
  if (has('total_units')) {
    const v = int(b.total_units, 1, 5000);
    if (v === undefined) return bad('Nombre de lots invalide.');
    values.total_units = v;
  }
  if (has('image')) {
    const v = image(b.image);
    if (v === undefined) return bad('Image invalide : envoyez-la depuis le formulaire.');
    values.image = v;
  }
  if (has('photos')) {
    const ph = b.photos;
    if (!Array.isArray(ph) || ph.length > MAX_PHOTOS || ph.some(x => typeof x !== 'string' || !IMAGE_PATH.test(x)))
      return bad('Image invalide : envoyez-la depuis le formulaire.');
    values.photos = JSON.stringify([...new Set(ph)]);
    if (!has('image')) values.image = ph[0] || null;   // la première photo sert de visuel
  }
  if (has('features')) {
    const f = b.features;
    if (!Array.isArray(f) || f.length > FEATURES.length || f.some(x => typeof x !== 'string' || !FEATURES.includes(x)))
      return bad('Équipements invalides.');
    values.features = JSON.stringify([...new Set(f)]);
  }
  return { values };
}

// ── Lecture ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const FROM = `projects j
  JOIN agencies a ON a.id = j.agency_id
  JOIN users u ON u.id = a.owner_id
  LEFT JOIN (SELECT project_id,
                    COUNT(*) FILTER (WHERE status = 'active')::int AS available,
                    COUNT(*) FILTER (WHERE status IN ('sold', 'rented'))::int AS sold,
                    MIN(price) FILTER (WHERE status = 'active') AS price_from
               FROM properties WHERE project_id IS NOT NULL GROUP BY project_id) l ON l.project_id = j.id`;

const COLUMNS = `j.id, j.agency_id, j.name, j.description, j.wilaya, j.commune, j.address, j.status, j.delivery_year, j.delivery_quarter,
  j.total_units, j.image, j.photos, j.features, j.created_at,
  a.name AS agency_name, a.logo AS agency_logo, a.kind AS agency_kind, a.phone AS agency_phone, COALESCE(a.verified, false) AS agency_verified,
  COALESCE(l.available, 0) AS available_count, COALESCE(l.sold, 0) AS sold_count, l.price_from`;

// Visible du public : promoteur vérifié et non suspendu
const VISIBLE = 'COALESCE(a.verified, false) = true AND u.banned IS NOT TRUE';

const SORTS = {
  recent: 'j.created_at DESC, j.id DESC',
  price:  'l.price_from ASC NULLS LAST, j.id DESC',
  name:   'LOWER(j.name), j.id',
};

// Liste publique : filtres wilaya, status, agency_id, q ; { items, total, page, pages, per_page }
async function list(query = {}) {
  const conds = [VISIBLE];
  const params = [];
  const arg = val => { params.push(val); return '$' + params.length; };
  if (WILAYAS.includes(query.wilaya)) conds.push(`j.wilaya = ${arg(query.wilaya)}`);
  if (STATUSES.includes(query.status)) conds.push(`j.status = ${arg(query.status)}`);
  const aid = db.toId(query.agency_id);
  if (aid !== null) conds.push(`j.agency_id = ${arg(aid)}`);
  const text = search.condition(query.q, 's.text', ['j.name', 'j.commune'], arg);   // recherche tolérante (server/search.js)
  if (text) conds.push(`EXISTS (SELECT 1 FROM project_search s WHERE s.project_id = j.id AND ${text})`);
  return paginate(db.pool, {
    columns: COLUMNS, from: FROM, where: 'WHERE ' + conds.join(' AND '), params,
    orderBy: SORTS[query.sort] || SORTS.recent, query, defaut: 12,
  });
}

// Un programme : { …, visible } ; null si inconnu, ou masqué et demandé par un autre que son propriétaire.
async function get(id, viewerId = null) {
  const n = db.toId(id);
  if (n === null) return null;
  const r = await db.pool.query(
    `SELECT ${COLUMNS}, a.owner_id AS _owner, (${VISIBLE}) AS visible FROM ${FROM} WHERE j.id = $1`, [n]);
  const row = r.rows[0];
  if (!row) return null;
  const mine = viewerId !== null && row._owner === viewerId;
  if (!row.visible && !mine) return null;
  delete row._owner;
  return { ...row, is_mine: mine };
}

// Programmes de l'agence d'un compte, y compris masqués (le propriétaire voit tout)
async function ofOwner(userId) {
  const r = await db.pool.query(
    `SELECT ${COLUMNS}, (${VISIBLE}) AS visible FROM ${FROM} WHERE a.owner_id = $1 ORDER BY j.created_at DESC, j.id DESC`, [userId]);
  return r.rows;
}

module.exports = { STATUSES, FEATURES, cleanProject, list, get, ofOwner };
