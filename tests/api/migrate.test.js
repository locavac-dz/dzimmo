// Migrations : chaque fichier s'applique dans une vraie transaction (une seule connexion) et une seule fois, même si plusieurs
// workers pm2 démarrent en même temps (verrou consultatif).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { startServer } = require('../helpers/server');

let s, migrate, dir;
const q = (sql, p) => s.db.pool.query(sql, p);
const silent = { log() {} };
const exists = async table => (await q('SELECT to_regclass($1) AS t', [table])).rows[0].t !== null;

test.before(async () => {
  s = await startServer();
  migrate = require('../../server/migrate');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dzimmo-migrations-'));
});
test.after(async () => { fs.rmSync(dir, { recursive: true, force: true }); await s.stop(); });

test('une migration qui échoue à mi-chemin est entièrement annulée, puis rejouable une fois corrigée', async () => {
  fs.writeFileSync(path.join(dir, '900_ok.sql'), 'CREATE TABLE mig_ok (id int);');
  fs.writeFileSync(path.join(dir, '901_casse.sql'), 'CREATE TABLE mig_moitie (id int); INSERT INTO mig_moitie VALUES (1); SELECT 1/0;');
  await assert.rejects(migrate.withStartupLock(s.db.pool, c => migrate(c, dir, silent)), /\[migrate\] ❌ 901_casse\.sql/);
  assert.equal(await exists('mig_ok'), true, 'la migration précédente reste appliquée');
  assert.equal(await exists('mig_moitie'), false, 'rien ne reste de la migration échouée');
  const applied = (await q(`SELECT filename FROM schema_migrations WHERE filename LIKE '90%' ORDER BY 1`)).rows.map(r => r.filename);
  assert.deepEqual(applied, ['900_ok.sql']);

  // La connexion rendue au pool n'est pas restée dans une transaction avortée
  assert.equal((await q('SELECT 1 AS n')).rows[0].n, 1);

  fs.writeFileSync(path.join(dir, '901_casse.sql'), 'CREATE TABLE mig_moitie (id int); INSERT INTO mig_moitie VALUES (1);');
  await migrate.withStartupLock(s.db.pool, c => migrate(c, dir, silent));
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM mig_moitie')).rows[0].n, 1);
});

test('démarrages simultanés (pm2 cluster) : chaque migration n\'est appliquée qu\'une fois', async () => {
  // Non rejouable exprès : appliquée deux fois, la seconde échouerait (table déjà créée) ou doublerait la ligne
  fs.writeFileSync(path.join(dir, '902_unique.sql'), 'CREATE TABLE mig_unique (id int); INSERT INTO mig_unique VALUES (1);');
  const logs = [];
  const log = { log: m => logs.push(m) };
  await Promise.all([1, 2, 3, 4].map(() => migrate.withStartupLock(s.db.pool, c => migrate(c, dir, log))));
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM mig_unique')).rows[0].n, 1);
  assert.equal(logs.filter(m => m.includes('902_unique.sql')).length, 1);
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM schema_migrations WHERE filename = '902_unique.sql'`)).rows[0].n, 1);
});

test('les migrations du dépôt sont toutes enregistrées, et aucune n\'emploie une instruction interdite en transaction', async () => {
  const repo = path.join(__dirname, '../../server/migrations');
  const files = fs.readdirSync(repo).filter(f => f.endsWith('.sql')).sort();
  const applied = new Set((await q('SELECT filename FROM schema_migrations')).rows.map(r => r.filename));
  for (const f of files) {
    assert.ok(applied.has(f), f);
    const sql = fs.readFileSync(path.join(repo, f), 'utf8');
    assert.doesNotMatch(sql, /\bCONCURRENTLY\b|^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im, `${f} : s'exécute déjà dans une transaction`);
  }
});
