// ── SEO : URL d'annonces, balises meta / Open Graph, hreflang, sitemap, robots ───────────────────────────────
// Le front est une SPA : on sert index.html avec un <head> adapté à la page
// demandée pour que les moteurs de recherche et les aperçus de partage
// (WhatsApp, Facebook…) voient le titre, la description et la photo.
//
// Site bilingue : chaque page indexable existe en français (/vente/oran) et en arabe (/ar/vente/oran, même chemin précédé de « /ar »).
// Les deux versions se renvoient l'une à l'autre par <link rel="alternate" hreflang> et par le sitemap ; les textes viennent de seo-text.js.
const fs   = require('fs');
const crypto = require('crypto');
const path = require('path');
const db   = require('./db');
const WILAYAS = require('./wilayas');
const agencyData  = require('./agency');
const projectData = require('./projects');
const { textOf, fmtPrice } = require('./seo-text');
const fiche = require('./fiche');

const INDEX = path.join(__dirname, '..', 'public', 'index.html');

// Annonces dont la page publique n'existe pas (retirée, en attente ou refusée de modération)
const NOT_PUBLIC = ['archived', 'pending', 'rejected'];

// ── Pages de recherche indexables : /<mode>[/<type>][/<wilaya>] ──────────────
// Ex. /vente/appartements/oran, /location/alger, /location-saisonniere
const MODE_SLUG = { vente: 'vente', location_longue: 'location', location_courte: 'location-saisonniere' };
const TYPE_SLUG = {
  appartement: 'appartements', villa: 'villas', maison: 'maisons', bureau: 'bureaux',
  local_commercial: 'locaux-commerciaux', terrain: 'terrains', ferme: 'fermes', entrepot: 'entrepots',
};

// ── Utilitaires ──────────────────────────────────────────────────────────────
const escHtml = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function truncate(s, max) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

// Tables inverses en Map : pas de collision avec les clés de Object.prototype (« constructor »…)
const invert = o => new Map(Object.entries(o).map(([k, v]) => [v, k]));
const SLUG_MODE = invert(MODE_SLUG);
const SLUG_TYPE = invert(TYPE_SLUG);
const WILAYA_SLUG = new Map(WILAYAS.map(w => [w, slugify(w)]));
const SLUG_WILAYA = invert(Object.fromEntries(WILAYA_SLUG));

// ── Langues : « /ar » devant le chemin français ──────────────────────────────
// Les chemins calculés ci-dessous (propertyPath, landingPath…) sont ceux de la version française ; localized() donne celui d'une langue.
const AR_PREFIX = /^\/ar(?=\/|$)/i;
const arPath = p => '/ar' + (p === '/' ? '' : p);
const localized = (lang, p) => lang === 'ar' ? arPath(p) : p;
const langOfReq = req => AR_PREFIX.test(req.path) ? 'ar' : 'fr';
const plainPath = req => req.path.replace(AR_PREFIX, '') || '/';           // chemin français équivalent à celui demandé
const bothLangs = routes => routes.flatMap(r => [r, arPath(r)]);
const versions = (base, p) => ({ fr: base + p, ar: base + arPath(p) });     // adresses absolues des deux versions d'une page

// Une commune n'a pas de référentiel : c'est le texte saisi par les annonceurs. Sa page est /<mode>[/<type>]/<wilaya>/<commune>, où le
// dernier segment est le slug du texte (slugify) ; les variantes de saisie (« Bab Ezzouar », « bab-ezzouar ») partagent le même slug.
const landingPath = ({ mode, type, wilaya, commune }) =>
  '/' + [MODE_SLUG[mode], type && TYPE_SLUG[type], wilaya && WILAYA_SLUG.get(wilaya), wilaya && commune && slugify(commune)].filter(Boolean).join('/');

const landingLabel = ({ mode, type, wilaya, commune }, lang = 'fr') => {
  const t = textOf(lang);
  const place = wilaya && commune ? ` ${t.in} ${commune}${t.sep}${t.wilaya(wilaya)}` : wilaya ? ` ${t.in} ${t.wilaya(wilaya)}` : '';
  return `${type ? t.typePlural[type] : t.all} ${t.mode[mode]}${place}`;
};

// /annonce/12-appartement-f4-vue-mer-a-alger (titre en arabe : repli sur type-mode-wilaya)
function propertyPath(p) {
  const slug = slugify(p.title) || slugify(`${p.type_bien}-${p.mode}-${p.wilaya}`);
  return `/annonce/${p.id}${slug ? '-' + slug : ''}`;
}

// /agence/12-agence-horizon-alger, /promoteur/7-residences-el-amel : le type de professionnel fait partie de l'adresse
function agencyPath(a) {
  const slug = slugify(a.name);
  return `/${a.kind === 'promoteur' ? 'promoteur' : 'agence'}/${a.id}${slug ? '-' + slug : ''}`;
}
// /programme/5-residence-les-jasmins
function projectPath(p) {
  const slug = slugify(p.name);
  return `/programme/${p.id}${slug ? '-' + slug : ''}`;
}

