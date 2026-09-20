// Page complète du site pour les tests du front : index.html dont le CSS et le JS (public/app.css, public/app.js) sont remis en ligne.
// Les tests extraient du code et des textes de « la page » par expressions régulières ; depuis que le CSS et le JS vivent dans des
// fichiers mis en cache par le navigateur, ce helper recompose l'ancien document monolithique pour qu'ils continuent de le lire tel quel.
const fs   = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const read = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

function readFront() {
  let html = read('index.html');
  const css = read('app.css'), js = read('app.js');
  const before = html;
  html = html.replace(/<link rel="stylesheet" href="\/app\.css[^"]*">\n/, () => `<style>\n${css}</style>\n`)
             .replace(/<link rel="preload" href="\/app\.js[^"]*" as="script">\n/, () => '')
             .replace(/<script src="\/app\.js[^"]*"><\/script>\n/, () => `<script>\n${js}</script>\n`);
  if (html === before) throw new Error('index.html ne référence ni app.css ni app.js : helper à mettre à jour');
  return html;
}

module.exports = { readFront, read };
