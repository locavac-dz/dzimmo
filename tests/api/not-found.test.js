// Chemins inconnus : vraie 404 (jamais la SPA en 200), page bilingue non indexable, API en JSON traduit.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const { AR } = require('../../server/i18n');

let s;
test.before(async () => { s = await startServer(); });
test.after(async () => { await s.stop(); });

test('chemin inconnu : 404 avec la page « introuvable » bilingue, non indexable', async () => {
  for (const url of ['/nimporte-quoi', '/admin', '/dashboard', '/a/b/c', '/annonce/', '/vente/../etc', '/foo.js', '/uploads/absent.jpg', '/index.php', '/.env']) {
    const r = await s.request('GET', url);
    assert.equal(r.status, 404, url);
    assert.match(r.text, /<h1>404<\/h1>/, url);
    assert.match(r.text, /Page introuvable/, url);
    assert.match(r.text, /الصفحة غير موجودة/, url);
    assert.match(r.text, /<meta name="robots" content="noindex,follow">/, url);
    assert.doesNotMatch(r.text, /SEO_HEAD|id="admin-content"/, url + ' : ce n\'est pas la SPA');
  }
});

test('/404 répond bien avec le statut 404', async () => {
  const r = await s.request('GET', '/404');
  assert.equal(r.status, 404);
  assert.match(r.text, /<h1>404<\/h1>/);
});

test('les autres méthodes HTTP sur un chemin inconnu : 404 aussi', async () => {
  for (const method of ['POST', 'PUT', 'DELETE'])
    assert.equal((await s.request(method, '/nimporte-quoi')).status, 404, method);
  assert.equal((await fetch(s.base + '/nimporte-quoi', { method: 'HEAD' })).status, 404);
});

test('API inconnue : 404 en JSON (et non la SPA), message traduit en arabe', async () => {
  for (const url of ['/api/inconnu', '/api/properties/1/inconnu/encore', '/api/admin/nimporte', '/api', '/api/']) {
    const r = await s.request('GET', url);
    assert.equal(r.status, 404, url);
    assert.equal(r.body.error, 'Route introuvable.', url);
  }
  assert.equal((await s.request('POST', '/api/inconnu', { body: { a: 1 } })).status, 404);
  const ar = await s.request('GET', '/api/inconnu', { headers: { 'X-Lang': 'ar' } });
  assert.equal(ar.status, 404);
  assert.equal(ar.body.error, AR['Route introuvable.']);
});

test('les pages et fichiers existants ne sont pas touchés', async () => {
  for (const url of ['/', '/index.html', '/?p=999999', '/manifest.json', '/favicon.svg', '/sw.js', '/robots.txt', '/sitemap.xml', '/api/health', '/vente', '/vente/appartements/oran']) {
    const r = await s.request('GET', url);
    assert.ok([200, 301].includes(r.status), `${url} → ${r.status}`);
  }
  const accueil = await s.request('GET', '/');
  assert.match(accueil.text, /<title>[^<]*DzImmo/);
  assert.equal((await s.request('GET', '/annonce/999999-inconnue')).status, 404, 'annonce inconnue : déjà une 404');
  assert.equal((await s.request('GET', '/vente/nimporte')).status, 404);
});

test('la page 404 est valide et son lien ramène à l\'accueil', async () => {
  const r = await s.request('GET', '/nimporte-quoi');
  assert.match(r.text, /<html lang="fr">/);
  assert.match(r.text, /<a href="\/">/);
  assert.match(r.text, /dir="rtl"/);
});
