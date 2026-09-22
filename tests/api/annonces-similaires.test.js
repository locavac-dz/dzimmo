// Tests d'intégration pour GET /api/properties/:id/similar.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, user, other, n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);

async function listing(owner, over = {}) {
  const base = { title: 'Sim-' + ++n, mode: 'vente', type_bien: 'appartement',
    price: 8000000, wilaya: 'Alger', surface_m2: 80, description: 'Desc-' + n, ...over };
  const r = await s.request('POST', '/api/properties', { token: owner.token, body: base });
  assert.equal(r.status, 201, `listing() a échoué (${r.status}) : ${JSON.stringify(r.body)}`);
  await q(`UPDATE properties SET status = 'active', published_at = now() WHERE id = $1`, [r.body.id]);
  return r.body.id;
}

before(async () => {
  s     = await startServer();
  user  = await s.register('sim-user');
  other = await s.register('sim-other');
});
after(async () => { await s.stop(); });

describe('GET /api/properties/:id/similar', () => {
  it('id inconnu : tableau vide', async () => {
    const { status, body } = await s.request('GET', '/api/properties/999999/similar');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });

  it('annonce inactive : tableau vide', async () => {
    const r = await s.request('POST', '/api/properties', { token: user.token, body: {
      title: 'Pending', mode: 'vente', type_bien: 'appartement', price: 8000000,
      wilaya: 'Alger', surface_m2: 80, description: 'X' } });
    assert.equal(r.status, 201);
    const { body } = await s.request('GET', `/api/properties/${r.body.id}/similar`);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });

  it("renvoie les biens actifs similaires sans l'original", async () => {
    const idRef  = await listing(user,  { commune: 'Hydra' });
    const idSim  = await listing(other, { commune: 'Kouba' });
    const { status, body } = await s.request('GET', `/api/properties/${idRef}/similar`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    // L'original n'est jamais dans la liste
    assert.ok(!body.some(p => p.id === idRef));
    // Le bien similaire y est
    assert.ok(body.some(p => p.id === idSim));
  });

  it('la commune identique passe en premier', async () => {
    const idRef      = await listing(user,  { commune: 'Bab Ezzouar', price: 7000000 });
    const idSameComm = await listing(other, { commune: 'Bab Ezzouar', price: 7500000 });
    const idOther    = await listing(other, { commune: 'Sidi Abdallah', price: 7200000 });
    const { body } = await s.request('GET', `/api/properties/${idRef}/similar`);
    const ids = body.map(p => p.id);
    const posSame  = ids.indexOf(idSameComm);
    const posOther = ids.indexOf(idOther);
    if (posSame !== -1 && posOther !== -1) {
      assert.ok(posSame < posOther, 'la commune identique doit précéder les autres');
    }
  });

  it('respecte la fourchette de prix ±50 %', async () => {
    const price = 10000000;
    const idRef      = await listing(user,  { price, wilaya: 'Oran' });
    const idDansZone = await listing(other, { price: price * 1.4, wilaya: 'Oran' }); // dans ±50 %
    const idHorsPrix = await listing(other, { price: price * 2,   wilaya: 'Oran' }); // hors ±50 %
    const { body } = await s.request('GET', `/api/properties/${idRef}/similar`);
    assert.ok(body.some(p => p.id === idDansZone), 'prix dans la fourchette attendu');
    assert.ok(!body.some(p => p.id === idHorsPrix), 'prix hors fourchette absent');
  });

  it('exclut les biens inactifs', async () => {
    const idRef  = await listing(user);
    const r      = await s.request('POST', '/api/properties', { token: other.token, body: {
      title: 'Inactif', mode: 'vente', type_bien: 'appartement', price: 8000000,
      wilaya: 'Alger', surface_m2: 80, description: 'X' } });
    assert.equal(r.status, 201);
    const idPending = r.body.id; // reste pending
    const { body } = await s.request('GET', `/api/properties/${idRef}/similar`);
    assert.ok(!body.some(p => p.id === idPending), 'bien pending absent');
  });

  it('ne renvoie pas plus de 6 résultats', async () => {
    const idRef = await listing(user, { wilaya: 'Blida', price: 5000000 });
    for (let i = 0; i < 8; i++)
      await listing(other, { wilaya: 'Blida', price: 5000000 + i * 100000 });
    const { body } = await s.request('GET', `/api/properties/${idRef}/similar`);
    assert.ok(body.length <= 6);
  });
});
