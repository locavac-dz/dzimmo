// ── SEO : URL d'annonces, balises meta / Open Graph, sitemap, robots ─────────
// Le front est une SPA : on sert index.html avec un <head> adapté à la page
// demandée pour que les moteurs de recherche et les aperçus de partage
// (WhatsApp, Facebook…) voient le titre, la description et la photo.
const fs   = require('fs');
const crypto = require('crypto');
const path = require('path');
const db   = require('./db');
const WILAYAS = require('./wilayas');
const agencyData  = require('./agency');
const projectData = require('./projects');

const INDEX = path.join(__dirname, '..', 'public', 'index.html');

// Annonces dont la page publique n'existe pas (retirée, en attente ou refusée de modération)
const NOT_PUBLIC = ['archived', 'pending', 'rejected'];

const DEFAULT_TITLE = 'DzImmo — Immobilier en Algérie';
const DEFAULT_DESC  = 'Trouvez ou publiez des annonces immobilières en Algérie : appartements, villas, locaux, terrains à vendre ou à louer.';

const TYPES = {
  appartement: 'Appartement', villa: 'Villa', maison: 'Maison', bureau: 'Bureau',
  local_commercial: 'Local commercial', terrain: 'Terrain', ferme: 'Ferme', entrepot: 'Entrepôt',
};
const MODES = { vente: 'à vendre', location_longue: 'à louer', location_courte: 'en location saisonnière' };

// ── Pages de recherche indexables : /<mode>[/<type>][/<wilaya>] ──────────────
// Ex. /vente/appartements/oran, /location/alger, /location-saisonniere
const MODE_SLUG = { vente: 'vente', location_longue: 'location', location_courte: 'location-saisonniere' };
const TYPE_SLUG = {
  appartement: 'appartements', villa: 'villas', maison: 'maisons', bureau: 'bureaux',
  local_commercial: 'locaux-commerciaux', terrain: 'terrains', ferme: 'fermes', entrepot: 'entrepots',
};
const TYPE_PLURAL = {
  appartement: 'Appartements', villa: 'Villas', maison: 'Maisons', bureau: 'Bureaux',
  local_commercial: 'Locaux commerciaux', terrain: 'Terrains', ferme: 'Fermes', entrepot: 'Entrepôts',
};

// ── Utilitaires ──────────────────────────────────────────────────────────────
const escHtml = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtPrice = n => Number(n).toLocaleString('fr-DZ').replace(/[\u202f\u00a0]/g, ' ');

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

const landingPath = ({ mode, type, wilaya }) =>
  '/' + [MODE_SLUG[mode], type && TYPE_SLUG[type], wilaya && WILAYA_SLUG.get(wilaya)].filter(Boolean).join('/');

const landingLabel = ({ mode, type, wilaya }) =>
  `${type ? TYPE_PLURAL[type] : 'Biens immobiliers'} ${MODES[mode]}${wilaya ? ' à ' + wilaya : ''}`;

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
const versions = new Map();   // fichier -> { mtime, v }
function assetVersion(file) {
  let st;
  try { st = fs.statSync(path.join(PUBLIC_DIR, file)); } catch { return null; }
  const known = versions.get(file);
  if (known && known.mtime === st.mtimeMs) return known.v;
  const v = crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC_DIR, file))).digest('hex').slice(0, 10);
  versions.set(file, { mtime: st.mtimeMs, v });
  return v;
}
const versionAssets = html => html.replace(/(src|href)="\/([\w.-]+\.(?:js|css))"/g, (m, attr, file) => {
  const v = assetVersion(file);
  return v ? `${attr}="/${file}?v=${v}"` : m;
});