const baseUrl = req =>
  (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

const absolute = (base, url) =>
  !url ? null : /^https?:\/\//i.test(url) ? url : base + (url.startsWith('/') ? '' : '/') + url;

// Lecture du gabarit avec rechargement automatique si le fichier change
let cache = { mtime: 0, html: '' };
function template() {
  const m = fs.statSync(INDEX).mtimeMs;
  if (m !== cache.mtime) cache = { mtime: m, html: fs.readFileSync(INDEX, 'utf8') };
  return cache.html;
}

// Adresses versionnées des scripts et feuilles de style : /pro.js → /pro.js?v=<empreinte du contenu>. L'adresse change dès que le fichier
// change, ce qui permet de les mettre en cache un an (voir staticCache dans app.js) sans jamais servir une version périmée.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const assetVersions = new Map();   // fichier -> { mtime, v }
function assetVersion(file) {
  let st;
  try { st = fs.statSync(path.join(PUBLIC_DIR, file)); } catch { return null; }
  const known = assetVersions.get(file);
  if (known && known.mtime === st.mtimeMs) return known.v;
  const v = crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC_DIR, file))).digest('hex').slice(0, 10);
  assetVersions.set(file, { mtime: st.mtimeMs, v });
  return v;
}
const versionAssets = html => html.replace(/(src|href)="\/([\w.-]+\.(?:js|css))"/g, (m, attr, file) => {
  const v = assetVersion(file);
  return v ? `${attr}="/${file}?v=${v}"` : m;
});

// Remplace title + description de index.html et insère les balises SEO
//   lang       : 'fr' | 'ar' (langue de cette version de la page : <html lang dir>, og:locale)
//   alternates : { fr, ar } adresses absolues des deux versions ; absent = page non indexable (404, retirée…), aucun hreflang
function render({ title, description, canonical, image, robots, jsonLd, nav, landing, lang = 'fr', alternates }) {
  const t = textOf(lang), other = textOf(lang === 'ar' ? 'fr' : 'ar');
  // Sans photo propre à la page : visuel de marque (généré par `npm run build-brand`)
  const isDefaultImage = !image;
  image = image || new URL(canonical).origin + '/og-default.png';
  const tags = [
    `<title>${escHtml(title)}</title>`,
    `<meta name="description" content="${escHtml(description)}">`,
    `<link rel="canonical" href="${escHtml(canonical)}">`,
    alternates ? `<link rel="alternate" hreflang="fr" href="${escHtml(alternates.fr)}">` : '',
    alternates ? `<link rel="alternate" hreflang="ar" href="${escHtml(alternates.ar)}">` : '',
    alternates ? `<link rel="alternate" hreflang="x-default" href="${escHtml(alternates.fr)}">` : '',
    robots ? `<meta name="robots" content="${robots}">` : '',
    '<meta property="og:site_name" content="DzImmo">',
    '<meta property="og:type" content="website">',
    `<meta property="og:locale" content="${t.locale}">`,
    alternates ? `<meta property="og:locale:alternate" content="${other.locale}">` : '',
    `<meta property="og:title" content="${escHtml(title)}">`,
    `<meta property="og:description" content="${escHtml(description)}">`,
    `<meta property="og:url" content="${escHtml(canonical)}">`,
    image ? `<meta property="og:image" content="${escHtml(image)}">` : '',
    isDefaultImage ? '<meta property="og:image:width" content="1200">' : '',
    isDefaultImage ? '<meta property="og:image:height" content="630">' : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escHtml(title)}">`,
    `<meta name="twitter:description" content="${escHtml(description)}">`,
    image ? `<meta name="twitter:image" content="${escHtml(image)}">` : '',
    jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : '',
  ].filter(Boolean).join('\n  ');

  return versionAssets(template())
    .replace(/<html lang="fr">/, `<html lang="${t.lang}" dir="${t.dir}">`)
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta name="description"[^>]*>\s*/, '')
    .replace('<!--SEO_HEAD-->', () => tags)
    .replace('<!--SEO_NAV-->', () => nav || '')
    .replace('<!--SEO_LANDING-->', () => landing || '');
}

async function getProperty(id) {
  const r = await db.pool.query('SELECT * FROM properties WHERE id = $1', [id]);
  return r.rows[0] || null;
}

// Fil d'Ariane (BreadcrumbList) : crumbs = [{ name, path }] avec des chemins français, localisés ici
const breadcrumb = (base, lang, crumbs) => ({
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: base + localized(lang, c.path) })),
});

