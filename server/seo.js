// ── SEO : URL d'annonces, balises meta / Open Graph, sitemap, robots ─────────
// Le front est une SPA : on sert index.html avec un <head> adapté à la page
// demandée pour que les moteurs de recherche et les aperçus de partage
// (WhatsApp, Facebook…) voient le titre, la description et la photo.
const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const INDEX = path.join(__dirname, '..', 'public', 'index.html');

const DEFAULT_TITLE = 'DzImmo — Immobilier en Algérie';
const DEFAULT_DESC  = 'Trouvez ou publiez des annonces immobilières en Algérie : appartements, villas, locaux, terrains à vendre ou à louer.';

const TYPES = {
  appartement: 'Appartement', villa: 'Villa', maison: 'Maison', bureau: 'Bureau',
  local_commercial: 'Local commercial', terrain: 'Terrain', ferme: 'Ferme', entrepot: 'Entrepôt',
};
const MODES = { vente: 'à vendre', location_longue: 'à louer', location_courte: 'en location saisonnière' };

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

// /annonce/12-appartement-f4-vue-mer-a-alger (titre en arabe : repli sur type-mode-wilaya)
function propertyPath(p) {
  const slug = slugify(p.title) || slugify(`${p.type_bien}-${p.mode}-${p.wilaya}`);
  return `/annonce/${p.id}${slug ? '-' + slug : ''}`;
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

// Remplace title + description de index.html et insère les balises SEO
function render({ title, description, canonical, image, robots, jsonLd }) {
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
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escHtml(title)}">`,
    `<meta name="twitter:description" content="${escHtml(description)}">`,
    image ? `<meta name="twitter:image" content="${escHtml(image)}">` : '',
    jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : '',
  ].filter(Boolean).join('\n  ');

  return template()
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace(/<meta name="description"[^>]*>\s*/, '')
    .replace('<!--SEO_HEAD-->', tags);
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

// ── Sitemap (cache 10 min) ───────────────────────────────────────────────────
let sitemapCache = { at: 0, base: '', xml: '' };

async function buildSitemap(base) {
  const r = await db.pool.query(
    `SELECT id, title, type_bien, mode, wilaya, created_at
       FROM properties WHERE status = 'active' ORDER BY id DESC LIMIT 50000`);
  const urls = [`<url><loc>${escHtml(base)}/</loc></url>`].concat(r.rows.map(p =>
    `<url><loc>${escHtml(base + propertyPath(p))}</loc>` +
    (p.created_at ? `<lastmod>${new Date(p.created_at).toISOString().slice(0, 10)}</lastmod>` : '') + '</url>'));
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n';
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
      if (p && p.status !== 'archived') return res.redirect(301, propertyPath(p));
    }
    res.type('html').send(render({
      title: DEFAULT_TITLE, description: DEFAULT_DESC, canonical: base + '/',
      jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'DzImmo', url: base + '/' },
    }));
  });

  // Page d'une annonce : /annonce/12-appartement-f4-vue-mer-a-alger
  app.get('/annonce/:slug', async (req, res) => {
    const base = baseUrl(req);
    const m = /^(\d+)(?:-.*)?$/.exec(req.params.slug);
    const p = m ? await getProperty(Number(m[1])) : null;

    if (!p || p.status === 'archived') {
      // La SPA affiche l'erreur ; les moteurs ne doivent pas indexer ce statut 404
      return res.status(404).type('html').send(render({
        title: 'Annonce introuvable | DzImmo', description: DEFAULT_DESC,
        canonical: base + '/', robots: 'noindex,follow',
      }));
    }
    const canonicalPath = propertyPath(p);
    if (decodeURIComponent(req.path) !== canonicalPath) return res.redirect(301, canonicalPath);
    res.type('html').send(render(propertyMeta(p, base)));
  });
}

module.exports = { mount, propertyPath, slugify };