// Remplace title + description de index.html et insère les balises SEO
function render({ title, description, canonical, image, robots, jsonLd, nav, landing }) {
  // Sans photo propre à la page : visuel de marque (généré par `npm run build-brand`)
  const isDefaultImage = !image;
  image = image || new URL(canonical).origin + '/og-default.png';
  const tags = [
    `<title>${escHtml(title)}</title>`,
    `<meta name="description" content="${escHtml(description)}">`,
    `<link rel="canonical" href="${escHtml(canonical)}">`,
    robots ? `<meta name="robots" content="${robots}">` : '',
    '<meta property="og:site_name" content="DzImmo">',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="fr_DZ">',
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

// ── Contenu SEO d'une annonce ────────────────────────────────────────────────
function propertyMeta(p, base) {
  const type   = TYPES[p.type_bien] || 'Bien';
  const mode   = MODES[p.mode] || '';
  const place  = [p.commune, p.wilaya].filter(Boolean).join(', ');
  const price  = fmtPrice(p.price) + ' DZD' + (p.mode === 'vente' ? '' : '/mois');
  const facts  = [`${type} ${mode}`.trim(), place, p.surface_m2 && `${Number(p.surface_m2)} m²`,
                  p.rooms && `${p.rooms} pièces`, price].filter(Boolean).join(' · ');
  const description = truncate(p.description ? `${facts} — ${p.description}` : facts, 160);
  const title = `${truncate(p.title, 55)} — ${price} | DzImmo`;
  const canonical = base + propertyPath(p);

  const photos = (Array.isArray(p.photos) && p.photos.length ? p.photos : [p.image])
    .filter(Boolean).slice(0, 5).map(u => absolute(base, u));
  const image = photos[0] || null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: p.title,
    description: truncate(p.description || facts, 300),
    url: canonical,
    datePosted: p.created_at ? new Date(p.created_at).toISOString() : undefined,
    image: photos.length ? photos : undefined,
    contentLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', streetAddress: p.address || undefined,
                 addressLocality: p.commune || undefined, addressRegion: p.wilaya, addressCountry: 'DZ' },
      geo: p.lat != null && p.lng != null
        ? { '@type': 'GeoCoordinates', latitude: Number(p.lat), longitude: Number(p.lng) } : undefined,
    },
    offers: {
      '@type': 'Offer', price: Number(p.price), priceCurrency: 'DZD',
      availability: p.status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
    },
  };
  return { title, description, canonical, image, jsonLd,
           robots: p.status === 'active' ? null : 'noindex,follow' };  // vendu / loué : hors index
}

// ── Contenu SEO d'une vitrine (agence ou promoteur) ──────────────────────────
function agencyMeta(a, base) {
  const promoter = a.kind === 'promoteur';
  const label = promoter ? 'Promoteur immobilier' : 'Agence immobilière';
  const count = Number(a.property_count);
  const facts = `${label} à ${a.wilaya}` + (count ? ` · ${count} annonce${count > 1 ? 's' : ''}` : '') +
    (a.review_count ? ` · note ${a.rating}/5 (${a.review_count} avis)` : '');
  const description = truncate(a.tagline || a.description ? `${facts} — ${a.tagline || a.description}` : facts, 160);
  const canonical = base + agencyPath(a);
  const image = absolute(base, a.cover || a.logo);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': promoter ? 'Organization' : 'RealEstateAgent',
    name: a.name, url: canonical,
    description: truncate(a.description || a.tagline || facts, 300),
    image: image || undefined, logo: absolute(base, a.logo) || undefined,
    telephone: a.phone || undefined,
    foundingDate: a.founded_year ? String(a.founded_year) : undefined,
    address: { '@type': 'PostalAddress', streetAddress: a.address || undefined, addressLocality: a.commune || undefined,
               addressRegion: a.wilaya, addressCountry: 'DZ' },
    areaServed: [...new Set([a.wilaya, ...(Array.isArray(a.coverage) ? a.coverage : [])])],
    sameAs: [a.website, a.facebook, a.instagram].filter(Boolean),
    aggregateRating: a.review_count ? { '@type': 'AggregateRating', ratingValue: a.rating, reviewCount: a.review_count, bestRating: 5 } : undefined,
  };
  return { title: `${truncate(a.name, 50)} — ${label} à ${a.wilaya} | DzImmo`, description, canonical, image, jsonLd };
}

const PROJECT_STATUS = { sur_plan: 'Sur plan', en_construction: 'En construction', livre: 'Livré' };

function projectMeta(j, base) {
  const delivery = j.delivery_year
    ? (j.status === 'livre' ? `livré en ${j.delivery_year}` : `livraison ${j.delivery_quarter ? 'T' + j.delivery_quarter + ' ' : ''}${j.delivery_year}`) : '';
  const facts = [`Programme neuf à ${[j.commune, j.wilaya].filter(Boolean).join(', ')}`, PROJECT_STATUS[j.status], delivery,
    j.price_from != null && `à partir de ${fmtPrice(j.price_from)} DZD`, `par ${j.agency_name}`].filter(Boolean).join(' · ');
  const photos = (Array.isArray(j.photos) && j.photos.length ? j.photos : [j.image]).filter(Boolean).slice(0, 5).map(u => absolute(base, u));
  const canonical = base + projectPath(j);
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'ApartmentComplex',
    name: j.name, description: truncate(j.description || facts, 300), url: canonical,
    image: photos.length ? photos : undefined,
    address: { '@type': 'PostalAddress', streetAddress: j.address || undefined, addressLocality: j.commune || undefined,
               addressRegion: j.wilaya, addressCountry: 'DZ' },
    numberOfAccommodationUnits: j.total_units || undefined,
    numberOfAvailableAccommodationUnits: Number(j.available_count),
  };
  return { title: `${truncate(j.name, 55)} — Programme neuf à ${j.wilaya} | DzImmo`,
           description: truncate(j.description ? `${facts} — ${j.description}` : facts, 160), canonical, image: photos[0] || null, jsonLd };
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