// ── Contenu SEO d'une annonce ────────────────────────────────────────────────
function propertyMeta(p, base, lang = 'fr') {
  const t      = textOf(lang);
  const type   = t.type[p.type_bien] || (lang === 'ar' ? 'عقار' : 'Bien');
  const mode   = t.mode[p.mode] || '';
  const wilaya = t.wilaya(p.wilaya);
  const place  = [p.commune, wilaya].filter(Boolean).join(t.sep);
  const price  = t.price(p.price, p.mode);
  const facts  = [`${type} ${mode}`.trim(), place, p.surface_m2 && t.area(Number(p.surface_m2)),
                  p.rooms && t.rooms(p.rooms), price].filter(Boolean).join(' · ');
  const description = truncate(p.description ? `${facts} — ${p.description}` : facts, 160);
  const title = t.propertyTitle(truncate(p.title, 55), price);
  const canonical = base + localized(lang, propertyPath(p));

  const photos = (Array.isArray(p.photos) && p.photos.length ? p.photos : [p.image])
    .filter(Boolean).slice(0, 5).map(u => absolute(base, u));
  const image = photos[0] || null;
  const indexable = p.status === 'active';

  // Fil d'Ariane : Accueil > mode > type > wilaya > annonce (uniquement les niveaux connus du référentiel)
  const crumbs = [{ name: t.home, path: '/' }];
  if (MODE_SLUG[p.mode]) {
    crumbs.push({ name: landingLabel({ mode: p.mode }, lang), path: landingPath({ mode: p.mode }) });
    const ty = TYPE_SLUG[p.type_bien] ? p.type_bien : null, wi = WILAYA_SLUG.has(p.wilaya) ? p.wilaya : null;
    if (ty) crumbs.push({ name: landingLabel({ mode: p.mode, type: ty }, lang), path: landingPath({ mode: p.mode, type: ty }) });
    if (wi) crumbs.push({ name: landingLabel({ mode: p.mode, type: ty, wilaya: wi }, lang), path: landingPath({ mode: p.mode, type: ty, wilaya: wi }) });
  }
  crumbs.push({ name: p.title, path: propertyPath(p) });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: p.title,
    description: truncate(p.description || facts, 300),
    url: canonical,
    inLanguage: lang,
    datePosted: p.created_at ? new Date(p.created_at).toISOString() : undefined,
    image: photos.length ? photos : undefined,
    breadcrumb: breadcrumb(base, lang, crumbs),
    contentLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', streetAddress: p.address || undefined,
                 addressLocality: p.commune || undefined, addressRegion: wilaya, addressCountry: 'DZ' },
      geo: p.lat != null && p.lng != null
        ? { '@type': 'GeoCoordinates', latitude: Number(p.lat), longitude: Number(p.lng) } : undefined,
    },
    offers: {
      '@type': 'Offer', price: Number(p.price), priceCurrency: 'DZD',
      availability: indexable ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
    },
    accommodationFloorPlan: (p.rooms || p.surface_m2) ? {
      '@type': 'FloorPlan',
      numberOfRooms: p.rooms ? Number(p.rooms) : undefined,
      floorSize: p.surface_m2 ? { '@type': 'QuantitativeValue', value: Number(p.surface_m2), unitCode: 'MTK' } : undefined,
    } : undefined,
  };
  return { lang, title, description, canonical, image, jsonLd,
           alternates: indexable ? versions(base, propertyPath(p)) : undefined,
           robots: indexable ? null : 'noindex,follow' };  // vendu / loué : hors index
}

// ── Contenu SEO d'une vitrine (agence ou promoteur) ──────────────────────────
function agencyMeta(a, base, lang = 'fr') {
  const t = textOf(lang);
  const promoter = a.kind === 'promoteur';
  const label = t.agencyLabel(promoter);
  const facts = t.agencyFacts(label, a);
  const description = truncate(a.tagline || a.description ? `${facts} — ${a.tagline || a.description}` : facts, 160);
  const canonical = base + localized(lang, agencyPath(a));
  const image = absolute(base, a.cover || a.logo);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': promoter ? 'Organization' : 'RealEstateAgent',
    name: a.name, url: canonical, inLanguage: lang,
    description: truncate(a.description || a.tagline || facts, 300),
    image: image || undefined, logo: absolute(base, a.logo) || undefined,
    telephone: a.phone || undefined,
    foundingDate: a.founded_year ? String(a.founded_year) : undefined,
    address: { '@type': 'PostalAddress', streetAddress: a.address || undefined, addressLocality: a.commune || undefined,
               addressRegion: t.wilaya(a.wilaya), addressCountry: 'DZ' },
    areaServed: [...new Set([a.wilaya, ...(Array.isArray(a.coverage) ? a.coverage : [])])].map(t.wilaya),
    sameAs: [a.website, a.facebook, a.instagram].filter(Boolean),
    aggregateRating: a.review_count ? { '@type': 'AggregateRating', ratingValue: a.rating, reviewCount: a.review_count, bestRating: 5 } : undefined,
  };
  return { lang, title: t.agencyTitle(truncate(a.name, 50), label, t.wilaya(a.wilaya)), description, canonical, image, jsonLd,
           alternates: versions(base, agencyPath(a)) };
}

function projectMeta(j, base, lang = 'fr') {
  const t = textOf(lang);
  const place = [j.commune, t.wilaya(j.wilaya)].filter(Boolean).join(t.sep);
  const facts = t.projectFacts(j, place, t.projectStatus[j.status], t.projectDelivery(j));
  const photos = (Array.isArray(j.photos) && j.photos.length ? j.photos : [j.image]).filter(Boolean).slice(0, 5).map(u => absolute(base, u));
  const canonical = base + localized(lang, projectPath(j));
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'ApartmentComplex',
    name: j.name, description: truncate(j.description || facts, 300), url: canonical, inLanguage: lang,
    image: photos.length ? photos : undefined,
    address: { '@type': 'PostalAddress', streetAddress: j.address || undefined, addressLocality: j.commune || undefined,
               addressRegion: t.wilaya(j.wilaya), addressCountry: 'DZ' },
    numberOfAccommodationUnits: j.total_units || undefined,
    numberOfAvailableAccommodationUnits: Number(j.available_count),
  };
  return { lang, title: t.projectTitle(truncate(j.name, 55), t.wilaya(j.wilaya)),
           description: truncate(j.description ? `${facts} — ${j.description}` : facts, 160), canonical, image: photos[0] || null, jsonLd,
           alternates: versions(base, projectPath(j)) };
}

