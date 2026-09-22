// Tests d'intégration pour GET /api/stats/market (tendances du marché).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, user, n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);

async function listing(wilaya, price, surface) {
  const base = {
    title: 'Tendance-' + ++n, mode: 'vente', type_bien: 'appartement',
    price, wilaya, surface_m2: surface, description: 'Desc-' + n,
  };
  const r = await s.request('POST', '/api/properties', { token: user.token, body: base });
  assert.equal(r.status, 201);
  await q(`UPDATE properties SET status = 'active', published_at = now() WHERE id = $1`, [r.body.id]);
}

before(async () => {
  s    = await startServer();
  user = await s.register('market-user');
  // 3 annonces pour Oran (nécessite HAVING COUNT(*) >= 3)
  for (let i = 0; i < 3; i++) await listing('Oran', 10_000_000, 100);
});
after(async () => { await s.stop(); });

describe('GET /api/stats/market', () => {
  it('répond 200 avec une structure { wilayas }', async () => {
    const { status, body } = await s.request('GET', '/api/stats/market');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.wilayas), 'wilayas doit être un tableau');
  });

  it('chaque wilaya a wilaya, count, median_price_m2', async () => {
    const { body } = await s.request('GET', '/api/stats/market');
    if (!body.wilayas.length) return; // pas de données en environnement vide
    const row = body.wilayas[0];
    assert.ok(typeof row.wilaya         === 'string', 'wilaya manquant');
    assert.ok(typeof row.count          === 'number', 'count manquant');
    assert.ok(typeof row.median_price_m2 === 'number', 'median_price_m2 manquant');
  });

  it('exclut les wilayas avec moins de 3 annonces actives', async () => {
    // On ajoute 1 seule annonce pour Adrar, ne doit pas figurer
    await listing('Adrar', 5_000_000, 80);
    const { body } = await s.request('GET', '/api/stats/market');
    assert.ok(!body.wilayas.some(r => r.wilaya === 'Adrar'), 'Adrar ne devrait pas figurer (<3 annonces)');
  });

  it('Oran figure bien (>=3 annonces)', async () => {
    const { body } = await s.request('GET', '/api/stats/market');
    assert.ok(body.wilayas.some(r => r.wilaya === 'Oran'), 'Oran devrait figurer');
  });

  it('trié par median_price_m2 décroissant', async () => {
    const { body } = await s.request('GET', '/api/stats/market');
    const vals = body.wilayas.map(r => r.median_price_m2);
    for (let i = 1; i < vals.length; i++) {
      assert.ok(vals[i] <= vals[i - 1], `tri décroissant non respecté à l'index ${i}`);
    }
  });
});