const kind = f => (f.type && f.wilaya ? 'tw' : f.type ? 't' : f.wilaya ? 'w' : 'm');
const dataAttrs = f =>
  `data-seo-m="${f.mode}"${f.type ? ` data-seo-t="${f.type}"` : ''}${f.wilaya ? ` data-seo-w="${escHtml(f.wilaya)}"` : ''}`;
const link = (f, withCount) =>
  `<a href="${escHtml(landingPath(f))}" ${dataAttrs(f)}${withCount ? ` data-seo-c="${f.c}"` : ''}>` +
  `${escHtml(landingLabel(f))}${withCount ? ` (${f.c})` : ''}</a>`;

// Colonne « Explorer » du pied de page : liens crawlables vers les pages de recherche
function navHtml(facets) {
  const top = (k, n) => facets.filter(f => kind(f) === k).sort((a, b) => b.c - a.c).slice(0, n);
  const links = [...top('t', 4), ...top('w', 4)];
  if (!links.length) return '';
  return `<div class="footer-col"><h4 data-i18n="ft_explore">Explorer</h4>${links.map(f => link(f)).join('')}</div>`;
}

// ── Sitemap (cache 10 min) ───────────────────────────────────────────────────
let sitemapCache = { at: 0, base: '', xml: '' };

async function buildSitemap(base) {
  const r = await db.pool.query(
    `SELECT id, title, type_bien, mode, wilaya, created_at
       FROM properties WHERE status = 'active' ORDER BY id DESC LIMIT 50000`);
  const facets = await getFacets();
  const pros  = (await agencyData.directory({ per_page: 100, sort: 'recent' })).items;   // 100 : plafond de la pagination
  const progs = (await projectData.list({ per_page: 100 })).items;
  const urls = [`<url><loc>${escHtml(base)}/</loc></url>`,
                ...['/agences', '/promoteurs', '/programmes'].map(u => `<url><loc>${escHtml(base + u)}</loc></url>`),
                ...pros.map(a => `<url><loc>${escHtml(base + agencyPath(a))}</loc></url>`),
                ...progs.map(j => `<url><loc>${escHtml(base + projectPath(j))}</loc></url>`)]
    .concat(facets.map(f => `<url><loc>${escHtml(base + landingPath(f))}</loc></url>`))
    .concat(r.rows.map(p =>
      `<url><loc>${escHtml(base + propertyPath(p))}</loc>` +
      (p.created_at ? `<lastmod>${new Date(p.created_at).toISOString().slice(0, 10)}</lastmod>` : '') + '</url>'));
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n';
}

// Envoi d'une page : ajoute les liens du pied de page (facettes) puis rend le gabarit
async function send(res, opts, status = 200) {
  const facets = await getFacets();
  // no-cache = à valider à chaque visite : l'ETag d'Express répond « 304 » tant que la page n'a pas changé, sans jamais servir une page périmée
  res.status(status).type('html').set('Cache-Control', 'no-cache').send(render({ ...opts, nav: navHtml(facets) }));
}

