// Sauvegardes (server/backup.js), parties qui ne demandent ni base ni pg_dump : activation, réglages, lecture de DATABASE_URL,
// rotation (seuls nos fichiers sont comptés et supprimés), détection d'une sauvegarde absente ou trop ancienne.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const backup = require('../../server/backup');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dzimmo-bk-'));
const fake = (dir, name, mtime) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, 'x'.repeat(300));
  if (mtime) fs.utimesSync(f, mtime, mtime);
  return f;
};

test('activation : oui en production, à la demande ailleurs, « false » coupe partout', () => {
  assert.equal(backup.enabled({ NODE_ENV: 'production' }), true);
  assert.equal(backup.enabled({ NODE_ENV: 'production', BACKUP_ENABLED: 'false' }), false);
  assert.equal(backup.enabled({ NODE_ENV: 'production', BACKUP_ENABLED: ' FALSE ' }), false);
  assert.equal(backup.enabled({ NODE_ENV: 'development' }), false);
  assert.equal(backup.enabled({}), false);
  assert.equal(backup.enabled({ NODE_ENV: 'development', BACKUP_ENABLED: 'true' }), true);
});

test('réglages : nombre à conserver (14 par défaut, valeur invalide ignorée), dossier par défaut hors public/', () => {
  assert.equal(backup.keep({}), 14);
  assert.equal(backup.keep({ BACKUP_KEEP: '30' }), 30);
  for (const bad of ['0', '-3', 'abc', '1e3', '1000', '2.5', '']) assert.equal(backup.keep({ BACKUP_KEEP: bad }), 14, bad);
  assert.equal(backup.dir({}), path.join(__dirname, '..', '..', 'backups'));
  assert.equal(backup.dir({ BACKUP_DIR: '/srv/backups/dzimmo' }), path.resolve('/srv/backups/dzimmo'));
});

test('DATABASE_URL : variables PG* (mot de passe décodé, jamais en argument) et schéma de test', () => {
  const c = backup.connection({ DATABASE_URL: 'postgresql://dz:p%40ss%2Fword@db.local:5433/dzimmo' });
  assert.deepEqual(c.env, { PGHOST: 'db.local', PGPORT: '5433', PGUSER: 'dz', PGPASSWORD: 'p@ss/word', PGDATABASE: 'dzimmo' });
  assert.equal(c.schema, null);
  const t = backup.connection({ DATABASE_URL: 'postgresql://u:p@h/db?options=-c%20search_path%3Ddzimmo_test_12_ab', DATABASE_SSL: 'true' });
  assert.equal(t.schema, 'dzimmo_test_12_ab');
  assert.equal(t.env.PGPORT, '5432');
  assert.equal(t.env.PGSSLMODE, 'require');
});

test('rotation : on garde les plus récentes, on ne touche qu\'aux fichiers reconnus à leur nom', () => {
  const dir = tmp();
  try {
    for (let d = 1; d <= 20; d++) fake(dir, `dzimmo-2026-08-${String(d).padStart(2, '0')}-0230.dump`);
    fake(dir, 'notes-perso.txt'); fake(dir, 'dzimmo-2026-08-21-0230.dump.partial'); fake(dir, 'autre.dump');
    const env = { BACKUP_DIR: dir, BACKUP_KEEP: '5' };
    assert.equal(backup.list(env).length, 20);
    assert.equal(backup.list(env)[0].file, 'dzimmo-2026-08-20-0230.dump', 'la plus récente d\'abord');
    const pruned = backup.prune(env);
    assert.equal(pruned.length, 15);
    assert.deepEqual(backup.list(env).map(b => b.file).slice(-1), ['dzimmo-2026-08-16-0230.dump']);
    assert.deepEqual(fs.readdirSync(dir).filter(f => !backup.NAME.test(f)).sort(),
      ['autre.dump', 'dzimmo-2026-08-21-0230.dump.partial', 'notes-perso.txt'], 'les autres fichiers sont intacts');
    assert.deepEqual(backup.prune(env), [], 'idempotent');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sauvegarde absente ou trop ancienne → problème signalé, récente → rien', () => {
  const dir = tmp();
  try {
    const env = { BACKUP_DIR: dir };
    assert.match(backup.staleProblem(env), /aucune sauvegarde/);
    assert.match(backup.staleProblem({ BACKUP_DIR: path.join(dir, 'inexistant') }), /aucune sauvegarde/);
    const now = Date.now();
    fake(dir, 'dzimmo-2026-08-01-0230.dump', new Date(now - 50 * 3600000));
    assert.match(backup.staleProblem(env, now), /dernière sauvegarde il y a 50 h/);
    fake(dir, 'dzimmo-2026-08-03-0230.dump', new Date(now - 6 * 3600000));
    assert.equal(backup.staleProblem(env, now), null);
    assert.equal(backup.STALE_HOURS, 36);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('nom de fichier : horodatage local à la minute, reconnu par le motif de rotation', () => {
  const s = backup.stamp(new Date(2026, 8, 5, 2, 30));
  assert.equal(s, '2026-09-05-0230');
  assert.match(`dzimmo-${s}.dump`, backup.NAME);
  assert.doesNotMatch('dzimmo-2026-09-05-0230.dump.partial', backup.NAME);
  assert.doesNotMatch('../dzimmo-2026-09-05-0230.dump', backup.NAME);
});
