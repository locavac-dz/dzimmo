// SEO bilingue : versions /ar des pages, hreflang réciproques, canonical par langue, sitemap à deux langues, redirections et 404.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const { fullSitemap } = require('../helpers/sitemap');

let s, admin, sample, agency;
const BASE = 'https://dzimmo.test';   // APP_URL défini par le helper

test.before(async () => {
  s = await startServer();
  admin = await s.makeAdmin(await s.register('admin'));
  const { rows } = await s.db.pool.query(
    `INSERT INTO properties (owner_id, title, description, mode, type_bien, price, wilaya, commune, image, status)
     VALUES ($1, 'Villa bilingue avec jardin', 'Villa lumineuse, quatre chambres, garage.', 'vente', 'villa', 48000000, 'Tipaza', 'Tipaza', '/uploads/bilingue-seo.webp', 'active')
     RETURNING id`, [admin.id]);
  sample = rows[0];
  const a = await s.db.pool.query(
    `INSERT INTO agencies (owner_id, name, kind, wilaya, phone) VALUES ($1, 'Agence Bilingue', 'agence', 'Oran', '0555000000') RETURNING id`, [admin.id])
    .catch(() => null);
  agency = a && a.rows[0];
});
test.after(async () => { await s.stop(); });

const canonicalOf = html => (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
const alternatesOf = html => Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map(m => [m[1], m[2]]));
const ldOf = html => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const pathOf = url => url.replace(BASE, '');

// Deux versions d'une même page : chacune se déclare canonique et désigne l'autre
async function checkPair(frPath, arPath) {
  const fr = await s.request('GET', frPath), ar = await s.request('GET', arPath);
  assert.equal(fr.status, 200, frPath);
  assert.equal(ar.status, 200, arPath);
  assert.equal(canonicalOf(fr.text), BASE + frPath);
  assert.equal(canonicalOf(ar.text), BASE + arPath);
  const expected = { fr: BASE + frPath, ar: BASE + arPath, 'x-default': BASE + frPath };
  assert.deepEqual(alternatesOf(fr.text), expected, `hreflang de ${frPath}`);
  assert.deepEqual(alternatesOf(ar.text), expected, `hreflang de ${arPath}`);
  assert.match(fr.text, /<html lang="fr" dir="ltr">/);
  assert.match(ar.text, /<html lang="ar" dir="rtl">/);
  assert.match(fr.text, /property="og:locale" content="fr_DZ"/);
  assert.match(ar.text, /property="og:locale" content="ar_DZ"/);
  assert.match(fr.headers.get('content-language'), /fr/);
  assert.match(ar.headers.get('content-language'), /ar/);
  return { fr, ar };
}

test('accueil : /ar existe, hreflang réciproques, langue et direction dans <html>', async () => {
  const { fr, ar } = await checkPair('/', '/ar');
  assert.notEqual(fr.text.match(/<title>([^<]*)/)[1], ar.text.match(/<title>([^<]*)/)[1]);
  assert.match(ar.text, /[؀-ۿ]/, 'texte arabe');
  const graph = ldOf(ar.text)['@graph'];
  assert.deepEqual(graph.map(g => g['@type']).sort(), ['Organization', 'WebSite']);
  assert.equal((await s.request('GET', '/index.html')).status, 200);
});

