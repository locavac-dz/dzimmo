// ── Vitrine des agences et des promoteurs : validation du profil et requêtes de l'annuaire ────────────────────────
// Le profil est saisi par le professionnel et affiché publiquement (logo, liens, texte) : tout est validé ici, une seule fois,
// pour la création comme pour la modification. Les images ne viennent que de notre propre envoi (/uploads/…), les liens
// sont limités à http(s) et les réseaux sociaux à leur domaine : aucune adresse arbitraire n'atteint un attribut src ou href.
const db      = require('./db');
const WILAYAS = require('./wilayas');
const { paginate } = require('./pagination');
const search = require('./search');

const KINDS    = ['agence', 'promoteur'];
// Services proposés (libellés FR / AR dans public/index.html)
const SERVICES = ['vente', 'location', 'location_courte', 'neuf', 'gestion', 'estimation', 'accompagnement'];

const { UPLOAD_PATH: IMAGE_PATH } = require('./images');   // règle unique des images envoyées sur ce site
const MAX = { name: 80, tagline: 120, description: 3000, hours: 200, address: 200, commune: 80, url: 200, coverage: 20 };

// Texte libre : sans caractères de contrôle, espaces de bord retirés ; undefined si trop long ; null si vide
function text(v, max) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (s.length > max) return undefined;
  return s || null;
}

// Adresse web : http(s) uniquement, sans identifiants ; « exemple.dz » devient « https://exemple.dz/ »
function webUrl(v) {
  const s = text(v, MAX.url);
  if (s === null || s === undefined) return s;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); } catch { return undefined; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') || u.username || u.password) return undefined;
  return u.href;
}

// Réseau social : identifiant (« @agence.horizon ») ou adresse sur le domaine du réseau
function social(v, host) {
  const s = text(v, MAX.url);
  if (s === null || s === undefined) return s;
  if (/^@?[A-Za-z0-9._-]{1,60}$/.test(s)) return `https://www.${host}/${s.replace(/^@/, '')}`;
  const url = webUrl(s);
  if (!url) return undefined;
  const h = new URL(url).hostname.toLowerCase();
  return h === host || h.endsWith('.' + host) ? url : undefined;
}

// Image : uniquement un fichier déjà envoyé sur ce site (POST /api/upload)
function image(v) {
  const s = text(v, 300);
  if (s === null || s === undefined) return s;
  return IMAGE_PATH.test(s) ? s : undefined;
}

const list = (v, allowed, max) => {
  if (!Array.isArray(v) || v.length > max || v.some(x => typeof x !== 'string' || !allowed.includes(x))) return undefined;
  return [...new Set(v)];
};

