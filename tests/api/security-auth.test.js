// En-têtes de sécurité (helmet), API publique et authentification.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s;
test.before(async () => { s = await startServer(); });
test.after(async () => { await s.stop(); });

test('helmet : en-têtes de sécurité présents, X-Powered-By absent', async () => {
  const { headers } = await s.request('GET', '/api/health');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(headers.get('x-powered-by'), null);
});

test('CSP : sources restreintes, pas de http: ni d\'objet / iframe étranger', async () => {
  const csp = (await s.request('GET', '/')).headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/cdnjs\.cloudflare\.com/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /connect-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/, 'pas de réécriture https hors production');
  assert.doesNotMatch(csp, /script-src[^;]*\*/, 'aucun joker dans script-src');
});

test('HSTS désactivé hors production', async () => {
  assert.equal((await s.request('GET', '/api/health')).headers.get('strict-transport-security'), null);
});

test('GET /api/health', async () => {
  const r = await s.request('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('les routes protégées refusent les requêtes sans jeton', async () => {
  for (const [method, url] of [['POST', '/api/properties'], ['GET', '/api/auth/me'], ['GET', '/api/admin/users'],
                               ['GET', '/api/admin/moderation'], ['GET', '/api/stats']]) {
    const r = await s.request(method, url);
    assert.equal(r.status, 401, `${method} ${url}`);
  }
});

test('statistiques publiques : agrégats seulement, sans donnée personnelle', async () => {
  const r = await s.request('GET', '/api/stats/public');
  assert.equal(r.status, 200);
  for (const k of ['active', 'users', 'agencies', 'top_wilayas', 'top_types']) assert.ok(k in r.body, k);
  assert.doesNotMatch(r.text, /@|password|token/i);
  assert.match(r.headers.get('cache-control'), /max-age=60/);
});

test('inscription : validations', async () => {
  const bad = [
    [{ email: 'a@b.dz', password: 'motdepasse1' }, 400, 'nom manquant'],
    [{ name: 'X', email: 'pas-un-email', password: 'motdepasse1' }, 400, 'email invalide'],
    [{ name: 'X', email: 'court@test.dz', password: '123' }, 400, 'mot de passe trop court'],
  ];
  for (const [body, status, label] of bad) assert.equal((await s.request('POST', '/api/auth/register', { body })).status, status, label);
});

test('inscription : ne divulgue ni mot de passe ni jeton de vérification, refuse un doublon', async () => {
  const email = 'doublon@test.dz';
  const r = await s.request('POST', '/api/auth/register', { body: { name: 'Doublon', email, password: 'motdepasse1' } });
  assert.equal(r.status, 201);
  assert.ok(r.body.token);
  assert.equal(r.body.user.is_admin, false);
  assert.doesNotMatch(r.text, /"password"|verification_token|\$2[aby]\$/);
  const again = await s.request('POST', '/api/auth/register', { body: { name: 'Doublon', email: email.toUpperCase(), password: 'motdepasse1' } });
  assert.equal(again.status, 409, 'l\'email est insensible à la casse');
});

test('connexion : succès, mauvais mot de passe, compte suspendu', async () => {
  const u = await s.register('login');
  const ok = await s.request('POST', '/api/auth/login', { body: { email: u.email, password: 'motdepasse1' } });
  assert.equal(ok.status, 200);
  assert.equal((await s.request('GET', '/api/auth/me', { token: ok.body.token })).body.email, u.email);
  assert.equal((await s.request('POST', '/api/auth/login', { body: { email: u.email, password: 'faux-mot-de-passe' } })).status, 401);
  assert.equal((await s.request('POST', '/api/auth/login', { body: { email: 'inconnu@test.dz', password: 'motdepasse1' } })).status, 401,
    'même réponse pour un compte inconnu');

  await s.db.pool.query('UPDATE users SET banned = true WHERE id = $1', [u.id]);
  assert.equal((await s.request('POST', '/api/auth/login', { body: { email: u.email, password: 'motdepasse1' } })).status, 403);
  assert.equal((await s.request('GET', '/api/auth/me', { token: ok.body.token })).status, 403, 'un jeton existant est refusé après suspension');
});

test('un jeton falsifié ou expiré est refusé', async () => {
  const jwt = require('jsonwebtoken');
  const u = await s.register('jwt');
  const forged = jwt.sign({ id: u.id, is_admin: true }, 'mauvais-secret');
  assert.equal((await s.request('GET', '/api/admin/users', { token: forged })).status, 401);
  const expired = jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: -10 });
  assert.equal((await s.request('GET', '/api/auth/me', { token: expired })).status, 401);
});

test('un utilisateur ordinaire n\'accède pas aux routes d\'administration', async () => {
  const u = await s.register('nonadmin');
  for (const url of ['/api/admin/users', '/api/admin/properties', '/api/admin/moderation', '/api/stats'])
    assert.equal((await s.request('GET', url, { token: u.token })).status, 403, url);
});