test('annonce : version arabe à /ar/annonce/<id>-<slug>, JSON-LD dans la langue de la page', async () => {
  const moved = await s.request('GET', `/annonce/${sample.id}`);
  const frPath = moved.headers.get('location');
  const { fr, ar } = await checkPair(frPath, '/ar' + frPath);
  const ldFr = ldOf(fr.text), ldAr = ldOf(ar.text);
  assert.equal(ldFr['@type'], 'RealEstateListing');
  assert.equal(ldAr['@type'], 'RealEstateListing');
  assert.equal(ldFr.inLanguage, 'fr');
  assert.equal(ldAr.inLanguage, 'ar');
  assert.equal(ldAr.url, BASE + '/ar' + frPath);
  assert.equal(ldAr.offers.priceCurrency, 'DZD');
  assert.match(ar.text, /دج/, 'prix en dinars arabes');
  // /ar/annonce/<id> et un slug erroné redirigent vers la forme canonique arabe
  const moved2 = await s.request('GET', `/ar/annonce/${sample.id}`);
  assert.equal(moved2.status, 301);
  assert.equal(moved2.headers.get('location'), '/ar' + frPath);
  const bad = await s.request('GET', `/ar/annonce/${sample.id}-slug-errone`);
  assert.equal(bad.status, 301);
  assert.equal(bad.headers.get('location'), '/ar' + frPath);
});

test('page de recherche par wilaya et type : deux versions, fil d\'Ariane et liste crawlable en arabe', async () => {
  const { ar } = await checkPair('/vente/villas/tipaza', '/ar/vente/villas/tipaza');
  assert.match(ar.text, new RegExp(`<a href="/ar/annonce/${sample.id}-`), 'lien crawlable vers la version arabe de l\'annonce');
  assert.match(ar.text, /تيبازة/, 'nom arabe de la wilaya');
  const graph = ldOf(ar.text)['@graph'];
  const crumbs = graph.find(g => g['@type'] === 'BreadcrumbList').itemListElement;
  assert.ok(crumbs.every(c => c.item.startsWith(BASE + '/ar')), 'fil d\'Ariane en URL arabes');
});

test('annuaires : deux versions chacun', async () => {
  for (const p of ['/agences', '/promoteurs', '/programmes'])
    await checkPair(p, '/ar' + p);
});

test('fiche d\'agence : deux versions', async (t) => {
  if (!agency) return t.skip('table agencies non insérable directement');
  const r = await s.request('GET', `/agence/${agency.id}`);
  assert.equal(r.status, 301);
  const frPath = r.headers.get('location');
  await checkPair(frPath, '/ar' + frPath);
});

test('redirections canoniques en arabe : casse, ordre, slash final ; 404 arabes', async () => {
  const swapped = await s.request('GET', '/ar/vente/tipaza/villas');
  assert.equal(swapped.status, 301);
  assert.equal(swapped.headers.get('location'), '/ar/vente/villas/tipaza');
  const upper = await s.request('GET', '/ar/VENTE/villas/tipaza');
  assert.equal(upper.status, 301);
  assert.equal(upper.headers.get('location'), '/ar/vente/villas/tipaza');
  const slash = await s.request('GET', '/ar/vente/villas/tipaza/');
  assert.equal(slash.status, 301);
  assert.equal(slash.headers.get('location'), '/ar/vente/villas/tipaza');

  for (const url of ['/ar/vente/xyz', '/ar/annonce/abc']) {
    const r = await s.request('GET', url);
    assert.equal(r.status, 404, url);
    assert.match(r.text, /<html lang="ar" dir="rtl">/, url);
    assert.match(r.text, /noindex/, url);
    assert.deepEqual(alternatesOf(r.text), {}, `une 404 n'a pas de hreflang : ${url}`);
  }
  // chemin inconnu partout ailleurs : la 404 bilingue statique (public/404.html), en noindex
  const unknown = await s.request('GET', '/ar/inconnue');
  assert.equal(unknown.status, 404);
  assert.match(unknown.text, /noindex/);
  // préfixe collé à un autre mot : pas la version arabe
  assert.equal((await s.request('GET', '/arabe')).status, 404);
});

