// Équipements d'une annonce (features) : liste fermée de clés, jamais de texte libre — le front les rend dans innerHTML.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const { AR } = require('../../server/i18n');

const BAD = 'Équipements invalides.';

let s, owner, n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);
const base = over => ({ title: 'Annonce équipements ' + ++n, mode: 'vente', type_bien: 'appartement', price: 12000000, wilaya: 'Alger', ...over });
const create = (body, headers) => s.request('POST', '/api/properties', { token: owner.token, body: base(body), headers });
const feats = async id => (await q('SELECT features FROM properties WHERE id = $1', [id])).rows[0].features;
const count = async () => (await q('SELECT COUNT(*)::int c FROM properties')).rows[0].c;

test.before(async () => {
  s = await startServer();
  owner = await s.register('feat');
});
test.after(async () => { await s.stop(); });

const BAD_VALUES = [
  ['<img src=x onerror=alert(1)>'],           // balise dans une clé
  ['parking', 'x" onmouseover="alert(1)'],    // attribut injecté
  ['Parking'],                                // casse : la clé n'existe pas
  ['parking', 42],                            // type
  ['parking', null],
  'parking',                                  // pas un tableau
  { parking: true },
  Array.from({ length: 30 }, () => 'parking'),// plus long que la liste
];

test('création : clés connues acceptées et dédoublonnées, absence tolérée', async () => {
  const r = await create({ features: ['parking', 'ascenseur', 'parking'] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(await feats(r.body.id), ['parking', 'ascenseur'], 'doublon retiré, ordre conservé');
  for (const features of [[], undefined, null]) {
    const ok = await create({ features });
    assert.equal(ok.status, 201, JSON.stringify(features));
    assert.deepEqual(await feats(ok.body.id), []);
  }
});

test('création : toute valeur hors liste est refusée, message traduit, rien n\'est enregistré', async () => {
  const before = await count();
  for (const features of BAD_VALUES) {
    const r = await create({ features });
    assert.equal(r.status, 400, JSON.stringify(features));
    assert.equal(r.body.error, BAD);
  }
  const ar = await create({ features: ['<b>'] }, { 'X-Lang': 'ar' });
  assert.equal(ar.body.error, AR[BAD]);
  assert.equal(await count(), before, 'aucune annonce créée');
});

test('modification : mêmes règles ; un corps sans features ne touche pas aux équipements', async () => {
  const r = await create({ features: ['wifi'] });
  const id = r.body.id;
  const put = body => s.request('PUT', '/api/properties/' + id, { token: owner.token, body });

  assert.equal((await put({ price: 12500000 })).status, 200);
  assert.deepEqual(await feats(id), ['wifi'], 'inchangé');

  for (const features of BAD_VALUES) {
    const bad = await put({ features });
    assert.equal(bad.status, 400, JSON.stringify(features));
    assert.equal(bad.body.error, BAD);
  }
  assert.deepEqual(await feats(id), ['wifi'], 'toujours inchangé après les refus');

  assert.equal((await put({ features: ['jardin', 'piscine', 'jardin'] })).status, 200);
  assert.deepEqual(await feats(id), ['jardin', 'piscine']);
  assert.equal((await put({ features: [] })).status, 200);
  assert.deepEqual(await feats(id), []);
});
