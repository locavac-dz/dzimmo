// Révocation des sessions : un jeton émis avant la date « sessions_valid_after » du compte est refusé partout (API, administration,
// fiches non publiques, WebSocket). L'accès administrateur est relu en base : rétrogradation ou suspension immédiates.
const test   = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const jwt    = require('jsonwebtoken');
const WebSocket = require('ws');
const { startServer } = require('../helpers/server');

// Ces modules ouvrent la connexion à la base au chargement : ils ne se chargent qu'APRÈS startServer(), qui redirige la
// base vers un schéma jetable (chargés avant, les tests écrivaient dans la base de développement).
let revokeSessions, isRevoked;
let s, server, wsUrl, wsHub, admin;
const q = (sql, p) => s.db.pool.query(sql, p);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const untilNextSecond = () => sleep(1000 - (Date.now() % 1000) + 30);
const login = (user, password = 'motdepasse1') => s.request('POST', '/api/auth/login', { body: { email: user.email, password } });

test.before(async () => {
  s = await startServer();
  ({ revokeSessions, isRevoked } = require('../../server/sessions'));
  admin = await s.makeAdmin(await s.register('admin'));
  // Serveur HTTP + WebSocket réels (le helper ne démarre pas les WebSocket)
  wsHub = require('../../server/ws');
  server = http.createServer(require('../../server/app'));
  wsHub.setup(server);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  wsUrl = `ws://127.0.0.1:${server.address().port}/ws`;
});
test.after(async () => { await new Promise(r => server.close(r)); await s.stop(); });

test('isRevoked : compare le « iat » du jeton à la date du compte, à la seconde', () => {
  const t = 1_700_000_000;
  const at = sec => ({ sessions_valid_after: new Date(sec * 1000) });
  assert.equal(isRevoked({ iat: t - 1 }, at(t)), true, 'émis avant : refusé');
  assert.equal(isRevoked({ iat: t }, at(t)), false, 'émis dans la même seconde : valable (nouvelle connexion)');
  assert.equal(isRevoked({ iat: t + 5 }, at(t)), false);
  assert.equal(isRevoked({ iat: t - 1 }, { sessions_valid_after: null }), false, 'jamais révoqué');
  assert.equal(isRevoked({ iat: t - 1 }, {}), false);
  assert.equal(isRevoked({}, at(t)), false, 'sans iat : NaN < x est faux (jamais signé ainsi par le serveur)');
  assert.equal(isRevoked({ iat: t }, { sessions_valid_after: new Date(t * 1000 + 999) }), false, 'les millisecondes ne comptent pas');
});

test('jeton révoqué : refusé sur les routes protégées, un nouveau jeton fonctionne', async () => {
  const u = await s.register('revoque');
  assert.equal((await s.request('GET', '/api/auth/me', { token: u.token })).status, 200);
  await untilNextSecond();
  await revokeSessions(u.id);
  for (const [method, url] of [['GET', '/api/auth/me'], ['GET', '/api/favorites'], ['GET', '/api/messages'], ['GET', '/api/verification/me'], ['PUT', '/api/auth/profile']]) {
    const r = await s.request(method, url, { token: u.token, body: method === 'PUT' ? { name: 'x' } : undefined });
    assert.equal(r.status, 401, `${method} ${url}`);
    assert.equal(r.body.error, 'Token expiré ou invalide.');
  }
  const again = await login(u);
  assert.equal(again.status, 200);
  assert.equal((await s.request('GET', '/api/auth/me', { token: again.body.token })).status, 200);
});

test('les autres comptes ne sont pas touchés par la révocation d\'un compte', async () => {
  const [a, b] = [await s.register('rev-a'), await s.register('rev-b')];
  await untilNextSecond(); await revokeSessions(a.id);
  assert.equal((await s.request('GET', '/api/auth/me', { token: a.token })).status, 401);
  assert.equal((await s.request('GET', '/api/auth/me', { token: b.token })).status, 200);
});

test('administration : jeton révoqué, compte rétrogradé ou suspendu = accès refusé tout de suite', async () => {
  const boss = await s.makeAdmin(await s.register('patron'));
  assert.equal((await s.request('GET', '/api/admin/users', { token: boss.token })).status, 200);
  // Jeton signé correctement et affirmant « is_admin », mais le compte n'est plus administrateur : refus
  await q('UPDATE users SET is_admin = false WHERE id = $1', [boss.id]);
  const stale = await s.request('GET', '/api/admin/users', { token: boss.token });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.error, 'Accès réservé aux administrateurs.');
  await q('UPDATE users SET is_admin = true WHERE id = $1', [boss.id]);
  assert.equal((await s.request('GET', '/api/admin/users', { token: boss.token })).status, 200, 'rôle rétabli : accès rétabli');
  // Suspendu
  await q('UPDATE users SET banned = true WHERE id = $1', [boss.id]);
  assert.equal((await s.request('GET', '/api/admin/users', { token: boss.token })).status, 403);
  await q('UPDATE users SET banned = false WHERE id = $1', [boss.id]);
  // Sessions révoquées
  await untilNextSecond(); await revokeSessions(boss.id);
  assert.equal((await s.request('GET', '/api/admin/users', { token: boss.token })).status, 401);
  assert.equal((await s.request('PUT', `/api/admin/users/${admin.id}/ban`, { token: boss.token, body: { banned: true } })).status, 401);
  // Compte supprimé
  const gone = await s.makeAdmin(await s.register('supprime'));
  await q('DELETE FROM users WHERE id = $1', [gone.id]);
  assert.equal((await s.request('GET', '/api/admin/users', { token: gone.token })).status, 403);
});

