// Tests d'intégration pour GET /api/search/suggest?q=…
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, user, n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);

async function listing(title, wilaya = 'Alger') {
  const base = { title, mode: 'vente', type_bien: 'appartement',
    price: 5000000, wilaya, surface_m2: 80, description: 'Description de test numéro ' + ++n };
  const r = await s.request('POST', '/api/properties', { token: user.token, body: base });
  assert.equal(r.status, 201);
  await q(`UPDATE properties SET status = 'active', published_at = now() WHERE id = $1`, [r.body.id]);
  return r.body.id;
}

before(async () => {
  s    = await startServer();
  user = await s.register('suggest-user');
  await listing('Villa moderne à Hydra', 'Alger');
  await listing('Appartement F3 Bab Ezzouar', 'Alger');
  await listing('Terrain agricole Annaba', 'Annaba');
});
after(async () => { await s.stop(); });

describe('GET /api/search/suggest', () => {
  it('q absent ou trop court → tableau vide', async () => {
    const { body: b1 } = await s.request('GET', '/api/search/suggest');
    assert.deepEqual(b1, []);
    const { body: b2 } = await s.request('GET', '/api/search/suggest?q=v');
    assert.deepEqual(b2, []);
  });

  it('q valide → tableau de suggestions (id, title, wilaya, price, mode, type_bien)', async () => {
    const { status, body } = await s.request('GET', '/api/search/suggest?q=villa');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'doit être un tableau');
    assert.ok(body.length > 0, 'au moins une suggestion attendue');
    const row = body[0];
    assert.ok(typeof row.id    === 'number', 'id manquant');
    assert.ok(typeof row.title === 'string', 'title manquant');
    assert.ok('wilaya' in row,  'wilaya manquant');
    assert.ok('price'  in row,  'price manquant');
    assert.ok('mode'   in row,  'mode manquant');
  });

  it('au plus 8 résultats', async () => {
    // Créer 10 annonces avec le même mot
    for (let i = 0; i < 10; i++) await listing('Lotissement test-suggest-max ' + i);
    const { body } = await s.request('GET', '/api/search/suggest?q=test-suggest-max');
    assert.ok(body.length <= 8, 'plus de 8 suggestions renvoyées');
  });

  it('n\'inclut pas les annonces non actives', async () => {
    const r = await s.request('POST', '/api/properties', { token: user.token,
      body: { title: 'Annonce-suggest-pending-xyz', mode: 'vente', type_bien: 'terrain',
        price: 1000000, wilaya: 'Alger', surface_m2: 200, description: 'desc pending' } });
    // statut reste pending
    const { body } = await s.request('GET', '/api/search/suggest?q=suggest-pending-xyz');
    assert.ok(!body.some(p => p.id === r.body.id), 'annonce pending ne doit pas figurer');
  });
});