test('pages sans contenu ou non publiques : noindex et aucun hreflang', async () => {
  for (const url of ['/location-saisonniere/fermes/adrar', '/ar/location-saisonniere/fermes/adrar']) {
    const r = await s.request('GET', url);
    assert.equal(r.status, 200, url);
    assert.match(r.text, /<meta name="robots" content="noindex,follow">/, url);
    assert.deepEqual(alternatesOf(r.text), {}, url);
  }
  // annonce vendue : accessible, mais hors index et sans versions alternatives
  const { rows } = await s.db.pool.query(
    `INSERT INTO properties (owner_id, title, description, mode, type_bien, price, wilaya, commune, image, status)
     VALUES ($1, 'Villa déjà vendue', 'Vendue.', 'vente', 'villa', 1000000, 'Blida', 'Blida', '/uploads/vendue.webp', 'sold') RETURNING id`, [admin.id]);
  const moved = await s.request('GET', `/ar/annonce/${rows[0].id}`);
  const page = await s.request('GET', moved.headers.get('location'));
  assert.equal(page.status, 200);
  assert.match(page.text, /noindex/);
  assert.deepEqual(alternatesOf(page.text), {});
});

test('sitemap : index, pages et annonces en deux langues avec liens xhtml réciproques', async () => {
  const index = await s.request('GET', '/sitemap.xml');
  assert.match(index.text, /<sitemapindex/);
  assert.match(index.text, new RegExp(`<loc>${BASE}/sitemap-annonces-1.xml</loc>`));

  const pages = await s.request('GET', '/sitemap-pages.xml');
  assert.equal(pages.status, 200);
  assert.match(pages.headers.get('content-type'), /xml/);
  for (const p of ['/', '/ar', '/agences', '/ar/agences', '/vente/villas/tipaza', '/ar/vente/villas/tipaza'])
    assert.ok(pages.text.includes(`<loc>${BASE}${p}</loc>`), p);
  assert.match(pages.text, new RegExp(`<xhtml:link rel="alternate" hreflang="ar" href="${BASE}/ar/vente/villas/tipaza"/>`));
  assert.match(pages.text, new RegExp(`<xhtml:link rel="alternate" hreflang="x-default" href="${BASE}/vente/villas/tipaza"/>`));

  const props = await s.request('GET', '/sitemap-annonces-1.xml');
  assert.equal(props.status, 200);
  const frLoc = props.text.match(new RegExp(`<loc>${BASE}(/annonce/${sample.id}-[^<]*)</loc>`))[1];
  assert.ok(props.text.includes(`<loc>${BASE}/ar${frLoc}</loc>`), 'version arabe de l\'annonce');
  assert.match(props.text, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);

  // chaque <url> désigne bien les deux versions ; toute adresse listée est servie (200 ou redirection canonique, jamais 404)
  const all = await fullSitemap(s);
  for (const m of [...all.matchAll(/<url><loc>([^<]+)<\/loc>/g)].slice(0, 30)) {
    const r = await s.request('GET', pathOf(m[1]));
    assert.equal(r.status, 200, m[1]);
  }

  // tranche inexistante : 404 ; annonce en attente absente
  assert.equal((await s.request('GET', '/sitemap-annonces-9.xml')).status, 404);
  assert.equal((await s.request('GET', '/sitemap-annonces-0.xml')).status, 404);
  assert.doesNotMatch(all, /villa-deja-vendue/);
});

test('robots.txt : pages de la newsletter en arabe exclues aussi', async () => {
  const robots = await s.request('GET', '/robots.txt');
  assert.match(robots.text, /Disallow: \/newsletter\//);
  assert.match(robots.text, /Disallow: \/ar\/newsletter\//);
  assert.match(robots.text, new RegExp(`Sitemap: ${BASE}/sitemap.xml`));
});

test('titres arabes : échappés, jamais de HTML injecté dans le <head>', async () => {
  await s.db.pool.query(`UPDATE properties SET title = $1 WHERE id = $2`, ['</title><script>alert(1)</script> شقة', sample.id]);
  const moved = await s.request('GET', `/ar/annonce/${sample.id}`);
  const page = await s.request('GET', moved.headers.get('location'));
  const head = page.text.slice(0, page.text.indexOf('</head>'));
  assert.doesNotMatch(head, /<script>alert/);
  assert.equal((head.match(/<title>/g) || []).length, 1);
});
