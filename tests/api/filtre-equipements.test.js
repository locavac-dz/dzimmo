// Tests d'intégration pour le filtre ?features= de GET /api/properties.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, user, n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);

async function listing(owner, over = {}) {
  const base = { title: 'FiltreFeats-' + ++n, mode: 'vente', type_bien: 'appartement',
    price: 5000000, wilaya: 'Alger', surface_m2: 80, description: 'Desc-' + n, ...over };
  const r = await s.request('POST', '/api/properties', { token: owner.token, body: base });
  assert.equal(r.status, 201, `listing() a échoué (${r.status}) : ${JSON.stringify(r.body)}`);
  await q(`UPDATE properties SET status = 'active', published_at = now() WHERE id = $1`, [r.body.id]);
  return r.body.id;
}

before(async () => {
  s    = await startServer();
  user = await s.register('feat-user');
});
after(async () => { await s.stop(); });

describe('GET /api/properties?features=', () => {
  it('sans filtre : renvoie tous les biens actifs', async () => {
    const id1 = await listing(user, { features: ['parking', 'meuble'] });
    const id2 = await listing(user, { features: ['piscine'] });
    const { body } = await s.request('GET', '/api/properties?status=active&limit=200');
    assert.ok(body.data.some(p => p.id === id1));
    assert.ok(body.data.some(p => p.id === id2));
  });

  it('?features=parking : ne renvoie que les biens avec parking', async () => {
    const idAvec   = await listing(user, { features: ['parking', 'balcon'] });
    const idSans   = await listing(user, { features: ['piscine'] });
    const { body } = await s.request('GET', '/api/properties?status=active&features=parking&limit=200');
    assert.ok(body.data.some(p => p.id === idAvec), 'bien avec parking attendu');
    assert.ok(!body.data.some(p => p.id === idSans), 'bien sans parking ne doit pas apparaître');
  });

  it('?features=parking,meuble : ET logique (les deux équipements requis)', async () => {
    const idBoth = await listing(user, { features: ['parking', 'meuble', 'balcon'] });
    const idOne  = await listing(user, { features: ['parking'] });
    const idNone = await listing(user, { features: ['wifi'] });
    const { body } = await s.request('GET', '/api/properties?status=active&features=parking,meuble&limit=200');
    assert.ok(body.data.some(p => p.id === idBoth), 'bien avec les deux équipements attendu');
    assert.ok(!body.data.some(p => p.id === idOne), 'bien sans meublé ne doit pas apparaître');
    assert.ok(!body.data.some(p => p.id === idNone), 'bien sans les deux ne doit pas apparaître');
  });

  it('valeur inconnue ignorée, jamais une erreur SQL', async () => {
    const { status } = await s.request('GET', '/api/properties?status=active&features=inconnu');
    assert.equal(status, 200);
  });

  it('valeur valide + invalide : seule la valide filtre', async () => {
    const idAvec = await listing(user, { features: ['parking'] });
    const idSans = await listing(user, { features: ['wifi'] });
    const { body } = await s.request('GET', '/api/properties?status=active&features=parking,inconnu&limit=200');
    assert.ok(body.data.some(p => p.id === idAvec), 'valeur valide doit filtrer');
    assert.ok(!body.data.some(p => p.id === idSans));
  });

  it('features vide : pas de filtre (tous les biens)', async () => {
    const { status, body } = await s.request('GET', '/api/properties?status=active&features=');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data));
  });
});
