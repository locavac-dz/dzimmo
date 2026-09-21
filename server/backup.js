// ── Sauvegardes PostgreSQL automatiques, avec test de restauration ───────────
// Une sauvegarde qu'on n'a jamais restaurée est un pari. Ce module :
//   1. crée un vidage `pg_dump -Fc` (écrit sous un nom provisoire, renommé seulement s'il est complet) ;
//   2. garde les BACKUP_KEEP plus récents et supprime les autres (uniquement nos propres fichiers, reconnus à leur nom) ;
//   3. vérifie qu'un vidage se restaure : base jetable créée, `pg_restore`, contrôle des tables, base supprimée.
// Le mot de passe de la base passe par l'environnement du processus fils (PGPASSWORD), jamais sur la ligne de commande.
// Le vidage contient des données personnelles (comptes, messages) : dossier en 0700, hors Git et hors `public/`. Les photos
// (`public/uploads`) et les justificatifs de vérification ne sont PAS dans la base : voir DEPLOIEMENT.md § 7.
// Rien n'est gardé en mémoire : chaque worker voit les mêmes fichiers, et seule l'instance 0 planifie (server/cron.js).
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const NAME = /^dzimmo-\d{4}-\d{2}-\d{2}-\d{4}\.dump$/;   // nos fichiers : seuls ceux-là sont comptés et purgés
const MIN_BYTES = 200;                                     // un vidage plus petit est forcément vide ou tronqué
const STALE_HOURS = 36;

// Actives par défaut en production, à la demande ailleurs (BACKUP_ENABLED=true) ; « false » les coupe partout
function enabled(env = process.env) {
  const v = String(env.BACKUP_ENABLED ?? '').trim().toLowerCase();
  return v === 'true' || (v !== 'false' && env.NODE_ENV === 'production');
}

const dir = (env = process.env) => path.resolve(ROOT, (env.BACKUP_DIR || '').trim() || 'backups');
const keep = (env = process.env) => (/^\d{1,3}$/.test(String(env.BACKUP_KEEP ?? '').trim()) && Number(env.BACKUP_KEEP) > 0
  ? Number(env.BACKUP_KEEP) : 14);

// Outils PostgreSQL : PG_BIN_DIR (dossier `bin`) sinon le PATH
const tool = (name, env = process.env) => (env.PG_BIN_DIR ? path.join(env.PG_BIN_DIR.trim(), name) : name);

// DATABASE_URL → variables PG* + schéma éventuel (`options=-c search_path=…`, utilisé par les tests)
function connection(env = process.env) {
  const url = new URL(env.DATABASE_URL);
  const opts = url.searchParams.get('options') || '';
  const schema = (opts.match(/search_path=([a-z0-9_]+)/i) || [])[1] || null;
  return {
    schema,
    env: {
      PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      ...(env.DATABASE_SSL === 'true' ? { PGSSLMODE: 'require' } : {}),
    },
  };
}

