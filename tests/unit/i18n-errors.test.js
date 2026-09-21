// Chaque message d'erreur écrit dans le serveur doit avoir sa traduction arabe (server/i18n.js).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const SERVER = path.join(__dirname, '..', '..', 'server');
const { AR, translate, langOf } = require(path.join(SERVER, 'i18n'));

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? jsFiles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}

const INTERNES = new Set(['backup.js', 'backup-cli.js', 'cron.js', 'monitor.js']);

// Messages littéraux : « error: '…' » (réponses JSON) et « new Error('…') » (erreurs remontées au gestionnaire global)
function serverMessages() {
  const found = new Map();   // message -> fichier
  // « bad('…') » : messages renvoyés par les validateurs des vitrines et des programmes (server/agency.js, server/projects.js)
  const patterns = [/error:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g, /new Error\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g,
                    /\bbad\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g];
  for (const file of jsFiles(SERVER)) {
    if (path.basename(file) === 'i18n.js') continue;
    if (INTERNES.has(path.basename(file))) continue;                     // sauvegardes et tâches planifiées : journal et emails d'alerte, jamais une réponse HTTP
    const src = fs.readFileSync(file, 'utf8');
    for (const re of patterns) for (const m of src.matchAll(re)) {
      const msg = m[2].replace(/\\(['"`\\])/g, '$1');
      if (msg.includes('${')) continue;                                   // gabarit dynamique
      if (/^(CORS:|\[migrate\]|\[google\]|\[totp\])/.test(msg)) continue;                     // erreurs internes, jamais montrées au visiteur
      found.set(msg, path.relative(SERVER, file));
    }
  }
  return found;
}

test('tous les messages d\'erreur du serveur ont une traduction arabe', () => {
  const found = serverMessages();
  assert.ok(found.size > 50, `extraction : ${found.size} messages trouvés`);
  const missing = [...found].filter(([msg]) => !AR[msg]).map(([msg, file]) => `${file} : ${msg}`);
  assert.deepEqual(missing, [], 'messages sans traduction (à ajouter dans server/i18n.js)');
});

test('aucune réponse d\'erreur n\'est un gabarit dynamique (intraduisible) ; la limite du CSV suit MAX_LIGNES', () => {
  const dynamic = jsFiles(SERVER).flatMap(file =>
    [...fs.readFileSync(file, 'utf8').matchAll(/\.json\(\s*\{\s*error:\s*`[^`]*\$\{/g)].map(() => path.relative(SERVER, file)));
  assert.deepEqual(dynamic, [], 'écrire le message en toutes lettres et l\'ajouter à server/i18n.js');
  const src = fs.readFileSync(path.join(SERVER, 'routes', 'import.js'), 'utf8');
  const max = src.match(/const MAX_LIGNES\s*=\s*(\d+)/)[1];
  assert.ok(src.includes(`'CSV trop long (${max} lignes maximum).'`), 'le message doit citer MAX_LIGNES');
  assert.ok(AR[`CSV trop long (${max} lignes maximum).`].includes(max));
});

test('messages techniques et d\'envoi de fichiers : traduits aussi', () => {
  for (const msg of ['Requête invalide (JSON mal formé).', 'Requête trop volumineuse.', 'Erreur interne du serveur.',
    'Fichier trop volumineux (10 Mo maximum).', 'Trop de fichiers (10 maximum).', 'Fichier inattendu.'])
    assert.ok(AR[msg], msg);
});

test('les traductions sont en écriture arabe et sans entrée vide', () => {
  for (const [fr, ar] of Object.entries(AR)) {
    assert.ok(ar.trim(), `traduction vide : ${fr}`);
    assert.match(ar, /[؀-ۿ]/, `pas d'arabe dans la traduction de : ${fr}`);
  }
});

test('translate : message inconnu renvoyé tel quel', () => {
  assert.equal(translate('Message inventé'), 'Message inventé');
  assert.equal(translate('Annonce introuvable.'), AR['Annonce introuvable.']);
});

test('langOf : X-Lang prioritaire, sinon Accept-Language, français par défaut', () => {
  const req = headers => ({ headers });
  assert.equal(langOf(req({})), 'fr');
  assert.equal(langOf(req({ 'x-lang': 'ar' })), 'ar');
  assert.equal(langOf(req({ 'x-lang': 'AR' })), 'ar');
  assert.equal(langOf(req({ 'accept-language': 'ar-DZ,ar;q=0.9,fr;q=0.8' })), 'ar');
  assert.equal(langOf(req({ 'accept-language': 'fr-FR,fr;q=0.9' })), 'fr');
  assert.equal(langOf(req({ 'x-lang': 'fr', 'accept-language': 'ar' })), 'fr', 'le choix explicite du site l\'emporte');
  assert.equal(langOf(req({ 'x-lang': 'de' })), 'fr', 'langue inconnue : français');
});