// Valide le corps d'une création (creating) ou d'une modification : { values } (colonnes prêtes à écrire) ou { error }.
// Seuls les champs présents sont retenus à la modification.
function cleanProfile(body, { creating = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const values = {};
  const has = k => b[k] !== undefined;
  const bad = error => ({ error });

  if (creating && (!b.name || !b.wilaya)) return bad('Nom et wilaya requis.');
  if (has('name')) {
    const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim() : '';
    if (name.length < 2 || name.length > MAX.name) return bad("Nom invalide (2 à 80 caractères).");
    values.name = name;
  }
  if (has('kind')) {
    if (!KINDS.includes(b.kind)) return bad('Type de professionnel invalide.');
    values.kind = b.kind;
  }
  if (has('wilaya')) {
    if (!WILAYAS.includes(b.wilaya)) return bad('Wilaya invalide.');
    values.wilaya = b.wilaya;
  }
  for (const [k, max] of [['description', MAX.description], ['tagline', MAX.tagline], ['hours', MAX.hours], ['address', MAX.address], ['commune', MAX.commune]]) {
    if (!has(k)) continue;
    const v = text(b[k], max);
    if (v === undefined) return bad('Texte trop long.');
    values[k] = v;
  }
  if (has('phone')) {
    const v = text(b.phone, 30);
    if (v === undefined || (v !== null && (!/^\+?[\d\s().-]+$/.test(v) || v.replace(/\D/g, '').length < 6 || v.replace(/\D/g, '').length > 15)))
      return bad('Numéro de téléphone invalide.');
    values.phone = v;
  }
  if (has('website')) {
    const v = webUrl(b.website);
    if (v === undefined) return bad('Adresse web invalide (http:// ou https:// attendu).');
    values.website = v;
  }
  for (const [k, host] of [['facebook', 'facebook.com'], ['instagram', 'instagram.com']]) {
    if (!has(k)) continue;
    const v = social(b[k], host);
    if (v === undefined) return bad('Lien de réseau social invalide.');
    values[k] = v;
  }
  for (const k of ['logo', 'cover']) {
    if (!has(k)) continue;
    const v = image(b[k]);
    if (v === undefined) return bad("Image invalide : envoyez-la depuis le formulaire.");
    values[k] = v;
  }
  if (has('founded_year')) {
    const raw = b.founded_year;
    if (raw === null || raw === '') values.founded_year = null;
    else {
      const n = typeof raw === 'number' || (typeof raw === 'string' && /^\d{4}$/.test(raw)) ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 1900 || n > new Date().getFullYear()) return bad('Année de création invalide.');
      values.founded_year = n;
    }
  }
  if (has('services')) {
    const v = list(b.services, SERVICES, SERVICES.length);
    if (!v) return bad('Services ou zones invalides.');
    values.services = JSON.stringify(v);
  }
  if (has('coverage')) {
    const v = list(b.coverage, WILAYAS, MAX.coverage);
    if (!v) return bad('Services ou zones invalides.');
    values.coverage = JSON.stringify(v);
  }
  return { values };
}

// ── Lecture publique ─────────────────────────────────────────────────────────────────────────────────────────────────
// Une agence dont le propriétaire est suspendu disparaît de l'annuaire. Compteurs et note se calculent en une requête
// (agrégats joints), la note étant la moyenne des avis laissés sur les annonces de l'agence.
const FROM = `agencies a
  JOIN users u ON u.id = a.owner_id
  LEFT JOIN (SELECT agency_id,
                    COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                    COUNT(*) FILTER (WHERE status IN ('sold', 'rented'))::int AS done
               FROM properties WHERE agency_id IS NOT NULL GROUP BY agency_id) pc ON pc.agency_id = a.id
  LEFT JOIN (SELECT p.agency_id, COUNT(*)::int AS n, ROUND(AVG(r.rating)::numeric, 1)::float AS avg
               FROM reviews r JOIN properties p ON p.id = r.property_id
              WHERE p.agency_id IS NOT NULL GROUP BY p.agency_id) rv ON rv.agency_id = a.id
  LEFT JOIN (SELECT p.agency_id, COUNT(*)::int AS n
               FROM projects p GROUP BY p.agency_id) pj ON pj.agency_id = a.id`;

const COLUMNS = `a.id, a.name, a.kind, a.tagline, a.description, a.logo, a.cover, a.wilaya, a.commune, a.address, a.phone,
  a.website, a.facebook, a.instagram, a.hours, a.founded_year, a.services, a.coverage, a.created_at,
  COALESCE(a.verified, false) AS verified,
  COALESCE(pc.active, 0) AS property_count, COALESCE(pc.done, 0) AS done_count,
  COALESCE(rv.n, 0) AS review_count, rv.avg AS rating,
  CASE WHEN COALESCE(a.verified, false) THEN COALESCE(pj.n, 0) ELSE 0 END AS project_count`;

const SORTS = {
  // Les professionnels vérifiés d'abord, puis les plus actifs, puis les mieux notés
  relevance: 'COALESCE(a.verified, false) DESC, COALESCE(pc.active, 0) DESC, rv.avg DESC NULLS LAST, LOWER(a.name), a.id',
  listings:  'COALESCE(pc.active, 0) DESC, LOWER(a.name), a.id',
  rating:    'rv.avg DESC NULLS LAST, COALESCE(rv.n, 0) DESC, LOWER(a.name), a.id',
  recent:    'a.created_at DESC, a.id DESC',
  name:      'LOWER(a.name), a.id',
};

