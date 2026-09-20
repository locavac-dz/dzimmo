// Démarre l'application sur un schéma PostgreSQL jetable, isolé des données de développement :
// chaque fichier de test crée son schéma (dzimmo_test_…), y exécute schema.sql + migrations + seed,
// puis le supprime à la fin. Aucun email n'est envoyé (EMAIL_* vidés).
// Base utilisée : TEST_DATABASE_URL, sinon DATABASE_URL du .env.
const path   = require('path');
const crypto = require('crypto');
const ROOT   = path.join(__dirname, '..', '..');

require('dotenv').config({ path: path.join(ROOT, '.env') });

async function startServer() {
  // Garde-fou : si server/db.js est déjà chargé, sa connexion vise la base de développement (le schéma jetable ci-dessous
  // n'aurait aucun effet) et les tests y écriraient leurs données. Charger les modules du serveur APRÈS startServer().
  if (require.cache[require.resolve(path.join(ROOT, 'server', 'db'))])
    throw new Error('server/db.js est chargé avant startServer() : les tests écriraient dans la base de développement. ' +
      "Requérir les modules du serveur (sessions, verification, moderation…) à l'intérieur de test.before, après startServer().");
  const baseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL (ou TEST_DATABASE_URL) requis pour les tests d\'API.');

  const { Pool } = require('pg');
  const schema = `dzimmo_test_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  const admin  = new Pool({ connectionString: baseUrl });
  await admin.query(`CREATE SCHEMA ${schema}`);

  // Toutes les tables du test vivent dans ce schéma (search_path de la connexion)
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  Object.assign(process.env, {
    DATABASE_URL: url.toString(), NODE_ENV: 'test', JWT_SECRET: 'secret-de-test', JWT_EXPIRES_IN: '1h',
    APP_URL: 'https://dzimmo.test', CORS_ORIGINS: 'https://dzimmo.test',
    EMAIL_HOST: '', EMAIL_USER: '', MODERATION: 'on',
  });

  const app = require(path.join(ROOT, 'server', 'app'));
  const db  = require(path.join(ROOT, 'server', 'db'));
  await db.connect();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Requête HTTP : renvoie { status, body (JSON ou texte), headers } ; les redirections ne sont pas suivies
  async function request(method, urlPath, { token, body, headers = {} } = {}) {
    const res = await fetch(base + urlPath, {
      method, redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}),
                 ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* corps non JSON */ }
    return { status: res.status, body: json ?? text, text, headers: res.headers };
  }

  let seq = 0;
  // Inscrit un utilisateur ordinaire ; renvoie { id, email, token }
  async function register(label = 'user') {
    const email = `${label}${++seq}-${crypto.randomBytes(2).toString('hex')}@test.dz`;
    const r = await request('POST', '/api/auth/register', { body: { name: `Test ${label}`, email, password: 'motdepasse1' } });
    if (r.status !== 201) throw new Error('inscription impossible : ' + JSON.stringify(r.body));
    return { id: r.body.user.id, email, token: r.body.token };
  }

  // Promeut un compte administrateur puis le reconnecte (le rôle est lu à la connexion)
  async function makeAdmin(user) {
    await db.pool.query('UPDATE users SET is_admin = true WHERE id = $1', [user.id]);
    const r = await request('POST', '/api/auth/login', { body: { email: user.email, password: 'motdepasse1' } });
    return { ...user, token: r.body.token };
  }

  async function stop() {
    await new Promise(r => server.close(r));
    await db.pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }

  return { base, db, request, register, makeAdmin, stop };
}

module.exports = { startServer, ROOT };