// ── Facettes : combinaisons mode / type / wilaya ayant au moins une annonce ──
// Sert au sitemap, aux liens du pied de page et aux « voir aussi » (cache 10 min).
const TEN_MIN = 10 * 60 * 1000;
let facetCache = { at: 0, rows: [] };

async function getFacets() {
  if (Date.now() - facetCache.at < TEN_MIN) return facetCache.rows;
  const r = await db.pool.query(
    `SELECT mode, type_bien AS type, wilaya, COUNT(*)::int AS c
       FROM properties WHERE status = 'active'
      GROUP BY GROUPING SETS ((mode), (mode, type_bien), (mode, wilaya), (mode, type_bien, wilaya))`);
  // On écarte les valeurs hors référentiel (ancien libellé de wilaya, type inconnu…)
  const rows = r.rows.filter(f => MODE_SLUG[f.mode]
    && (!f.type || TYPE_SLUG[f.type]) && (!f.wilaya || WILAYA_SLUG.has(f.wilaya)));
  facetCache = { at: Date.now(), rows };
  return rows;
}

// ── Communes ─────────────────────────────────────────────────────────────────
// Texte libre : on regroupe par (wilaya, slug) et on garde comme libellé la saisie la plus fréquente (à égalité, l'ordre alphabétique :
// le libellé ne dépend ni de l'ordre des lignes ni du cache). Une commune sans lettre latine (slug vide) n'a pas de page.
const COMMUNE_MIN = 2;              // annonces actives minimum pour qu'une page de commune soit indexable et figure au sitemap
const COMMUNE_SITEMAP_MAX = 5000;   // pages de communes au sitemap (les plus fournies d'abord) : reste sous la limite de 50 000 adresses

function pickLabel(variants) {      // [{ commune, c }] -> libellé retenu
  return [...variants].sort((a, b) => b.c - a.c || (a.commune < b.commune ? -1 : 1))[0].commune.trim();
}

// Commune d'une wilaya reconnue par son slug (annonces actives, tous modes) ; null si aucune annonce ne la porte
async function resolveCommune(wilaya, slug) {
  const r = await db.pool.query(
    `SELECT commune, COUNT(*)::int AS c FROM properties
      WHERE status = 'active' AND wilaya = $1 AND commune IS NOT NULL GROUP BY commune`, [wilaya]);
  const same = r.rows.filter(x => slugify(x.commune) === slug);
  return same.length ? { label: pickLabel(same), variants: same.map(x => x.commune) } : null;
}

let communeCache = { at: 0, rows: [] };
async function getCommunes() {
  if (Date.now() - communeCache.at < TEN_MIN) return communeCache.rows;
  const r = await db.pool.query(
    `SELECT mode, type_bien AS type, wilaya, commune, COUNT(*)::int AS c
       FROM properties WHERE status = 'active' AND commune IS NOT NULL AND btrim(commune) <> ''
      GROUP BY GROUPING SETS ((mode, wilaya, commune), (mode, type_bien, wilaya, commune))
      ORDER BY c DESC LIMIT 20000`);
  const ok = r.rows.filter(x => MODE_SLUG[x.mode] && (!x.type || TYPE_SLUG[x.type]) && WILAYA_SLUG.has(x.wilaya) && slugify(x.commune));
  // Libellé par (wilaya, slug), d'après les lignes « tous types » : les saisies sont comptées une fois par mode
  const seen = new Map();
  for (const x of ok.filter(x => !x.type)) {
    const k = x.wilaya + '|' + slugify(x.commune), v = seen.get(k) || new Map();
    v.set(x.commune, (v.get(x.commune) || 0) + x.c);
    seen.set(k, v);
  }
  const label = new Map([...seen].map(([k, v]) => [k, pickLabel([...v].map(([commune, c]) => ({ commune, c })))]));
  const merged = new Map();
  for (const x of ok) {
    const name = label.get(x.wilaya + '|' + slugify(x.commune));
    if (!name) continue;
    const k = [x.mode, x.type || '', x.wilaya, slugify(name)].join('|');
    const row = merged.get(k) || { mode: x.mode, type: x.type || null, wilaya: x.wilaya, commune: name, c: 0 };
    row.c += x.c;
    merged.set(k, row);
  }
  const rows = [...merged.values()].sort((a, b) => b.c - a.c);
  communeCache = { at: Date.now(), rows };
  return rows;
}

const kind = f => (f.type && f.wilaya ? 'tw' : f.type ? 't' : f.wilaya ? 'w' : 'm');
const dataAttrs = f =>
  `data-seo-m="${f.mode}"${f.type ? ` data-seo-t="${f.type}"` : ''}${f.wilaya ? ` data-seo-w="${escHtml(f.wilaya)}"` : ''}` +
  `${f.commune ? ` data-seo-k="${escHtml(f.commune)}"` : ''}`;
const link = (f, withCount, lang = 'fr') =>
  `<a href="${escHtml(localized(lang, landingPath(f)))}" ${dataAttrs(f)}${withCount ? ` data-seo-c="${f.c}"` : ''}>` +
  `${escHtml(landingLabel(f, lang))}${withCount ? ` (${f.c})` : ''}</a>`;

// Colonne « Explorer » du pied de page : liens crawlables vers les pages de recherche
function navHtml(facets, lang = 'fr') {
  const top = (k, n) => facets.filter(f => kind(f) === k).sort((a, b) => b.c - a.c).slice(0, n);
  const links = [...top('t', 4), ...top('w', 4)];
  if (!links.length) return '';
  return `<div class="footer-col"><h4 data-i18n="ft_explore">${lang === 'ar' ? 'استكشف' : 'Explorer'}</h4>${links.map(f => link(f, false, lang)).join('')}</div>`;
}

