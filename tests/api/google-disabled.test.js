// Sans GOOGLE_CLIENT_ID (cas par défaut) : aucune ouverture de la politique de sécurité, pas de bouton, route de connexion fermée.
const test   = require('node:test');
const assert = require('node:assert/strict');

delete process.env.GOOGLE_CLIENT_ID;      // avant le chargement de l'application
const { startServer } = require('../helpers/server');

let s;
test.before(async () => { s = await startServer(); });
test.after(async () => { await s.stop(); });

test('aucun accès à Google dans la politique de sécurité tant que la connexion Google n\'est pas configurée', async () => {
  for (const url of ['/', '/api/health', '/annonces-inconnues']) {
    const r = await s.request('GET', url);
    const csp = r.headers.get('content-security-policy');
    assert.ok(csp, url);
    assert.doesNotMatch(csp, /google/i, url);
    assert.doesNotMatch(csp, /frame-src/, 'les cadres restent limités par default-src');
    assert.notEqual(r.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups', url);
    assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin', 'valeur stricte de helmet conservée');
  }
});

test('le site ne reçoit pas d\'identifiant client : le bouton reste masqué', async () => {
  assert.deepEqual((await s.request('GET', '/api/auth/config')).body, { google_client_id: null });
});

test('la route de connexion Google est fermée (503), même avec un jeton', async () => {
  const r = await s.request('POST', '/api/auth/google', { body: { credential: 'a.b.c' } });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'Connexion Google indisponible.');
  assert.equal((await s.request('POST', '/api/auth/google', { body: {} })).status, 503, 'même sans jeton : indisponible avant tout examen');
});
