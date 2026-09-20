// ── Compteurs partagés entre les workers (pm2 en mode cluster) ───────────────
// express-rate-limit compte par défaut dans la mémoire du processus : avec N workers, chaque limite était multipliée par N.
// Ici les compteurs vivent dans PostgreSQL (table rate_limits, migration 016), communs à tous les workers.
// Vie privée : la clé stockée est un HMAC de « préfixe|clé » (secret du serveur), jamais l'adresse IP ; la ligne disparaît
// après sa fenêtre (purge()). Une panne de la base ne bloque pas le site : les limiteurs sont créés avec passOnStoreError.
const crypto = require('crypto');
const db = require('./db');

const hashKey = (prefix, key) => prefix + ':' + crypto.createHmac('sha256', process.env.JWT_SECRET || 'dzimmo-dev')
  .update(`${prefix}|${key}`).digest('base64url').slice(0, 32);

// Compte un passage dans la fenêtre en cours (ou en ouvre une nouvelle si la précédente est finie) — une seule requête, atomique
async function hit(prefix, key, windowMs) {
  const r = await db.pool.query(
    `INSERT INTO rate_limits AS r (key, hits, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       hits     = CASE WHEN r.reset_at <= now() THEN 1 ELSE r.hits + 1 END,
       reset_at = CASE WHEN r.reset_at <= now() THEN now() + make_interval(secs => $2) ELSE r.reset_at END
     RETURNING hits, reset_at`, [hashKey(prefix, key), windowMs / 1000]);
  return { totalHits: r.rows[0].hits, resetTime: r.rows[0].reset_at };
}

// true une seule fois par fenêtre, tous workers confondus (dédoublonnage des clics)
const firstInWindow = async (prefix, key, windowMs) => (await hit(prefix, key, windowMs)).totalHits === 1;

// Magasin pour express-rate-limit : une instance par limiteur, avec un préfixe qui lui est propre
class PgStore {
  constructor(prefix) { this.prefix = prefix; this.localKeys = false; this.windowMs = 60000; }
  init(options) { this.windowMs = options.windowMs; }
  increment(key) { return hit(this.prefix, key, this.windowMs); }
  async decrement(key) {
    await db.pool.query('UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1 AND reset_at > now()', [hashKey(this.prefix, key)]);
  }
  async resetKey(key) { await db.pool.query('DELETE FROM rate_limits WHERE key = $1', [hashKey(this.prefix, key)]); }
}

// Fenêtres terminées (tâche horaire, instance 0)
const purge = async () => (await db.pool.query('DELETE FROM rate_limits WHERE reset_at <= now()')).rowCount;

module.exports = { PgStore, hit, firstInWindow, purge, hashKey };
