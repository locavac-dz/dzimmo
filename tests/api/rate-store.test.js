// Limitation de débit partagée entre les workers pm2 (server/rate-store.js) : les compteurs vivent dans PostgreSQL.
// Les limiteurs de l'application sont désactivés pendant les tests (skip) : on en monte ici de vrais, sur deux « workers ».
const test      = require('node:test');
const assert    = require('node:assert/strict');
const http      = require('node:http');
const fs        = require('node:fs');
const path      = require('node:path');
const express   = require('express');
const rateLimit = require('express-rate-limit');
const { startServer } = require('../helpers/server');

let s, rateStore;
const q = (sql, p) => s.db.pool.query(sql, p);
const servers = [];

// Un « worker » : sa propre application Express, son propre limiteur, donc sa propre mémoire
async function worker(prefix, max, store) {
  const app = express();
  app.use(rateLimit({ windowMs: 60000, max, standardHeaders: true, legacyHeaders: false, passOnStoreError: true,
    store: store || new rateStore.PgStore(prefix), message: { error: 'Trop de requêtes. Réessayez dans une minute.' } }));
  app.get('/', (_, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return () => fetch(`http://127.0.0.1:${server.address().port}/`).then(r => r.status);
}

test.before(async () => {
  s = await startServer();
  rateStore = require('../../server/rate-store');     // après startServer : ce module utilise la connexion à la base
});
test.after(async () => {
  await Promise.all(servers.map(sv => new Promise(r => sv.close(r))));
  await s.stop();
});

test('deux workers partagent le même compteur : la limite vaut pour l\'ensemble, pas pour chacun', async () => {
  const [w1, w2] = [await worker('essai', 4), await worker('essai', 4)];
  assert.deepEqual([await w1(), await w2(), await w1(), await w2()], [200, 200, 200, 200]);
  assert.deepEqual([await w1(), await w2()], [429, 429], 'la cinquième requête est refusée, quel que soit le worker');
  const rows = (await q("SELECT key, hits, reset_at > now() AS futur FROM rate_limits WHERE key LIKE 'essai:%'")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hits, 6);
  assert.equal(rows[0].futur, true);
  assert.doesNotMatch(rows[0].key, /127\.0\.0\.1|::1/, 'aucune adresse IP en base');
  // Un autre limiteur (autre préfixe) a son propre compteur
  assert.equal(await (await worker('autre', 4))(), 200);
});

test('fenêtre terminée : le compteur repart de un ; requêtes simultanées : aucune n\'est perdue', async () => {
  const hits = await Promise.all(Array.from({ length: 25 }, () => rateStore.hit('rafale', 'visiteur', 60000)));
  assert.deepEqual(hits.map(h => h.totalHits).sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));
  await q("UPDATE rate_limits SET reset_at = now() - interval '1 second' WHERE key = $1", [rateStore.hashKey('rafale', 'visiteur')]);
  const again = await rateStore.hit('rafale', 'visiteur', 60000);
  assert.equal(again.totalHits, 1);
  assert.ok(again.resetTime > new Date(), 'nouvelle fenêtre');
});

test('base injoignable : la requête passe (le site reste utilisable)', async () => {
  const broken = new rateStore.PgStore('panne');
  broken.increment = async () => { throw new Error('connexion perdue'); };
  const w = await worker('panne', 1, broken);
  assert.deepEqual([await w(), await w(), await w()], [200, 200, 200]);
});

test('tous les limiteurs de l\'application utilisent le compteur partagé, chacun avec son préfixe', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'app.js'), 'utf8');
  const limiters = src.match(/rateLimit\(\{/g).length;
  const prefixes = [...src.matchAll(/rateLimit\(\{\s*\.\.\.shared\('([\w-]+)'\)/g)].map(m => m[1]);
  assert.ok(limiters >= 5);
  assert.equal(prefixes.length, limiters, 'un limiteur sans ...shared(\'préfixe\') compterait par worker');
  assert.equal(new Set(prefixes).size, prefixes.length, 'préfixes distincts');
});
