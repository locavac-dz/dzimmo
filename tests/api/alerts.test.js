// Alertes email de recherche : création avec tous les critères, limite, isolation entre comptes.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, user, other;
test.before(async () => {
  s = await startServer();
  user = await s.register('alerte');
  other = await s.register('autre');
});
test.after(async () => { await s.stop(); });

test('création d\'une alerte : tous les critères sont enregistrés (prix et surface compris)', async () => {
  const r = await s.request('POST', '/api/alerts', { token: user.token, body: {
    wilaya: 'Oran', mode: 'vente', type_bien: 'appartement', min_price: '5000000', max_price: '20000000', min_surface: '80' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.wilaya, 'Oran');
  assert.equal(Number(r.body.min_price), 5000000);
  assert.equal(Number(r.body.max_price), 20000000);
  assert.equal(Number(r.body.min_surface), 80);
  const list = await s.request('GET', '/api/alerts', { token: user.token });
  assert.equal(list.body.length, 1);
});

test('critères vides : enregistrés comme « tous » (null)', async () => {
  const r = await s.request('POST', '/api/alerts', { token: other.token, body: { wilaya: '', mode: '', type_bien: '', min_price: '', max_price: '', min_surface: '' } });
  assert.equal(r.status, 201);
  for (const k of ['wilaya', 'mode', 'type_bien', 'min_price', 'max_price', 'min_surface']) assert.equal(r.body[k], null, k);
});

test('les alertes exigent une connexion et restent privées', async () => {
  assert.equal((await s.request('GET', '/api/alerts')).status, 401);
  assert.equal((await s.request('POST', '/api/alerts', { body: {} })).status, 401);
  const mine = (await s.request('GET', '/api/alerts', { token: user.token })).body[0];
  assert.equal((await s.request('DELETE', `/api/alerts/${mine.id}`, { token: other.token })).status, 404, 'pas de suppression chez un autre');
  assert.equal((await s.request('GET', '/api/alerts', { token: other.token })).body.every(a => a.id !== mine.id), true);
  assert.equal((await s.request('DELETE', `/api/alerts/${mine.id}`, { token: user.token })).status, 200);
});

test('maximum 5 alertes par compte', async () => {
  const u = await s.register('limite');
  for (let i = 0; i < 5; i++)
    assert.equal((await s.request('POST', '/api/alerts', { token: u.token, body: { wilaya: 'Alger' } })).status, 201);
  const sixth = await s.request('POST', '/api/alerts', { token: u.token, body: { wilaya: 'Alger' } });
  assert.equal(sixth.status, 400);
  assert.match(sixth.body.error, /5 alertes/);
});