// ── Page de recherche : /vente/appartements/oran ─────────────────────────────
async function landingPage(req, res, f, base) {
  const where = ['status = \'active\'', 'mode = $1'];
  const args = [f.mode];
  if (f.type)   { args.push(f.type);   where.push(`type_bien = $${args.length}`); }
  if (f.wilaya) { args.push(f.wilaya); where.push(`wilaya = $${args.length}`); }
  const w = where.join(' AND ');

  const [list, agg, facets] = await Promise.all([
    db.pool.query(
      `SELECT id, title, type_bien, mode, wilaya, commune, price, image, created_at
         FROM properties WHERE ${w} ORDER BY created_at DESC LIMIT 24`, args),
    db.pool.query(`SELECT COUNT(*)::int AS c, MIN(price) AS minp FROM properties WHERE ${w}`, args),
    getFacets(),
  ]);
  const items = list.rows;
  const count = agg.rows[0].c;
  const label = landingLabel(f);
  const perMonth = f.mode === 'vente' ? '' : '/mois';
  const canonical = base + landingPath(f);

  const title = count ? `${label} — ${count} annonce${count > 1 ? 's' : ''} | DzImmo` : `${label} | DzImmo`;
  const description = count
    ? `${count} annonce${count > 1 ? 's' : ''} : ${label} sur DzImmo, à partir de ${fmtPrice(agg.rows[0].minp)} DZD${perMonth}. Photos, prix et contact direct avec le propriétaire ou l'agence.`
    : `Aucune annonce pour le moment : ${label}. Créez une alerte ou publiez votre bien sur DzImmo.`;

  // Fil d'Ariane : Accueil > mode > type > wilaya
  const crumbs = [{ name: 'Accueil', path: '/' }, { name: landingLabel({ mode: f.mode }), path: landingPath({ mode: f.mode }) }];
  if (f.type)   crumbs.push({ name: landingLabel({ mode: f.mode, type: f.type }), path: landingPath({ mode: f.mode, type: f.type }) });
  if (f.wilaya) crumbs.push({ name: label, path: landingPath(f) });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', name: label, url: canonical, description },
      { '@type': 'ItemList', numberOfItems: count,
        itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: base + propertyPath(p) })) },
      { '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: base + c.path })) },
    ],
  };

  // « Voir aussi » : pages voisines ayant des annonces
  const same = (a, b) => a.mode === b.mode && (a.type || null) === (b.type || null) && (a.wilaya || null) === (b.wilaya || null);
  const otherMode = facets.filter(x => x.mode !== f.mode && (x.type || null) === (f.type || null) && (x.wilaya || null) === (f.wilaya || null));
  const related = (f.type && f.wilaya)
    ? facets.filter(x => x.mode === f.mode && ((kind(x) === 't' && x.type === f.type) || (kind(x) === 'w' && x.wilaya === f.wilaya)))
    : f.type   ? facets.filter(x => x.mode === f.mode && kind(x) === 'tw' && x.type === f.type)
    : f.wilaya ? facets.filter(x => x.mode === f.mode && kind(x) === 'tw' && x.wilaya === f.wilaya)
    :            facets.filter(x => x.mode === f.mode && (kind(x) === 't' || kind(x) === 'w'));
  const seeAlso = [...related.filter(x => !same(x, f)).sort((a, b) => b.c - a.c).slice(0, 12), ...otherMode];

  const landing =
    `<section id="seo-landing" style="margin:2rem 0;font-size:.9rem;line-height:1.7">` +
    `<h1 ${dataAttrs(f)} style="font-size:1.3rem;font-weight:800;margin-bottom:.5rem">${escHtml(label)}</h1>` +
    `<p style="color:var(--text-muted)">${escHtml(description)}</p>` +
    (items.length ? `<ul style="padding-inline-start:1.2rem">${items.map(p =>
      `<li><a href="${escHtml(propertyPath(p))}">${escHtml(p.title)}</a> — ${escHtml(fmtPrice(p.price))} DZD${perMonth}` +
      `${p.commune || p.wilaya ? ' — ' + escHtml([p.commune, p.wilaya].filter(Boolean).join(', ')) : ''}</li>`).join('')}</ul>` : '') +
    (seeAlso.length ? `<nav aria-label="Voir aussi" style="display:flex;flex-wrap:wrap;gap:.4rem 1rem">${seeAlso.map(x => link(x, true)).join('')}</nav>` : '') +
    `</section>`;

  await send(res, {
    title, description, canonical, jsonLd, landing,
    image: items[0] ? absolute(base, items[0].image) : null,
    robots: count ? null : 'noindex,follow',   // page vide : pas d'indexation
  });
}

