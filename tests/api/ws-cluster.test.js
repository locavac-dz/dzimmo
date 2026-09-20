// Notifications temps réel entre workers (pm2 en mode cluster) : diffusion par LISTEN / NOTIFY PostgreSQL.
// Deux « workers » sont simulés par deux hubs indépendants qui partagent un canal, chacun avec ses connexions locales.
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { createHub } = require('../../server/ws');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL });
const CHANNEL = 'dz_ws_test_' + crypto.randomBytes(4).toString('hex');
const hubs = [];
const hub = (opts = {}) => { const h = createHub({ getPool: () => pool, channel: CHANNEL, retryMs: 100, ...opts }); hubs.push(h); return h; };
const fakeWs = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(JSON.parse(m)); } });
const until = async (cond, ms = 3000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('délai dépassé'); await new Promise(r => setTimeout(r, 20)); } };
const pause = ms => new Promise(r => setTimeout(r, ms));

test.after(async () => { await Promise.all(hubs.map(h => h.close())); await pool.end(); });

test('un message envoyé depuis un worker atteint la connexion d\'un autre worker, une seule fois', async () => {
  const [A, B] = [hub(), hub()];
  const wsB = fakeWs(), wsA = fakeWs(), autre = fakeWs();
  B.add(7, wsB); A.add(7, wsA);          // le même utilisateur a deux onglets, sur deux workers
  A.add(9, autre);                       // un autre utilisateur
  await Promise.all([A.listen(), B.listen()]);
  A.send(7, { type: 'notif', title: 'Bonjour' });
  await until(() => wsA.sent.length && wsB.sent.length);
  await pause(250);                      // laisse arriver un éventuel doublon
  assert.deepEqual(wsB.sent, [{ type: 'notif', title: 'Bonjour' }]);
  assert.deepEqual(wsA.sent, [{ type: 'notif', title: 'Bonjour' }], 'le worker émetteur reçoit aussi, sans doublon');
  assert.deepEqual(autre.sent, [], 'un autre utilisateur ne reçoit rien');
  await A.close(); await B.close();
});

test('sans écoute active : remise directe aux connexions du worker courant', async () => {
  const A = hub(), B = hub();
  const wsA = fakeWs(), wsB = fakeWs();
  A.add(5, wsA); B.add(5, wsB);
  assert.equal(A.isListening(), false);
  A.send(5, { n: 1 });
  assert.deepEqual(wsA.sent, [{ n: 1 }], 'immédiat, sans base de données');
  assert.deepEqual(wsB.sent, []);
});

test('connexion fermée, absente ou en cours de fermeture : ignorée sans erreur', async () => {
  const A = hub();
  const ferme = fakeWs(); ferme.readyState = 3;
  const casse = { readyState: 1, send() { throw new Error('socket cassée'); } };
  const bon = fakeWs();
  A.add(3, ferme); A.add(3, casse); A.add(3, bon);
  A.send(3, { ok: true });
  assert.deepEqual(bon.sent, [{ ok: true }]);
  assert.deepEqual(ferme.sent, []);
  A.send(404, { personne: true });                 // aucun destinataire
});

test('déconnexion : la connexion retirée ne reçoit plus rien', async () => {
  const A = hub();
  const ws = fakeWs();
  const remove = A.add(4, ws);
  A.send(4, { n: 1 });
  remove();
  A.send(4, { n: 2 });
  assert.deepEqual(ws.sent, [{ n: 1 }]);
});

test('accents, arabe et guillemets traversent la base sans altération', async () => {
  const [A, B] = [hub(), hub()];
  const ws = fakeWs(); B.add(11, ws);
  await Promise.all([A.listen(), B.listen()]);
  const data = { type: 'message', body: 'Salut « l\'ami » — "prix" 5 000 000 DA\nمرحباً بكم، الإعلان متوفر ✅', n: 3 };
  A.send(11, data);
  await until(() => ws.sent.length);
  assert.deepEqual(ws.sent[0], data);
  await A.close(); await B.close();
});

test('message trop gros pour une notification PostgreSQL : remis localement seulement', async () => {
  const [A, B] = [hub(), hub()];
  const wsA = fakeWs(), wsB = fakeWs();
  A.add(2, wsA); B.add(2, wsB);
  await Promise.all([A.listen(), B.listen()]);
  A.send(2, { gros: 'x'.repeat(9000) });
  await pause(300);
  assert.equal(wsA.sent.length, 1, 'le worker émetteur le remet directement');
  assert.equal(wsB.sent.length, 0, 'les autres workers ne le reçoivent pas (limite de 8000 octets)');
  await A.close(); await B.close();
});

test('deux canaux distincts ne se mélangent pas', async () => {
  const A = hub(), autreCanal = hub({ channel: CHANNEL + '_bis' });
  const ws = fakeWs(); autreCanal.add(8, ws);
  await Promise.all([A.listen(), autreCanal.listen()]);
  A.send(8, { n: 1 });
  await pause(300);
  assert.deepEqual(ws.sent, []);
  await A.close(); await autreCanal.close();
});

test('la connexion d\'écoute coupée est rétablie automatiquement, les envois pendant la coupure restent locaux', async () => {
  const [A, B] = [hub(), hub()];
  const wsB = fakeWs(); B.add(6, wsB);
  await Promise.all([A.listen(), B.listen()]);

  // Coupe côté serveur la connexion d'écoute du worker B
  const { rows } = await pool.query(
    `SELECT pid FROM pg_stat_activity WHERE query = $1 AND pid <> pg_backend_pid()`, ['LISTEN ' + CHANNEL]);
  assert.equal(rows.length, 2, 'une connexion d\'écoute par worker');
  await pool.query('SELECT pg_terminate_backend($1)', [rows[1].pid]);
  await until(() => !A.isListening() || !B.isListening());
  await until(() => A.isListening() && B.isListening());   // rétablie

  A.send(6, { apres: 'reconnexion' });
  await until(() => wsB.sent.length);
  assert.deepEqual(wsB.sent, [{ apres: 'reconnexion' }]);
  await A.close(); await B.close();
});

test('close() arrête l\'écoute et repasse en remise locale', async () => {
  const A = hub();
  const ws = fakeWs(); A.add(1, ws);
  await A.listen();
  assert.equal(A.isListening(), true);
  await A.close();
  assert.equal(A.isListening(), false);
  A.send(1, { local: true });
  assert.deepEqual(ws.sent, [{ local: true }]);
  await pause(300);
  assert.equal(A.isListening(), false, 'pas de reconnexion après close()');
});

test('base injoignable : listen() échoue proprement, l\'envoi reste local', async () => {
  const cassee = new Pool({ connectionString: 'postgresql://x:y@127.0.0.1:1/nulle_part', connectionTimeoutMillis: 500 });
  const A = createHub({ getPool: () => cassee, channel: CHANNEL, retryMs: 60000 });
  const ws = fakeWs(); A.add(1, ws);
  await assert.rejects(() => A.listen());
  A.send(1, { n: 1 });
  assert.deepEqual(ws.sent, [{ n: 1 }]);
  await A.close(); await cassee.end();
});

test('nom de canal invalide refusé (il est inséré dans LISTEN)', () => {
  assert.throws(() => createHub({ channel: 'x; DROP TABLE users' }), /Nom de canal invalide/);
  assert.throws(() => createHub({ channel: '1abc' }), /Nom de canal invalide/);
});