// Lance un outil PostgreSQL ; rejette avec un message exploitable (sortie d'erreur tronquée, sans mot de passe)
function run(cmd, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...extraEnv }, windowsHide: true });
    let err = '', out = '';
    p.stderr.on('data', d => { if (err.length < 2000) err += d; });
    p.stdout.on('data', d => { if (out.length < 5e6) out += d; });
    p.on('error', e => reject(new Error(e.code === 'ENOENT'
      ? `${path.basename(cmd)} introuvable (installer postgresql-client, ou renseigner PG_BIN_DIR)` : e.message)));
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} a échoué (code ${code}) : ${err.trim().slice(0, 300)}`)));
  });
}

const stamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

// Sauvegardes présentes, la plus récente d'abord : [{ file, path, size, mtime }]
function list(env = process.env) {
  const d = dir(env);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => NAME.test(f)).map(f => {
    const st = fs.statSync(path.join(d, f));
    return { file: f, path: path.join(d, f), size: st.size, mtime: st.mtime };
  }).sort((a, b) => b.file.localeCompare(a.file));
}

// Ne garde que les `n` plus récentes ; renvoie les noms supprimés
function prune(env = process.env) {
  const old = list(env).slice(keep(env));
  for (const b of old) fs.rmSync(b.path, { force: true });
  return old.map(b => b.file);
}

// Crée une sauvegarde ; renvoie { file, path, size, pruned }
async function backup(env = process.env, now = new Date()) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL absent');
  const d = dir(env);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const file = `dzimmo-${stamp(now)}.dump`;
  const final = path.join(d, file), partial = final + '.partial';
  const c = connection(env);
  try {
    await run(tool('pg_dump', env), [
      '-Fc', '--no-unlogged-table-data', '--no-owner', '--exclude-table-data=rate_limits',
      ...(c.schema ? ['--schema=' + c.schema] : []), '-f', partial], c.env);
    const size = fs.statSync(partial).size;
    if (size < MIN_BYTES) throw new Error(`vidage vide ou tronqué (${size} octets)`);
    fs.renameSync(partial, final);
    return { file, path: final, size, pruned: prune(env) };
  } catch (e) {
    fs.rmSync(partial, { force: true });
    throw e;
  }
}

const countTables = `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`;

// Vérifie qu'un vidage est utilisable. Renvoie { file, mode, tables, users? }.
//  • mode « restauration » : base jetable créée, pg_restore, mêmes tables que la base source, base supprimée (toujours, même en échec).
//    Demande le droit CREATEDB : celui du compte de l'application, ou celui du compte BACKUP_VERIFY_URL (adresse d'un compte dédié).
//  • mode « catalogue » : sans ce droit, l'archive est relue en entier (`pg_restore -f` vers le vide) et son catalogue comparé aux tables.
async function verify(file, env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL absent');
  if (!file || !fs.existsSync(file)) throw new Error('aucune sauvegarde à vérifier');
  const c = connection(env);
  const schema = c.schema || 'public';
  const ssl = env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;
  const tmp = `dzimmo_verif_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const adminUrl = (env.BACKUP_VERIFY_URL || '').trim() || env.DATABASE_URL;
  const admin = connection({ ...env, DATABASE_URL: adminUrl });
  const source = new Client({ connectionString: env.DATABASE_URL, ssl });
  const base = new Client({ connectionString: adminUrl, ssl });
  let restored = null, created = false;
  await source.connect();
  try {
    const expected = (await source.query(countTables, [schema])).rows[0].n;
    await base.connect();
    try {
      await base.query(`CREATE DATABASE ${tmp}`);
      created = true;
    } catch (e) {
      if (e.code !== '42501') throw e;     // droit CREATEDB absent : repli sur le contrôle du catalogue
      return await catalogue(file, env, c, schema, expected);
    }
    await run(tool('pg_restore', env), ['--no-owner', '-d', tmp, file], admin.env);
    const url = new URL(adminUrl);
    url.pathname = '/' + tmp;
    url.searchParams.delete('options');
    restored = new Client({ connectionString: url.toString(), ssl });
    await restored.connect();
    const tables = (await restored.query(countTables, [schema])).rows[0].n;
    if (tables === 0) throw new Error('la restauration ne contient aucune table');
    if (tables !== expected) throw new Error(`la restauration compte ${tables} tables, la base en compte ${expected}`);
    const users = (await restored.query(`SELECT count(*)::int AS n FROM "${schema}".users`)).rows[0].n;
    return { file: path.basename(file), mode: 'restauration', tables, users };
  } finally {
    if (restored) await restored.end().catch(() => {});
    if (created) await base.query(`DROP DATABASE IF EXISTS ${tmp}`).catch(() => {});
    await base.end().catch(() => {});
    await source.end().catch(() => {});
  }
}

// Contrôle sans restauration : l'archive se relit en entier (une copie tronquée ou abîmée échoue ici), son catalogue liste autant
// de tables que la base, dont celle des comptes
async function catalogue(file, env, c, schema, expected) {
  await run(tool('pg_restore', env), ['--no-owner', '-f', os.devNull, file], c.env);
  const out = await run(tool('pg_restore', env), ['--list', file], c.env);
  const tables = [...out.matchAll(/^\d+; \d+ \d+ TABLE (\S+) (\S+) /gm)].filter(m => m[1] === schema).map(m => m[2]);
  if (!tables.includes('users')) throw new Error('la table des comptes est absente de la sauvegarde');
  if (tables.length !== expected) throw new Error(`la sauvegarde liste ${tables.length} tables, la base en compte ${expected}`);
  return { file: path.basename(file), mode: 'catalogue', tables: tables.length };
}

// Plus ancienne que STALE_HOURS (ou absente) : le cron n'a pas tourné, ou échoue en silence. Renvoie un message ou null.
function staleProblem(env = process.env, now = Date.now()) {
  const last = list(env)[0];
  if (!last) return 'aucune sauvegarde trouvée dans ' + path.basename(dir(env));
  const hours = (now - last.mtime.getTime()) / 3600000;
  return hours > STALE_HOURS ? `dernière sauvegarde il y a ${Math.floor(hours)} h (${last.file})` : null;
}

module.exports = { enabled, backup, verify, list, prune, staleProblem, connection, dir, keep, stamp, NAME, STALE_HOURS };
