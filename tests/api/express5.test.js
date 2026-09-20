// Comportements qui changent entre Express 4 et Express 5 : corps de requête absent, erreur dans une route asynchrone
// (plus de express-async-errors), motifs de route sans expression régulière, paramètres d'URL imbriqués.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s;
test.before(async () => { s = await startServer(); });
test.after(() => s.stop());

test('POST sans corps : la réponse reste le 400 / 401 de la route, jamais une erreur 500', async () => {
  for (const url of ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/contact', '/api/newsletter/subscribe']) {
    const r = await s.request('POST', url);
    assert.ok(r.status >= 400 && r.status < 500, `${url} → ${r.status}`);
    assert.equal(typeof r.body.error, 'string', url);
  }
  const u = await s.register('sans-corps');
  for (const url of ['/api/properties', '/api/contacts', '/api/messages'])
    assert.ok((await s.request('POST', url, { token: u.token })).status < 500, url);
});

test('erreur dans une route asynchrone : 500 en JSON, message neutre, le serveur reste debout', async () => {
  const original = s.db.pool.query;
  const logged = console.error;
  console.error = () => {};
  s.db.pool.query = async () => { throw new Error('connexion perdue vers 10.0.0.5'); };
  let r;
  try { r = await s.request('GET', '/api/agencies'); } finally { s.db.pool.query = original; console.error = logged; }
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: 'Erreur interne du serveur.' });
  assert.equal((await s.request('GET', '/api/agencies')).status, 200, 'la requête suivante aboutit');
});

test('JSON mal formé : 400 avec un message français traduisible', async () => {
  const r = await fetch(s.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":' });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'Requête invalide (JSON mal formé).' });
});

test('pages de recherche : chaque profondeur répond, casse ramenée à la forme canonique, chemin trop profond en vraie 404', async () => {
  for (const url of ['/vente', '/location', '/location-saisonniere', '/vente/villas', '/vente/villas/oran'])
    assert.equal((await s.request('GET', url)).status, 200, url);
  const upper = await s.request('GET', '/VENTE/Villas');
  assert.equal(upper.status, 301);
  assert.equal(upper.headers.get('location'), '/vente/villas');
  for (const url of ['/vente/villas/oran/centre', '/location/a/b/c/d/e'])
    assert.equal((await s.request('GET', url)).status, 404, url);
  assert.equal((await s.request('GET', '/ventes')).status, 404, 'préfixe voisin : pas de correspondance partielle');
});

test('vitrines : /agence et /promoteur gardent la vraie 404 et l\'annuaire', async () => {
  for (const url of ['/agence/999999-inconnue', '/promoteur/abc', '/programme/0'])
    assert.equal((await s.request('GET', url)).status, 404, url);
  for (const url of ['/agences', '/promoteurs', '/programmes'])
    assert.equal((await s.request('GET', url)).status, 200, url);
});

test('paramètres d\'URL imbriqués ou répétés : ignorés sans erreur', async () => {
  for (const qs of ['wilaya[$ne]=x', 'page[x]=1', 'q[]=a&q[]=b', 'limit=5&limit=7', '__proto__[x]=1'])
    assert.equal((await s.request('GET', '/api/properties?' + qs)).status, 200, qs);
});
