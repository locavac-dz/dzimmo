// Tests d'intégration — scoring pondéré des signalements (item 8).
// Vérifie que des membres vérifiés ou anciens déclenchent le retrait plus tôt que des membres normaux.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, owner, n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);

async function property() {
  const r = await s.request('POST', '/api/properties', { token: owner.token, body: {
    title: 'Report-score-' + ++n, mode: 'vente', type_bien: 'appartement',
    price: 5_000_000, wilaya: 'Alger', surface_m2: 80, description: 'Desc ' + n,
  } });
  assert.equal(r.status, 201);
  await q(`UPDATE properties SET status = 'active', published_at = now() WHERE id = $1`, [r.body.id]);
  return r.body.id;
}

// Membre fiable normal : email confirmé, inscrit depuis 2 jours (poids 1.0)
async function normal(tag) {
  const u = await s.register('score-normal-' + tag + '-' + n);
  await q(`UPDATE users SET email_verified = true, created_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [u.id]);
  return u;
}
// Membre fiable ancien (>30 jours) : poids 1.5
async function ancien(tag) {
  const u = await s.register('score-ancien-' + tag + '-' + n);
  await q(`UPDATE users SET email_verified = true, created_at = NOW() - INTERVAL '35 days' WHERE id = $1`, [u.id]);
  return u;
}
// Membre vérifié (identity) : poids 2.0
async function verifie(tag) {
  const u = await s.register('score-verifie-' + tag + '-' + n);
  await q(`UPDATE users SET email_verified = true, created_at = NOW() - INTERVAL '2 days', verified_kind = 'identity' WHERE id = $1`, [u.id]);
  return u;
}

before(async () => {
  s     = await startServer();
  owner = await s.register('owner-score');
});
after(async () => { await s.stop(); });

describe('Scoring pondéré des signalements', () => {
  it('2 membres normaux (score 2) → pas de retrait automatique (seuil 3)', async () => {
    const propId = await property();
    const [u1, u2] = await Promise.all([normal('n1'), normal('n2')]);
    await s.request('POST', `/api/properties/${propId}/signaler`, { token: u1.token, body: { motif: 'arnaque' } });
    await s.request('POST', `/api/properties/${propId}/signaler`, { token: u2.token, body: { motif: 'arnaque' } });
    const { rows } = await q(`SELECT status FROM properties WHERE id = $1`, [propId]);
    assert.equal(rows[0].status, 'active', '2 normaux (2.0) ne doivent pas déclencher le retrait');
  });

  it('1 vérifié + 1 normal (score 3.0) → retrait automatique', async () => {
    const propId = await property();
    const [uv, un] = await Promise.all([verifie('v1'), normal('n3')]);
    await s.request('POST', `/api/properties/${propId}/signaler`, { token: uv.token, body: { motif: 'arnaque' } });
    await s.request('POST', `/api/properties/${propId}/signaler`, { token: un.token, body: { motif: 'arnaque' } });
    const { rows } = await q(`SELECT status FROM properties WHERE id = $1`, [propId]);
    assert.equal(rows[0].status, 'pending', '1 vérifié (2) + 1 normal (1) = 3.0 ≥ 3 → doit passer en pending');
  });

  it('2 membres anciens (score 3.0) → retrait automatique', async () => {
    const propId = await property();
    const [a1, a2] = await Promise.all([ancien('a1'), ancien('a2')]);
    await s.request('POST', `/api/properties/${propId}/signaler`, { token: a1.token, body: { motif: 'faux' } });
    await s.request('POST', `/api/properties/${propId}/signaler`, { token: a2.token, body: { motif: 'faux' } });
    const { rows } = await q(`SELECT status FROM properties WHERE id = $1`, [propId]);
    assert.equal(rows[0].status, 'pending', '2 anciens (1.5 × 2 = 3.0) ≥ 3 → doit passer en pending');
  });

  it('3 membres normaux (score 3.0) → retrait automatique (compatibilité ascendante)', async () => {
    const propId = await property();
    const [u1, u2, u3] = await Promise.all([normal('c1'), normal('c2'), normal('c3')]);
    await s.request('POST', `/api/properties/${propId}/signaler`, { token: u1.token, body: { motif: 'doublon' } });
    await s.request('POST', `/api/properties/${propId}/signaler`, { token: u2.token, body: { motif: 'doublon' } });
    await s.request('POST', `/api/properties/${propId}/signaler`, { token: u3.token, body: { motif: 'doublon' } });
    const { rows } = await q(`SELECT status FROM properties WHERE id = $1`, [propId]);
    assert.equal(rows[0].status, 'pending', '3 normaux (3.0 ≥ 3) → doit toujours déclencher le retrait');
  });
});