// ── Sitemaps (cache 10 min) ──────────────────────────────────────────────────
// /sitemap.xml est un index : /sitemap-pages.xml (accueil, annuaires, vitrines, programmes, pages de recherche) et
// /sitemap-annonces-<n>.xml (les annonces, par tranches). Chaque page figure dans ses deux langues, avec ses alternates hreflang ;
// un fichier de sitemap ne dépasse jamais 50 000 adresses (limite du protocole) : d'où les tranches de SITEMAP_PROPERTIES annonces × 2 langues.
const SITEMAP_PROPERTIES = 20000;
const sitemapCache = new Map();   // "base|fichier" -> { at, xml }
const cachedSitemap = async (base, file, build) => {
  const key = `${base}|${file}`, known = sitemapCache.get(key);
  if (known && Date.now() - known.at < TEN_MIN) return known.xml;
  const xml = await build();
  sitemapCache.set(key, { at: Date.now(), xml });
  return xml;
};

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const urlset = urls => `${XML_HEAD}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;

// Une page = deux <url> (français, arabe), chacun listant les deux versions et x-default
function sitemapEntries(base, p, lastmod) {
  const v = versions(base, p);
  const alt = [['fr', v.fr], ['ar', v.ar], ['x-default', v.fr]]
    .map(([l, href]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${escHtml(href)}"/>`).join('');
  return ['fr', 'ar'].map(l => `<url><loc>${escHtml(v[l])}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${alt}</url>`);
}

async function buildPagesSitemap(base) {
  const facets = await getFacets();
  const pros  = (await agencyData.directory({ per_page: 100, sort: 'recent' })).items;   // 100 : plafond de la pagination
  const progs = (await projectData.list({ per_page: 100 })).items;
  const communes = (await getCommunes()).filter(x => x.c >= COMMUNE_MIN).slice(0, COMMUNE_SITEMAP_MAX);
  const pages = ['/', '/agences', '/promoteurs', '/programmes',
                 ...pros.map(agencyPath), ...progs.map(projectPath), ...facets.map(landingPath), ...communes.map(landingPath)];
  return urlset(pages.flatMap(p => sitemapEntries(base, p)));
}

async function buildPropertiesSitemap(base, n) {
  const r = await db.pool.query(
    `SELECT id, title, type_bien, mode, wilaya, created_at
       FROM properties WHERE status = 'active' ORDER BY id DESC LIMIT $1 OFFSET $2`, [SITEMAP_PROPERTIES, (n - 1) * SITEMAP_PROPERTIES]);
  return urlset(r.rows.flatMap(p =>
    sitemapEntries(base, propertyPath(p), p.created_at ? new Date(p.created_at).toISOString().slice(0, 10) : null)));
}