// ── Routes (à monter AVANT express.static) ───────────────────────────────────
function mount(app) {
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(
      `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', async (req, res) => {
    const base = baseUrl(req);
    if (sitemapCache.base !== base || Date.now() - sitemapCache.at > 10 * 60 * 1000) {
      sitemapCache = { at: Date.now(), base, xml: await buildSitemap(base) };
    }
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(sitemapCache.xml);
  });

  // Accueil (+ redirection des anciens liens /?p=12 vers l'URL propre)
  app.get(['/', '/index.html'], async (req, res) => {
    const base = baseUrl(req);
    const legacyId = /^\d+$/.test(String(req.query.p || '')) ? Number(req.query.p) : null;
    if (legacyId && !req.query.page) {
      const p = await getProperty(legacyId);
      if (p && !NOT_PUBLIC.includes(p.status)) return res.redirect(301, propertyPath(p));
    }
    await send(res, {
      title: DEFAULT_TITLE, description: DEFAULT_DESC, canonical: base + '/',
      jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'DzImmo', url: base + '/' },
    });
  });

  // Page d'une annonce : /annonce/12-appartement-f4-vue-mer-a-alger
  app.get('/annonce/:slug', async (req, res) => {
    const base = baseUrl(req);
    const m = /^(\d+)(?:-.*)?$/.exec(req.params.slug);
    const p = m ? await getProperty(Number(m[1])) : null;

    if (!p || NOT_PUBLIC.includes(p.status)) {
      // La SPA affiche l'erreur ; les moteurs ne doivent pas indexer ce statut 404
      return send(res, {
        title: 'Annonce introuvable | DzImmo', description: DEFAULT_DESC,
        canonical: base + '/', robots: 'noindex,follow',
      }, 404);
    }
    const canonicalPath = propertyPath(p);
    if (decodeURIComponent(req.path) !== canonicalPath) return res.redirect(301, canonicalPath);
    await send(res, propertyMeta(p, base));
  });

  // Annuaires : le contenu est rendu par la SPA, le serveur fournit titre, description et adresse canonique
  const directories = {
    '/agences':    ['Agences immobilières en Algérie | DzImmo', 'Annuaire des agences immobilières en Algérie : annonces, avis et coordonnées, par wilaya.'],
    '/promoteurs': ['Promoteurs immobiliers en Algérie | DzImmo', 'Promoteurs immobiliers vérifiés en Algérie et leurs programmes neufs : appartements sur plan, en construction ou livrés.'],
    '/programmes': ['Programmes immobiliers neufs en Algérie | DzImmo', 'Programmes neufs en Algérie : résidences sur plan, en construction ou livrées, avec prix à partir de et lots disponibles.'],
  };
  for (const [route, [title, description]] of Object.entries(directories))
    app.get(route, (req, res) => send(res, { title, description, canonical: baseUrl(req) + route }));

  const notFound = (req, res) => send(res, {
    title: 'Page introuvable | DzImmo', description: DEFAULT_DESC, canonical: baseUrl(req) + '/', robots: 'noindex,follow',
  }, 404);

  // Vitrine d'un professionnel : /agence/12-nom ou /promoteur/12-nom (le type doit correspondre, sinon redirection canonique)
  app.get('/:kind(agence|promoteur)/:slug', async (req, res) => {
    const m = /^(\d+)(?:-.*)?$/.exec(req.params.slug);
    const a = m ? await agencyData.profile(Number(m[1])) : null;
    if (!a) return notFound(req, res);
    const canonicalPath = agencyPath(a);
    if (decodeURIComponent(req.path) !== canonicalPath) return res.redirect(301, canonicalPath);
    await send(res, agencyMeta(a, baseUrl(req)));
  });

  // Programme neuf : /programme/5-residence-les-jasmins (masqué tant que le promoteur n'est pas vérifié)
  app.get('/programme/:slug', async (req, res) => {
    const m = /^(\d+)(?:-.*)?$/.exec(req.params.slug);
    const j = m ? await projectData.get(Number(m[1])) : null;
    if (!j) return notFound(req, res);
    const canonicalPath = projectPath(j);
    if (decodeURIComponent(req.path) !== canonicalPath) return res.redirect(301, canonicalPath);
    await send(res, projectMeta(j, baseUrl(req)));
  });

  // Pages de recherche : /vente, /location/alger, /vente/appartements/oran…
  app.get('/:mode(vente|location|location-saisonniere)/:a?/:b?', async (req, res) => {
    const base = baseUrl(req);
    const f = { mode: SLUG_MODE.get(req.params.mode), type: null, wilaya: null };
    for (const seg of [req.params.a, req.params.b].filter(Boolean)) {
      if (SLUG_TYPE.has(seg) && !f.type)            f.type = SLUG_TYPE.get(seg);
      else if (SLUG_WILAYA.has(seg) && !f.wilaya)   f.wilaya = SLUG_WILAYA.get(seg);
      else {
        return send(res, {
          title: 'Page introuvable | DzImmo', description: DEFAULT_DESC,
          canonical: base + '/', robots: 'noindex,follow',
        }, 404);
      }
    }
    // Ordre canonique mode/type/wilaya, sans slash final
    const canonicalPath = landingPath(f);
    if (decodeURIComponent(req.path) !== canonicalPath) return res.redirect(301, canonicalPath);
    await landingPage(req, res, f, base);
  });

  // Chemin trop profond sous /vente, /location… : vraie 404 plutôt que la SPA en 200
  app.get('/:mode(vente|location|location-saisonniere)/*', (req, res) => send(res, {
    title: 'Page introuvable | DzImmo', description: DEFAULT_DESC,
    canonical: baseUrl(req) + '/', robots: 'noindex,follow',
  }, 404));
}

module.exports = { mount, propertyPath, agencyPath, projectPath, slugify, landingPath };
