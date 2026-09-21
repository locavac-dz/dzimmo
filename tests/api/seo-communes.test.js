// Pages de commune : /vente/oran/bir-el-djir (et /ar/…), regroupement des saisies, indexation, sitemap, redirections, 404, échappement, filtre de l'API.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const { fullSitemap } = require('../helpers/sitemap');

let s, owner;
const BASE = 'https://dzimmo.test';   // APP_URL défini par le helper

// Trois saisies de la même commune (casse, tiret), une commune à une seule annonce, une annonce en attente, une saisie piégée
const ROWS = [
  ['Bir El Djir',  'vente',          'villa',       'active'],
  ['Bir El Djir',  'vente',          'appartement', 'active'],
  ['bir-el-djir',  'vente',          'appartement', 'active'],
  ['Bir El Djir',  'location_longue', 'appartement', 'active'],
  ['Douar Test',     'vente',          'villa',       'active'],
  ['Fantôme',      'vente',          'villa',       'pending'],
  ['<b>Piège</b>', 'vente',          'maison',      'active'],
  ['<b>Piège</b>', 'vente',          'maison',      'active'],
];

test.before(async () => {
  s = await startServer();
  owner = await s.makeAdmin(await s.register('proprio-communes'));
  for (const [commune, mode, type, status] of ROWS)
    await s.db.pool.query(
      `INSERT INTO properties (owner_id, title, description, mode, type_bien, price, wilaya, commune, image, status)
       VALUES ($1, $2, 'Bien de test pour les pages de commune.', $3, $4, 30000000, 'Oran', $5, '/uploads/commune-seo.webp', $6)`,
      [owner.id, `Bien ${type} à ${commune.replace(/[<>/]/g, '')}`, mode, type, commune, status]);
});
test.after(async () => { await s.stop(); });