// Annuaire : { items, total, page, pages, per_page, kinds: { agence, promoteur } } ; filtres kind, wilaya, service, q, verified, sort
async function directory(query = {}) {
  const conds = ['u.banned IS NOT TRUE'];
  const params = [];
  // Les valeurs viennent de la requête : jamais dans le SQL, toujours en paramètre (et limitées aux listes connues)
  const arg = val => { params.push(val); return '$' + params.length; };

  if (KINDS.includes(query.kind)) conds.push(`a.kind = ${arg(query.kind)}`);
  if (WILAYAS.includes(query.wilaya)) {
    const w = arg(query.wilaya);   // établie dans la wilaya, ou y intervient (zones couvertes)
    conds.push(`(a.wilaya = ${w} OR a.coverage @> to_jsonb(${w}::text))`);
  }
  if (SERVICES.includes(query.service)) conds.push(`a.services @> to_jsonb(${arg(query.service)}::text)`);
  if (query.verified === '1' || query.verified === 'true') conds.push('COALESCE(a.verified, false) = true');
  // Recherche tolérante (accents, arabe, français ↔ arabe) sur nom, slogan, commune, adresse, wilaya, type de professionnel, présentation
  const text = search.condition(query.q, 's.text', ['a.name', 'a.tagline', 'a.commune'], arg);
  if (text) conds.push(`EXISTS (SELECT 1 FROM agency_search s WHERE s.agency_id = a.id AND ${text})`);

  const result = await paginate(db.pool, {
    columns: COLUMNS, from: FROM, where: 'WHERE ' + conds.join(' AND '), params,
    orderBy: SORTS[query.sort] || SORTS.relevance, query, defaut: 12,
  });
  // Effectifs par type (onglets Agences / Promoteurs) : tous les professionnels visibles, quels que soient les autres filtres
  const k = await db.pool.query(
    `SELECT a.kind, COUNT(*)::int AS n FROM agencies a JOIN users u ON u.id = a.owner_id WHERE u.banned IS NOT TRUE GROUP BY a.kind`);
  const kinds = { agence: 0, promoteur: 0 };
  for (const r of k.rows) kinds[r.kind] = r.n;
  return { ...result, kinds };
}

// Fiche d'un professionnel : profil + chiffres + répartition des annonces + derniers avis ; null si inconnu ou suspendu
async function profile(id, viewerId = null) {
  const n = db.toId(id);
  if (n === null) return null;
  const r = await db.pool.query(`SELECT ${COLUMNS}, a.owner_id AS _owner FROM ${FROM} WHERE a.id = $1 AND u.banned IS NOT TRUE`, [n]);
  const a = r.rows[0];
  if (!a) return null;
  a.is_mine = viewerId !== null && a._owner === viewerId;   // le propriétaire voit « Modifier » ; l'identifiant du compte reste privé
  delete a._owner;
  const [types, modes, reviews] = await Promise.all([
    db.pool.query(`SELECT type_bien AS key, COUNT(*)::int AS n FROM properties WHERE agency_id = $1 AND status = 'active' GROUP BY type_bien ORDER BY n DESC, type_bien`, [n]),
    db.pool.query(`SELECT mode AS key, COUNT(*)::int AS n FROM properties WHERE agency_id = $1 AND status = 'active' GROUP BY mode ORDER BY n DESC, mode`, [n]),
    db.pool.query(
      `SELECT r.rating::float AS rating, r.comment, r.created_at, split_part(u.name, ' ', 1) AS author_name,
              p.id AS property_id, p.title AS property_title
         FROM reviews r JOIN properties p ON p.id = r.property_id LEFT JOIN users u ON u.id = r.author_id
        WHERE p.agency_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT 6`, [n]),
  ]);
  return { ...a, types: types.rows, modes: modes.rows, reviews: reviews.rows };
}

module.exports = { KINDS, SERVICES, WILAYAS_MAX: MAX.coverage, cleanProfile, directory, profile };
