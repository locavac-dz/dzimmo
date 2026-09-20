// Isolation des tests d'API : ils ne doivent jamais écrire dans la base de développement.
// Cause d'un incident réel : un fichier de test chargeait server/sessions.js (donc server/db.js et sa connexion) AVANT startServer(),
// qui redirige la base vers un schéma jetable ; la connexion visait alors le schéma public et chaque exécution laissait comptes et annonces.
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const run = code => spawnSync(process.execPath, ['-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });

test('startServer() refuse de démarrer si server/db.js est déjà chargé (les tests écriraient dans la base de développement)', () => {
  const r = run(`
    require('./server/db');                       // chargé trop tôt : sa connexion vise la base de développement
    require('./tests/helpers/server').startServer()
      .then(() => { console.log('DEMARRE'); process.exit(0); })
      .catch(e => { console.error(e.message); process.exit(3); });`);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /server\/db\.js est chargé avant startServer\(\)/);
  assert.match(r.stderr, /base de développement/);
  assert.doesNotMatch(r.stdout, /DEMARRE/, 'aucun schéma ni serveur créé');
});

test('même refus si un module du serveur qui charge la base est requis en premier (sessions, vérification, modération)', () => {
  for (const mod of ['sessions', 'verification', 'moderation', 'app']) {
    const r = run(`
      require('./server/${mod}');
      require('./tests/helpers/server').startServer().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(3); });`);
    assert.equal(r.status, 3, `${mod} : ${r.stdout}${r.stderr}`.slice(0, 300));
    assert.match(r.stderr, /chargé avant startServer\(\)/, mod);
  }
});
