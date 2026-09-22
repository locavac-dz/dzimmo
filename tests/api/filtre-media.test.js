// Tests d'intégration pour ?has_video=1 et ?has_tour=1 de GET /api/properties.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, user, n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);

async function listing(owner, over = {}) {
  const base = { title: 'FiltreMedia-' + ++n, mode: 'vente', type_bien: 'appartement',
    price: 5000000, wilaya: 'Alger', surface_m2: 80, description: 'Desc-' + n, ...over };
  const r = await s.request('POST', '/api/properties', { token: owner.token, body: base });
  assert.equal(r.status, 201, `listing() a échoué (${r.status})`);
  await q(`UPDATE properties SET status = 'active', published_at = now() WHERE id = $1`, [r.body.id]);
  return r.body.id;
}

before(async () => { s = await startServer(); user = await s.register('media-user'); });
after(async ()  => { await s.stop(); });

describe('GET /api/properties?has_video=1', () => {
  it('renvoie seulement les biens avec video_url', async () => {
    const idAvec = await listing(user, { video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    const idSans = await listing(user);
    const { body } = await s.request('GET', '/api/properties?status=active&has_video=1&limit=200');
    assert.ok(body.data.some(p => p.id === idAvec), 'bien avec vidéo attendu');
    assert.ok(!body.data.some(p => p.id === idSans), 'bien sans vidéo ne doit pas apparaître');
  });

  it('has_video=0 : pas de filtre (tous les biens)', async () => {
    const { status } = await s.request('GET', '/api/properties?status=active&has_video=0');
    assert.equal(status, 200);
  });
});

describe('GET /api/properties?has_tour=1', () => {
  it('renvoie seulement les biens avec tour_url', async () => {
    const idAvec = await listing(user, { tour_url: 'https://kuula.co/share/abc123' });
    const idSans = await listing(user);
    const { body } = await s.request('GET', '/api/properties?status=active&has_tour=1&limit=200');
    assert.ok(body.data.some(p => p.id === idAvec), 'bien avec visite attendu');
    assert.ok(!body.data.some(p => p.id === idSans), 'bien sans visite ne doit pas apparaître');
  });
});

describe('GET /api/properties?has_video=1&has_tour=1', () => {
  it('ET logique : doit avoir les deux', async () => {
    const idBoth = await listing(user, {
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      tour_url:  'https://kuula.co/share/abc123',
    });
    const idVideo = await listing(user, { video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    const { body } = await s.request('GET', '/api/properties?status=active&has_video=1&has_tour=1&limit=200');
    assert.ok(body.data.some(p => p.id === idBoth),  'bien avec les deux attendu');
    assert.ok(!body.data.some(p => p.id === idVideo), 'bien sans visite ne doit pas apparaître');
  });
});