test('administration : jeton falsifié ou expiré toujours refusé (401), sans jeton (401)', async () => {
  assert.equal((await s.request('GET', '/api/admin/users')).status, 401);
  const forged = jwt.sign({ id: admin.id, is_admin: true }, 'pas-le-bon-secret');
  assert.equal((await s.request('GET', '/api/admin/users', { token: forged })).status, 401);
  const expired = jwt.sign({ id: admin.id, is_admin: true, iat: Math.floor(Date.now() / 1000) - 100 }, process.env.JWT_SECRET, { expiresIn: 1 });
  assert.equal((await s.request('GET', '/api/admin/users', { token: expired })).status, 401);
  assert.equal((await s.request('GET', '/api/admin/users', { token: admin.token })).status, 200);
});

test('fiche non publique : un jeton révoqué ne donne plus le droit de la voir (404), le propriétaire actuel oui', async () => {
  const owner = await s.register('proprio-rev');
  const id = (await s.request('POST', '/api/properties', { token: owner.token, body: { title: 'En attente', mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Oran', photos: [] } })).body.id;
  assert.equal((await s.request('GET', `/api/properties/${id}`, { token: owner.token })).status, 200, 'le propriétaire voit son annonce en attente');
  assert.equal((await s.request('GET', `/api/properties/${id}`)).status, 404, 'le public non');
  await untilNextSecond(); await revokeSessions(owner.id);
  assert.equal((await s.request('GET', `/api/properties/${id}`, { token: owner.token })).status, 404, 'ancien jeton : plus de droit particulier');
  const fresh = await login(owner);
  assert.equal((await s.request('GET', `/api/properties/${id}`, { token: fresh.body.token })).status, 200);
  // Suspendu : idem
  await q('UPDATE users SET banned = true WHERE id = $1', [owner.id]);
  assert.equal((await s.request('GET', `/api/properties/${id}`, { token: fresh.body.token })).status, 404);
  // Une annonce publique reste visible de tous, avec ou sans jeton révoqué
  await q('UPDATE users SET banned = false WHERE id = $1', [owner.id]);
  await q(`UPDATE properties SET status = 'active' WHERE id = $1`, [id]);
  assert.equal((await s.request('GET', `/api/properties/${id}`, { token: owner.token })).status, 200);
});

// WebSocket : connexion avec jeton, renvoie 'open' + messages reçus, ou 'closed' + code
function connect(token) {
  return new Promise(resolve => {
    const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token || '')}`);
    const r = { messages: [], ws };
    ws.on('open', () => { r.opened = true; });
    ws.on('message', m => r.messages.push(JSON.parse(m)));
    ws.on('close', code => { r.code = code; resolve(r); });
    ws.on('error', () => {});
    r.settled = ws;
    setTimeout(() => resolve(r), 900);   // encore ouverte après 0,9 s : acceptée
  });
}

test('WebSocket : jeton valide reçoit ses notifications ; jeton révoqué, compte suspendu ou jeton invalide sont fermés (4001)', async () => {
  const u = await s.register('ws');
  const ok = await connect(u.token);
  assert.equal(ok.code, undefined, 'connexion maintenue');
  wsHub.send(u.id, { type: 'notif', n: 1 });
  await sleep(150);
  assert.deepEqual(ok.messages, [{ type: 'notif', n: 1 }]);
  ok.ws.close();

  assert.equal((await connect('')).code, 4001, 'sans jeton');
  assert.equal((await connect('abc.def.ghi')).code, 4001, 'jeton invalide');
  assert.equal((await connect(jwt.sign({ id: u.id }, 'autre-secret'))).code, 4001, 'signature fausse');

  await untilNextSecond(); await revokeSessions(u.id);
  const revoked = await connect(u.token);
  assert.equal(revoked.code, 4001, 'jeton révoqué');
  const fresh = (await login(u)).body.token;
  const again = await connect(fresh);
  assert.equal(again.code, undefined, 'nouveau jeton accepté');
  again.ws.close();

  await q('UPDATE users SET banned = true WHERE id = $1', [u.id]);
  assert.equal((await connect(fresh)).code, 4001, 'compte suspendu');
  const ghost = await s.register('ws-fantome');
  await q('DELETE FROM users WHERE id = $1', [ghost.id]);
  assert.equal((await connect(ghost.token)).code, 4001, 'compte supprimé');
});

test('WebSocket : une connexion fermée avant la vérification n\'est pas enregistrée', async () => {
  const u = await s.register('ws-vite');
  const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(u.token)}`);
  await new Promise(r => ws.on('open', r));
  ws.terminate();                        // fermée immédiatement, avant la fin de la lecture du compte en base
  await sleep(300);
  let received = false;
  ws.on('message', () => { received = true; });
  wsHub.send(u.id, { type: 'notif' });   // aucune connexion locale : ne doit ni planter ni rien livrer
  await sleep(100);
  assert.equal(received, false);
});