const canonicalOf  = html => (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
const alternatesOf = html => Object.fromEntries([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map(m => [m[1], m[2]]));
const listed = html => [...html.matchAll(/<a href="\/(?:ar\/)?annonce\/(\d+)-/g)].length;

test('page de commune : 200, libellé « commune, wilaya », toutes les saisies regroupées, indexable', async () => {
  const p = '/vente/oran/bir-el-djir';
  const r = await s.request('GET', p);
  assert.equal(r.status, 200);
  assert.equal(canonicalOf(r.text), BASE + p);
  assert.doesNotMatch(r.text, /<meta name="robots"/);
  assert.match(r.text, /<h1[^>]*>[^<]*à Bir El Djir, Oran<\/h1>/);
  assert.match(r.text, /data-seo-k="Bir El Djir"/, 'libellé retenu = la saisie la plus fréquente');
  assert.equal(listed(r.text), 3, 'trois annonces à vendre, les trois saisies réunies (la location n\'en fait pas partie)');
  const ld = JSON.parse(r.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(ld['@graph'].map(g => g['@type']), ['CollectionPage', 'ItemList', 'BreadcrumbList']);
  const crumbs = ld['@graph'][2].itemListElement.map(x => x.item);
  assert.deepEqual(crumbs.slice(-2), [BASE + '/vente/oran', BASE + p], 'fil d\'Ariane : la wilaya puis la commune');
});

test('page de commune avec type, en français et en arabe : hreflang réciproques', async () => {
  for (const [fr, ar] of [['/vente/oran/bir-el-djir', '/ar/vente/oran/bir-el-djir'], ['/vente/appartements/oran/bir-el-djir', '/ar/vente/appartements/oran/bir-el-djir']]) {
    const a = await s.request('GET', fr), b = await s.request('GET', ar);
    assert.equal(a.status, 200, fr); assert.equal(b.status, 200, ar);
    assert.equal(canonicalOf(a.text), BASE + fr); assert.equal(canonicalOf(b.text), BASE + ar);
    const expected = { fr: BASE + fr, ar: BASE + ar, 'x-default': BASE + fr };
    assert.deepEqual(alternatesOf(a.text), expected); assert.deepEqual(alternatesOf(b.text), expected);
    assert.match(b.text, /<html lang="ar" dir="rtl">/);
    assert.match(b.text, /في Bir El Djir، /, 'séparateur arabe entre commune et wilaya');
  }
  const r = await s.request('GET', '/vente/appartements/oran/bir-el-djir');
  assert.equal(listed(r.text), 2);
});

test('formes non canoniques : redirection 301 vers le chemin canonique', async () => {
  const to = async (from, expected) => {
    const r = await s.request('GET', from);
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.get('location'), expected, from);
  };
  await to('/VENTE/Oran/Bir-El-Djir', '/vente/oran/bir-el-djir');
  await to('/vente/oran/appartements', '/vente/appartements/oran');
  await to('/vente/oran/bir-el-djir/', '/vente/oran/bir-el-djir');
  await to('/ar/vente/ORAN/bir-el-djir', '/ar/vente/oran/bir-el-djir');
});

test('commune à une seule annonce ou sans annonce dans ce mode : page servie mais noindex, sans hreflang', async () => {
  for (const p of ['/vente/oran/douar-test', '/location/oran/douar-test']) {
    const r = await s.request('GET', p);
    assert.equal(r.status, 200, p);
    assert.match(r.text, /<meta name="robots" content="noindex,follow">/, p);
    assert.deepEqual(alternatesOf(r.text), {}, p);
  }
});

test('sitemap : communes à deux annonces ou plus, dans les deux langues ; les autres en sont absentes', async () => {
  const xml = await fullSitemap(s);
  assert.match(xml, /<loc>https:\/\/dzimmo\.test\/vente\/oran\/bir-el-djir<\/loc>/);
  assert.match(xml, /<loc>https:\/\/dzimmo\.test\/ar\/vente\/oran\/bir-el-djir<\/loc>/);
  assert.match(xml, /<loc>https:\/\/dzimmo\.test\/vente\/appartements\/oran\/bir-el-djir<\/loc>/);
  assert.doesNotMatch(xml, /\/oran\/douar-test</);   // (le titre d'une annonce peut contenir le nom : on cherche la page de commune)
  assert.doesNotMatch(xml, /\/oran\/fantome</);
});

test('commune inconnue, d\'une autre wilaya, en attente seulement, ou chemin trop profond : 404', async () => {
  for (const p of ['/vente/oran/nulle-part', '/vente/alger/bir-el-djir', '/vente/oran/fantome', '/vente/oran/bir-el-djir/x',
    '/vente/villas/oran/bir-el-djir/x', '/vente/bir-el-djir', '/vente/oran/constructor', '/ar/vente/oran/nulle-part'])
    assert.equal((await s.request('GET', p)).status, 404, p);
});

test('la page de la wilaya propose ses communes ; celle d\'une commune renvoie vers la wilaya et les autres types', async () => {
  const w = await s.request('GET', '/vente/oran');
  assert.match(w.text, /<a href="\/vente\/oran\/bir-el-djir"[^>]*data-seo-k="Bir El Djir"/);
  assert.doesNotMatch(w.text, /href="[^"]*\/oran\/douar-test"/, 'commune à une annonce : pas de lien');
  const c = await s.request('GET', '/vente/oran/bir-el-djir');
  assert.match(c.text, /<a href="\/vente\/oran"/);
  assert.match(c.text, /<a href="\/vente\/appartements\/oran\/bir-el-djir"/);
});

test('saisie piégée : le libellé est échappé partout, jamais de balise dans la page', async () => {
  const slug = require('../../server/seo').slugify('<b>Piège</b>');
  const page = await s.request('GET', '/vente/oran/' + slug);
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /<b>Pi/);
  assert.match(page.text, /&lt;b&gt;Pi/);
});

test('API : le filtre commune ignore casse, accents et ponctuation ; une valeur qui n\'est pas un texte est ignorée', async () => {
  const ids = async q => (await s.request('GET', '/api/properties?status=active&wilaya=Oran&limit=50&' + q)).body.data.length;
  assert.equal(await ids('commune=Bir%20El%20Djir'), 4, 'les quatre annonces actives de la commune, tous modes');
  assert.equal(await ids('commune=bir-el-djir'), 4);
  assert.equal(await ids('commune=BIR%20EL%20DJIR&mode=vente'), 3);
  assert.equal(await ids('commune=douar-test'), 1);
  assert.equal(await ids('commune=nulle-part'), 0);
  const r = await s.request('GET', '/api/properties?commune[]=a&commune[]=b');
  assert.equal(r.status, 200, 'un tableau ne provoque pas d\'erreur SQL');
});
