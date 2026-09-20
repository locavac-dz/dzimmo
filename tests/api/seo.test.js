// SEO : pages d'annonce, pages de recherche, sitemap, robots, redirections et échappement HTML.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, admin, sample;
const BASE = 'https://dzimmo.test';   // APP_URL défini par le helper

test.before(async () => {
  s = await startServer();
  admin = await s.makeAdmin(await s.register('admin'));
  // Annonce de référence créée ici (les tests ne dépendent pas du contenu du jeu de démonstration)
  const { rows } = await s.db.pool.query(
    `INSERT INTO properties (owner_id, title, description, mode, type_bien, price, wilaya, commune, image, status)
     VALUES ($1, 'Villa de référence avec jardin', 'Villa lumineuse, quatre chambres, garage.', 'vente', 'villa', 48000000, 'Tipaza', 'Tipaza', '/uploads/reference-seo.webp', 'active')
     RETURNING id, mode, type_bien, wilaya`, [admin.id]);
  sample = rows[0];
});
test.after(async () => { await s.stop(); });

const canonicalOf = html => (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
const titleOf = html => (html.match(/<title>([^<]*)<\/title>/) || [])[1];

test('accueil : titre, canonical basé sur APP_URL, données structurées WebSite', async () => {
  const r = await s.request('GET', '/');
  assert.equal(r.status, 200);
  assert.match(titleOf(r.text), /DzImmo/);
  assert.equal(canonicalOf(r.text), BASE + '/');
  assert.match(r.text, /"@type":"WebSite"/);
  assert.equal((r.text.match(/<title>/g) || []).length, 1, 'un seul <title>');
});

test('accueil : image de partage de marque, servie par le site', async () => {
  const home = await s.request('GET', '/');
  assert.match(home.text, new RegExp(`<meta property="og:image" content="${BASE}/og-default.png">`));
  assert.match(home.text, /og:image:width" content="1200"/);
  assert.match(home.text, /name="twitter:card" content="summary_large_image"/);
  const img = await fetch(s.base + '/og-default.png');
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  // une annonce garde sa propre photo (pas l'image par défaut)
  const go = await s.request('GET', `/annonce/${sample.id}`);
  const page = await s.request('GET', go.headers.get('location'));
  assert.doesNotMatch(page.text, /og-default\.png/);
});

test('robots.txt et sitemap.xml', async () => {
  const robots = await s.request('GET', '/robots.txt');
  assert.match(robots.text, /Disallow: \/api\//);
  assert.match(robots.text, new RegExp(`Sitemap: ${BASE}/sitemap.xml`));
  const sm = await s.request('GET', '/sitemap.xml');
  assert.equal(sm.status, 200);
  assert.match(sm.headers.get('content-type'), /xml/);
  assert.match(sm.text, new RegExp(`<loc>${BASE}/</loc>`));
  assert.match(sm.text, new RegExp(`<loc>${BASE}/annonce/${sample.id}-`));
});

test('annonce : redirection 301 vers l\'URL canonique, puis page avec meta et JSON-LD', async () => {
  const moved = await s.request('GET', `/annonce/${sample.id}`);
  assert.equal(moved.status, 301);
  const loc = moved.headers.get('location');
  assert.match(loc, new RegExp(`^/annonce/${sample.id}-`));

  const bad = await s.request('GET', `/annonce/${sample.id}-slug-errone`);
  assert.equal(bad.status, 301);
  assert.equal(bad.headers.get('location'), loc);

  const page = await s.request('GET', loc);
  assert.equal(page.status, 200);
  assert.equal(canonicalOf(page.text), BASE + loc);
  assert.match(titleOf(page.text), /DzImmo$/);
  assert.match(page.text, /property="og:title"/);
  assert.match(page.text, /property="og:image"/);
  const ld = JSON.parse(page.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld['@type'], 'RealEstateListing');
  assert.equal(ld.offers.priceCurrency, 'DZD');
  assert.equal(ld.url, BASE + loc);
});

test('ancien lien /?p=<id> redirigé en 301', async () => {
  const r = await s.request('GET', `/?p=${sample.id}`);
  assert.equal(r.status, 301);
  assert.match(r.headers.get('location'), new RegExp(`^/annonce/${sample.id}-`));
});

test('annonce inconnue : vrai 404 + noindex ; id non numérique aussi', async () => {
  for (const url of ['/annonce/999999', '/annonce/abc']) {
    const r = await s.request('GET', url);
    assert.equal(r.status, 404, url);
    assert.match(r.text, /<meta name="robots" content="noindex,follow">/);
  }
});

test('page de recherche : /<mode>/<type>/<wilaya> avec liste crawlable, JSON-LD et fil d\'Ariane', async () => {
  const modeSlug = { vente: 'vente', location_longue: 'location', location_courte: 'location-saisonniere' }[sample.mode];
  const typeSlug = { appartement: 'appartements', villa: 'villas', maison: 'maisons', bureau: 'bureaux',
    local_commercial: 'locaux-commerciaux', terrain: 'terrains', ferme: 'fermes', entrepot: 'entrepots' }[sample.type_bien];
  const { slugify } = require('../../server/seo');
  const path = `/${modeSlug}/${typeSlug}/${slugify(sample.wilaya)}`;

  const r = await s.request('GET', path);
  assert.equal(r.status, 200, path);
  assert.equal(canonicalOf(r.text), BASE + path);
  assert.match(r.text, /id="seo-landing"/);
  assert.match(r.text, new RegExp(`<a href="/annonce/${sample.id}-`), 'lien crawlable vers l\'annonce');
  assert.doesNotMatch(r.text, /<meta name="robots"/, 'page non vide : indexable');
  const ld = JSON.parse(r.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(ld['@graph'].map(g => g['@type']), ['CollectionPage', 'ItemList', 'BreadcrumbList']);

  // ordre inversé et slash final : redirection vers la forme canonique
  const swapped = await s.request('GET', `/${modeSlug}/${slugify(sample.wilaya)}/${typeSlug}`);
  assert.equal(swapped.status, 301);
  assert.equal(swapped.headers.get('location'), path);
  assert.equal((await s.request('GET', path + '/')).status, 301);
});

test('page de recherche valide mais sans annonce : 200 + noindex, absente du sitemap', async () => {
  const r = await s.request('GET', '/location-saisonniere/fermes/adrar');
  assert.equal(r.status, 200);
  assert.match(r.text, /<meta name="robots" content="noindex,follow">/);
  assert.doesNotMatch((await s.request('GET', '/sitemap.xml')).text, /location-saisonniere\/fermes\/adrar/);
});

test('pages de recherche invalides : 404', async () => {
  for (const url of ['/vente/xyz', '/vente/constructor', '/vente/oran/oran', '/vente/appartements/alger/oran', '/vente/appartements/villas'])
    assert.equal((await s.request('GET', url)).status, 404, url);
});

test('le pied de page contient des liens « Explorer » vers les pages de recherche', async () => {
  const r = await s.request('GET', '/');
  assert.match(r.text, /data-i18n="ft_explore"/);
  assert.match(r.text, /<a href="\/(vente|location)[^"]*" data-seo-m=/);
});

test('annonce en attente : jamais dans le sitemap ni en page publique', async () => {
  const owner = await s.register('owner');
  const r = await s.request('POST', '/api/properties', { token: owner.token, body: {
    title: 'Villa secrète en attente', mode: 'vente', type_bien: 'villa', price: 30000000, wilaya: 'Blida', photos: [] } });
  assert.equal(r.body.status, 'pending');
  assert.equal((await s.request('GET', `/annonce/${r.body.id}-villa-secrete-en-attente`)).status, 404);
  assert.doesNotMatch((await s.request('GET', '/sitemap.xml')).text, /villa-secrete/);
});

test('échappement : un titre malveillant ne peut pas injecter de HTML dans le <head>', async () => {
  const evil = '</title><script>alert(1)</script><img src=x onerror=alert(2)>';
  const r = await s.request('POST', '/api/properties', { token: admin.token, body: {
    title: evil, description: '</script><script>alert(3)</script>', mode: 'vente', type_bien: 'villa',
    price: 1000000, wilaya: 'Oran', photos: [] } });
  assert.equal(r.body.status, 'active');
  const go = await s.request('GET', `/annonce/${r.body.id}`);
  const page = await s.request('GET', go.headers.get('location'));
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /<script>alert\(\d\)<\/script>/);
  assert.doesNotMatch(page.text, /<img src=x onerror/);
  assert.equal((page.text.match(/<title>/g) || []).length, 1);
});