async function buildSitemapIndex(base) {
  const c = (await db.pool.query(`SELECT COUNT(*)::int AS c FROM properties WHERE status = 'active'`)).rows[0].c;
  const files = ['sitemap-pages.xml', ...Array.from({ length: Math.ceil(c / SITEMAP_PROPERTIES) }, (_, i) => `sitemap-annonces-${i + 1}.xml`)];
  return `${XML_HEAD}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    files.map(f => `<sitemap><loc>${escHtml(`${base}/${f}`)}</loc></sitemap>`).join('\n') + '\n</sitemapindex>\n';
}

// Envoi d'une page : ajoute les liens du pied de page (facettes) puis rend le gabarit
async function send(res, opts, status = 200) {
  const lang = opts.lang || 'fr';
  const facets = await getFacets();
  // no-cache = à valider à chaque visite : l'ETag d'Express répond « 304 » tant que la page n'a pas changé, sans jamais servir une page périmée
  res.status(status).type('html').set('Cache-Control', 'no-cache').set('Content-Language', lang)
    .send(render({ ...opts, lang, nav: navHtml(facets, lang) }));
}

// ── Page de recherche : /vente/appartements/oran ─────────────────────────────
async function landingPage(req, res, f, base, lang) {
  const t = textOf(lang);
  const where = ['status = \'active\'', 'mode = $1'];
  const args = [f.mode];
  if (f.type)   { args.push(f.type);   where.push(`type_bien = $${args.length}`); }
  if (f.wilaya) { args.push(f.wilaya); where.push(`wilaya = $${args.length}`); }
  if (f.commune) { args.push(f.variants); where.push(`commune = ANY($${args.length})`); }   // toutes les saisies de la commune
  const w = where.join(' AND ');

  const [list, agg, facets, communes] = await Promise.all([
    db.pool.query(
      `SELECT id, title, type_bien, mode, wilaya, commune, price, image, created_at
         FROM properties WHERE ${w} ORDER BY created_at DESC LIMIT 24`, args),
    db.pool.query(`SELECT COUNT(*)::int AS c, MIN(price) AS minp FROM properties WHERE ${w}`, args),
    getFacets(),
    getCommunes(),
  ]);
  const items = list.rows;
  const count = agg.rows[0].c;
  const label = landingLabel(f, lang);
  const canonical = base + localized(lang, landingPath(f));

  const indexable = f.commune ? count >= COMMUNE_MIN : count > 0;
  const title = t.landingTitle(label, count);
  const description = t.landingDesc(label, count, agg.rows[0].minp, f.mode);

  // Fil d'Ariane : Accueil > mode > type > wilaya
  const crumbs = [{ name: t.home, path: '/' }, { name: landingLabel({ mode: f.mode }, lang), path: landingPath({ mode: f.mode }) }];
  if (f.type)   crumbs.push({ name: landingLabel({ mode: f.mode, type: f.type }, lang), path: landingPath({ mode: f.mode, type: f.type }) });
  if (f.wilaya) crumbs.push({ name: f.commune ? landingLabel({ mode: f.mode, type: f.type, wilaya: f.wilaya }, lang) : label,
                             path: landingPath({ mode: f.mode, type: f.type, wilaya: f.wilaya }) });
  if (f.commune) crumbs.push({ name: label, path: landingPath(f) });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', name: label, url: canonical, description, inLanguage: lang },
      { '@type': 'ItemList', numberOfItems: count,
        itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: base + localized(lang, propertyPath(p)) })) },
      breadcrumb(base, lang, crumbs),
    ],
  };

  // « Voir aussi » : pages voisines ayant des annonces
  const same = (a, b) => a.mode === b.mode && (a.type || null) === (b.type || null) && (a.wilaya || null) === (b.wilaya || null)
    && (a.commune ? slugify(a.commune) : null) === (b.commune ? slugify(b.commune) : null);
  const otherMode = f.commune ? [] : facets.filter(x => x.mode !== f.mode && (x.type || null) === (f.type || null) && (x.wilaya || null) === (f.wilaya || null));
  const inCommune = x => x.c >= COMMUNE_MIN && x.wilaya === f.wilaya;
  const related = f.commune
    // Page de commune : la wilaya, puis la même commune sous d'autres types et d'autres modes
    ? [...facets.filter(x => x.mode === f.mode && (x.type || null) === (f.type || null) && x.wilaya === f.wilaya),
       ...communes.filter(x => inCommune(x) && slugify(x.commune) === slugify(f.commune))
         .sort((a, b) => (b.mode === f.mode) - (a.mode === f.mode) || b.c - a.c)]
    : (f.type && f.wilaya)
    ? facets.filter(x => x.mode === f.mode && ((kind(x) === 't' && x.type === f.type) || (kind(x) === 'w' && x.wilaya === f.wilaya)))
    : f.type   ? facets.filter(x => x.mode === f.mode && kind(x) === 'tw' && x.type === f.type)
    : f.wilaya ? facets.filter(x => x.mode === f.mode && kind(x) === 'tw' && x.wilaya === f.wilaya)
    :            facets.filter(x => x.mode === f.mode && (kind(x) === 't' || kind(x) === 'w'));
  // Page de wilaya : ses communes les plus fournies (même mode, même type)
  const topCommunes = f.wilaya && !f.commune
    ? communes.filter(x => inCommune(x) && x.mode === f.mode && (x.type || null) === (f.type || null)).slice(0, 12) : [];
  const seeAlso = f.commune
    ? related.filter(x => !same(x, f)).slice(0, 12)
    : [...related.filter(x => !same(x, f)).sort((a, b) => b.c - a.c).slice(0, 12), ...topCommunes, ...otherMode];

  const landing =
    `<section id="seo-landing" style="margin:2rem 0;font-size:.9rem;line-height:1.7">` +
    `<h1 ${dataAttrs(f)} style="font-size:1.3rem;font-weight:800;margin-bottom:.5rem">${escHtml(label)}</h1>` +
    `<p style="color:var(--text-muted)">${escHtml(description)}</p>` +
    (items.length ? `<ul style="padding-inline-start:1.2rem">${items.map(p =>
      `<li><a href="${escHtml(localized(lang, propertyPath(p)))}">${escHtml(p.title)}</a> — ${escHtml(t.price(p.price, f.mode))}` +
      `${p.commune || p.wilaya ? ' — ' + escHtml([p.commune, t.wilaya(p.wilaya)].filter(Boolean).join(t.sep)) : ''}</li>`).join('')}</ul>` : '') +
    (seeAlso.length ? `<nav aria-label="${escHtml(t.seeAlso)}" style="display:flex;flex-wrap:wrap;gap:.4rem 1rem">${seeAlso.map(x => link(x, true, lang)).join('')}</nav>` : '') +
    `</section>`;

  await send(res, {
    lang, title, description, canonical, jsonLd, landing,
    image: items[0] ? absolute(base, items[0].image) : null,
    // Page vide : pas d'indexation ; commune à une seule annonce : contenu trop mince, pas d'indexation non plus
    alternates: indexable ? versions(base, landingPath(f)) : undefined,
    robots: indexable ? null : 'noindex,follow',
  });
}

// ── Routes (à monter AVANT express.static) ───────────────────────────────────
function mount(app) {
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(
      `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /newsletter/\nDisallow: /ar/newsletter/\nDisallow: /favoris-partages/\nDisallow: /ar/favoris-partages/\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
  });

  const sendXml = (res, xml) => res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(xml);
  app.get('/sitemap.xml', async (req, res) => {
    const base = baseUrl(req);
    sendXml(res, await cachedSitemap(base, 'index', () => buildSitemapIndex(base)));
  });
  app.get('/sitemap-pages.xml', async (req, res) => {
    const base = baseUrl(req);
    sendXml(res, await cachedSitemap(base, 'pages', () => buildPagesSitemap(base)));
  });
  app.get('/sitemap-annonces-:n.xml', async (req, res, next) => {
    const base = baseUrl(req), n = /^[1-9]\d{0,3}$/.test(req.params.n) ? Number(req.params.n) : 0;
    if (!n) return next();
    const xml = await cachedSitemap(base, `annonces-${n}`, () => buildPropertiesSitemap(base, n));
    if (n > 1 && !xml.includes('<url>')) return next();      // tranche vide : le fichier n'existe pas
    sendXml(res, xml);
  });

  // Accueil (+ redirection des anciens liens /?p=12 vers l'URL propre)
  app.get(['/', '/index.html', '/ar'], async (req, res) => {
    const base = baseUrl(req), lang = langOfReq(req), t = textOf(lang);
    const legacyId = /^\d+$/.test(String(req.query.p || '')) ? Number(req.query.p) : null;
    if (legacyId && !req.query.page) {
      const p = await getProperty(legacyId);
      if (p && !NOT_PUBLIC.includes(p.status)) return res.redirect(301, localized(lang, propertyPath(p)));
    }
    const home = base + localized(lang, '/');
    await send(res, {
      lang, title: t.homeTitle, description: t.homeDesc, canonical: home, alternates: versions(base, '/'),
      jsonLd: { '@context': 'https://schema.org', '@graph': [
        { '@type': 'WebSite', name: 'DzImmo', url: home, inLanguage: lang },
        { '@type': 'Organization', name: 'DzImmo', url: base + '/', logo: base + '/apple-touch-icon.png' },
      ] },
    });
  });

  // Page d'une annonce : /annonce/12-appartement-f4-vue-mer-a-alger
  app.get(bothLangs(['/annonce/:slug']), async (req, res) => {
    const base = baseUrl(req), lang = langOfReq(req);
    const m = /^(\d+)(?:-.*)?$/.exec(req.params.slug);
    const p = m ? await getProperty(Number(m[1])) : null;

    if (!p || NOT_PUBLIC.includes(p.status)) {
      // La SPA affiche l'erreur ; les moteurs ne doivent pas indexer ce statut 404
      return send(res, {
        lang, title: textOf(lang).listingNotFound, description: textOf(lang).homeDesc,
        canonical: base + localized(lang, '/'), robots: 'noindex,follow',
      }, 404);
    }
    const canonicalPath = localized(lang, propertyPath(p));
    if (decodeURIComponent(req.path) !== canonicalPath) return res.redirect(301, canonicalPath);
    await send(res, propertyMeta(p, base, lang));
  });

  // Fiche imprimable : /annonce/12-appartement-f4/fiche (page A4 avec QR code, rendue par server/fiche.js). Jamais indexée ;
  // même règle que la page de l'annonce : introuvable ou non publique = 404, mauvais slug = redirection canonique.
  app.get(bothLangs(['/annonce/:slug/fiche']), async (req, res) => {
    const base = baseUrl(req), lang = langOfReq(req);
    const m = /^(\d+)(?:-.*)?$/.exec(req.params.slug);
    const p = m ? await fiche.load(Number(m[1])) : null;
    if (!p || NOT_PUBLIC.includes(p.status)) {
      return send(res, {
        lang, title: textOf(lang).listingNotFound, description: textOf(lang).homeDesc,
        canonical: base + localized(lang, '/'), robots: 'noindex,follow',
      }, 404);
    }
    const pagePath = localized(lang, propertyPath(p));
    if (decodeURIComponent(req.path) !== pagePath + '/fiche') return res.redirect(301, pagePath + '/fiche');
    res.set({ 'Cache-Control': 'no-cache', 'Content-Language': lang, 'X-Robots-Tag': 'noindex, nofollow' })
      .type('html').send(fiche.render(p, { lang, pageUrl: base + pagePath, backPath: pagePath }));
  });

  // Annuaires : le contenu est rendu par la SPA, le serveur fournit titre, description et adresse canonique
  for (const route of ['/agences', '/promoteurs', '/programmes'])
    app.get(bothLangs([route]), (req, res) => {
      const lang = langOfReq(req), base = baseUrl(req), [title, description] = textOf(lang).directories[route];
      return send(res, { lang, title, description, canonical: base + localized(lang, route), alternates: versions(base, route) });
    });

  // Liens des emails de la newsletter (confirmation, désinscription) : la SPA lit ?e= et ?t= puis appelle l'API. Jamais indexés, et
  // le jeton ne part dans aucun en-tête Referer. La page ne fait rien à l'ouverture pour une désinscription (un robot qui suit le lien
  // ne désabonne personne) : c'est le bouton de la page qui appelle l'API.
  const newsletterPages = { '/newsletter/confirmation': 'newsletterConfirm', '/newsletter/desinscription': 'newsletterUnsub' };
  for (const [route, key] of Object.entries(newsletterPages))
    app.get(bothLangs([route]), (req, res) => {
      const lang = langOfReq(req), t = textOf(lang);
      res.set('Referrer-Policy', 'no-referrer');
      return send(res, { lang, title: t[key], description: t.homeDesc, canonical: baseUrl(req) + localized(lang, '/'), robots: 'noindex,nofollow' });
    });

  const notFound = (req, res) => {
    const lang = langOfReq(req);
    return send(res, { lang, title: textOf(lang).notFound, description: textOf(lang).homeDesc,
                       canonical: baseUrl(req) + localized(lang, '/'), robots: 'noindex,follow' }, 404);
  };

  // Vitrine d'un professionnel : /agence/12-nom ou /promoteur/12-nom (le type doit correspondre, sinon redirection canonique)
  app.get(bothLangs(['/agence/:slug', '/promoteur/:slug']), async (req, res) => {
    const lang = langOfReq(req);
    const m = /^(\d+)(?:-.*)?$/.exec(req.params.slug);
    const a = m ? await agencyData.profile(Number(m[1])) : null;
    if (!a) return notFound(req, res);
    const canonicalPath = localized(lang, agencyPath(a));
    if (decodeURIComponent(req.path) !== canonicalPath) return res.redirect(301, canonicalPath);
    await send(res, agencyMeta(a, baseUrl(req), lang));
  });

  // Programme neuf : /programme/5-residence-les-jasmins (masqué tant que le promoteur n'est pas vérifié)
  app.get(bothLangs(['/programme/:slug']), async (req, res) => {
    const lang = langOfReq(req);
    const m = /^(\d+)(?:-.*)?$/.exec(req.params.slug);
    const j = m ? await projectData.get(Number(m[1])) : null;
    if (!j) return notFound(req, res);
    const canonicalPath = localized(lang, projectPath(j));
    if (decodeURIComponent(req.path) !== canonicalPath) return res.redirect(301, canonicalPath);
    await send(res, projectMeta(j, baseUrl(req), lang));
  });

  // Pages de recherche : /vente, /location/alger, /vente/appartements/oran… (et /ar/vente…)
  // Chemins écrits un par un : Express 5 n'accepte plus ni expression régulière ni « ? » dans un motif de route.
  const MODE_ROOTS = [...SLUG_MODE.keys()].map(m => '/' + m);
  const modeOf = req => plainPath(req).split('/')[1].toLowerCase();
  app.get(bothLangs(MODE_ROOTS.flatMap(r => [r, r + '/:a', r + '/:a/:b', r + '/:a/:b/:c'])), async (req, res) => {
    const base = baseUrl(req), lang = langOfReq(req);
    const f = { mode: SLUG_MODE.get(modeOf(req)), type: null, wilaya: null, commune: null, variants: null };
    // Forme canonique : [type/][wilaya/][commune]. « wilaya puis type » (ancienne forme) reste acceptée et redirigée ; /VENTE/Oran → 301 aussi.
    const segs = [req.params.a, req.params.b, req.params.c].filter(Boolean).map(x => x.toLowerCase());
    let i = 0;
    if (SLUG_TYPE.has(segs[i])) f.type = SLUG_TYPE.get(segs[i++]);
    if (i < segs.length) {
      if (!SLUG_WILAYA.has(segs[i])) return notFound(req, res);
      f.wilaya = SLUG_WILAYA.get(segs[i++]);
    }
    if (i < segs.length && i === segs.length - 1 && !f.type && SLUG_TYPE.has(segs[i])) f.type = SLUG_TYPE.get(segs[i++]);
    if (i < segs.length) {                                    // dernier segment : la commune (une saisie connue de cette wilaya)
      const c = i === segs.length - 1 ? await resolveCommune(f.wilaya, segs[i]) : null;
      if (!c) return notFound(req, res);
      f.commune = c.label; f.variants = c.variants;
    }
    // Ordre canonique mode/type/wilaya, sans slash final
    const canonicalPath = localized(lang, landingPath(f));
    if (decodeURIComponent(req.path) !== canonicalPath) return res.redirect(301, canonicalPath);
    await landingPage(req, res, f, base, lang);
  });

  // Chemin trop profond sous /vente, /location… : vraie 404 plutôt que la SPA en 200
  app.get(bothLangs(MODE_ROOTS.map(r => r + '/:a/:b/*rest')), notFound);

  // Page tendances du marché — indexée, bilingue
  app.get(bothLangs(['/tendances']), (req, res) => {
    const lang = langOfReq(req), base = baseUrl(req), t = textOf(lang);
    const title = t.marketTitle, description = t.marketDesc;
    return send(res, {
      lang, title, description,
      canonical: base + localized(lang, '/tendances'),
      alternates: versions(base, '/tendances'),
    });
  });

  // Profil public d'un vendeur — jamais indexé (contenu utilisateur, page SPA)
  app.get(bothLangs(['/vendeur/:id']), (req, res) => {
    const lang = langOfReq(req);
    res.set('Referrer-Policy', 'no-referrer');
    return send(res, { lang, title: textOf(lang).vendeurTitle, description: textOf(lang).homeDesc,
                       canonical: baseUrl(req) + localized(lang, '/'), robots: 'noindex,nofollow' });
  });

  // Favoris partagés — jamais indexés (contenu utilisateur, token dans l'URL)
  app.get(bothLangs(['/favoris-partages/:token']), (req, res) => {
    const lang = langOfReq(req), t = textOf(lang);
    res.set('Referrer-Policy', 'no-referrer');
    return send(res, { lang, title: t.sharedFavsTitle, description: t.homeDesc,
                       canonical: baseUrl(req) + localized(lang, '/'), robots: 'noindex,nofollow' });
  });
}

module.exports = { mount, propertyPath, agencyPath, projectPath, slugify, landingPath, landingLabel, localized, SITEMAP_PROPERTIES };
