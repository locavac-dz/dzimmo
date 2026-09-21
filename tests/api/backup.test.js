// Sauvegarde réelle (pg_dump) et test de restauration (pg_restore) sur le schéma jetable du test.
// Ignoré si les outils PostgreSQL sont introuvables (PATH, PG_BIN_DIR ou installation Windows par défaut) : la CI les installe.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { spawnSync } = require('node:child_process');
const { startServer } = require('../helpers/server');

function pgBin() {
  if (process.env.PG_BIN_DIR) return process.env.PG_BIN_DIR;
  if (spawnSync('pg_dump', ['--version']).status === 0) return '';
  const win = 'C:/Program Files/PostgreSQL/17/bin';
  return fs.existsSync(win) ? win : null;
}
const bin = pgBin();
const skip = bin === null ? 'pg_dump / pg_restore introuvables (PATH ou PG_BIN_DIR)' : false;

let s, backup, dir;
const q = (sql, params) => s.db.pool.query(sql, params);

test.before(async () => {
  if (skip) return;
  s = await startServer();
  if (bin) process.env.PG_BIN_DIR = bin;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dzimmo-bk-'));
  process.env.BACKUP_DIR = dir;
  backup = require('../../server/backup');
  await s.register('membre');
});
test.after(async () => {
  if (skip) return;
  fs.rmSync(dir, { recursive: true, force: true });
  await s.stop();
});

const verifDatabases = async () => (await q(`SELECT datname FROM pg_database WHERE datname LIKE 'dzimmo\\_verif\\_%'`)).rows.length;

test('sauvegarde : fichier complet, nommé et rangé dans BACKUP_DIR, sans reste provisoire', { skip }, async () => {
  const r = await backup.backup();
  assert.match(r.file, backup.NAME);
  assert.equal(path.dirname(r.path), dir);
  assert.ok(r.size > 1000, 'vidage non vide');
  assert.deepEqual(fs.readdirSync(dir), [r.file], 'aucun .partial');
  assert.deepEqual(r.pruned, []);
  if (process.platform !== 'win32') assert.equal(fs.statSync(dir).mode & 0o077, 0, 'dossier inaccessible aux autres comptes');
});

test('contenu : comptes et annonces sauvegardés, compteurs de débit (jetables) exclus', { skip }, () => {
  const out = spawnSync(path.join(bin || '', 'pg_restore'), ['--list', backup.list()[0].path], { encoding: 'utf8' }).stdout;
  const data = [...out.matchAll(/TABLE DATA \S+ (\S+)/g)].map(m => m[1]);
  assert.ok(data.includes('users'));
  assert.ok(data.includes('properties'));
  assert.ok(!data.includes('rate_limits'), 'rate_limits n\'est pas sauvegardée');
});

test('test de restauration : la sauvegarde se restaure (ou, sans droit CREATEDB, se relit en entier) et rien ne traîne', { skip }, async () => {
  const before = await verifDatabases();
  const v = await backup.verify(backup.list()[0].path);
  assert.ok(['restauration', 'catalogue'].includes(v.mode), v.mode);
  assert.ok(v.tables >= 20, `${v.tables} tables`);
  if (v.mode === 'restauration') assert.ok(v.users >= 1, 'les comptes sont revenus');
  assert.equal(await verifDatabases(), before, 'base jetable supprimée');
});

test('test de restauration : un fichier corrompu ou tronqué est refusé', { skip }, async () => {
  const good = backup.list()[0].path;
  const junk = path.join(dir, 'illisible.dump');
  fs.writeFileSync(junk, 'ceci n\'est pas une sauvegarde PostgreSQL '.repeat(20));
  const before = await verifDatabases();
  await assert.rejects(backup.verify(junk), /pg_restore a échoué/);
  const cut = path.join(dir, 'tronque.dump');
  fs.writeFileSync(cut, fs.readFileSync(good).subarray(0, Math.floor(fs.statSync(good).size / 2)));
  await assert.rejects(backup.verify(cut));
  await assert.rejects(backup.verify(path.join(dir, 'absent.dump')), /aucune sauvegarde à vérifier/);
  await assert.rejects(backup.verify(undefined), /aucune sauvegarde à vérifier/);
  assert.equal(await verifDatabases(), before, 'aucune base jetable oubliée après un échec');
});

test('échec du vidage : erreur claire, aucun fichier (même provisoire) laissé, les sauvegardes existantes restent', { skip }, async () => {
  const before = backup.list().map(b => b.file);
  const bad = process.env.DATABASE_URL.replace(/\/[^/?]+\?/, '/base_qui_nexiste_pas?');
  assert.notEqual(bad, process.env.DATABASE_URL);
  await assert.rejects(backup.backup({ ...process.env, DATABASE_URL: bad }, new Date(2030, 0, 1, 2, 30)), /pg_dump a échoué/);
  assert.deepEqual(backup.list().map(b => b.file), before);
  assert.ok(!fs.readdirSync(dir).some(f => f.endsWith('.partial')));
  await assert.rejects(backup.backup({ ...process.env, PG_BIN_DIR: path.join(dir, 'pas-de-postgres') }, new Date(2030, 0, 2, 2, 30)),
    /introuvable/);
});

test('rotation à la sauvegarde : les plus anciennes disparaissent, la nouvelle reste', { skip }, async () => {
  for (let d = 1; d <= 4; d++) fs.writeFileSync(path.join(dir, `dzimmo-2020-01-0${d}-0230.dump`), 'x'.repeat(300));
  const r = await backup.backup({ ...process.env, BACKUP_KEEP: '2' }, new Date(2031, 0, 1, 2, 30));
  assert.ok(r.pruned.length >= 4);
  const left = backup.list({ ...process.env, BACKUP_KEEP: '2' }).map(b => b.file);
  assert.equal(left.length, 2);
  assert.equal(left[0], 'dzimmo-2031-01-01-0230.dump');
});
