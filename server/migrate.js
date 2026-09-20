const fs   = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LOCK_KEY = 7318843;   // verrou consultatif du démarrage (schéma + migrations), distinct de celui de server/search.js

// Exécute `fn(client)` sur UNE connexion, sous un verrou consultatif propre au schéma courant.
// pm2 cluster démarre plusieurs workers en même temps : sans verrou, deux d'entre eux appliquaient la même migration (ou le même
// CREATE TABLE IF NOT EXISTS) en parallèle. Le verrou est par schéma pour ne pas mettre en file les tests (un schéma jetable par fichier).
async function withStartupLock(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, hashtext(current_schema()))', [LOCK_KEY]);
    try { return await fn(client); }
    finally { await client.query('SELECT pg_advisory_unlock($1, hashtext(current_schema()))', [LOCK_KEY]).catch(() => {}); }
  } finally {
    client.release();
  }
}

// Applique les migrations en attente. `client` est une connexion unique (pas le pool) : BEGIN / COMMIT envoyés au pool partaient chacun
// sur une connexion quelconque, si bien qu'une migration échouée à mi-chemin restait à moitié appliquée (aucune transaction réelle).
async function migrate(client, dir = MIGRATIONS_DIR, log = console) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  if (!files.length) return;

  // Lu sous le verrou : un worker qui a attendu voit ce que le précédent vient d'appliquer
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  const applied   = new Set(rows.map(r => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log.log(`[migrate] ✅ ${file}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`[migrate] ❌ ${file} — ${err.message}`);
    }
  }
}

module.exports = migrate;
module.exports.withStartupLock = withStartupLock;
