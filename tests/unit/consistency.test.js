// Garde-fous sur le front et les données dupliquées (aucune base nécessaire).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const inlineScripts = () => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

test('les scripts en ligne de index.html sont du JavaScript valide', () => {
  // Une apostrophe non échappée dans un dictionnaire casse toute la page (déjà arrivé)
  inlineScripts().forEach((code, i) => {
    assert.doesNotThrow(() => new vm.Script(code), `script en ligne n°${i + 1} invalide`);
  });
});

test('contrats.js est du JavaScript valide', () => {
  const code = fs.readFileSync(path.join(ROOT, 'public', 'contrats.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(code));
});

test('les marqueurs SEO de index.html sont présents une seule fois', () => {
  for (const marker of ['<!--SEO_HEAD-->', '<!--SEO_NAV-->', '<!--SEO_LANDING-->']) {
    assert.equal(html.split(marker).length - 1, 1, `${marker} doit apparaître exactement une fois`);
  }
});

// Extrait le dictionnaire TRANSLATIONS de la page pour le comparer
function translations() {
  const start = html.indexOf('const TRANSLATIONS = {');
  const end = html.indexOf('function T(key)');
  const literal = html.slice(start, end).replace(/^const TRANSLATIONS = /, '').trim().replace(/;$/, '');
  return vm.runInNewContext('(' + literal + ')');
}

test('traductions : mêmes clés en français et en arabe, aucune valeur vide', () => {
  const T = translations();
  const fr = Object.keys(T.fr), ar = Object.keys(T.ar);
  assert.deepEqual(fr.filter(k => !(k in T.ar)), [], 'clés absentes de la version arabe');
  assert.deepEqual(ar.filter(k => !(k in T.fr)), [], 'clés absentes de la version française');
  for (const lang of ['fr', 'ar'])
    assert.deepEqual(fr.filter(k => !String(T[lang][k]).trim()), [], `valeurs vides (${lang})`);
});

test('toutes les clés data-i18n utilisées dans le HTML existent dans le dictionnaire', () => {
  const T = translations();
  const used = new Set([...html.matchAll(/data-i18n(?:-html|-title)?="([a-z0-9_]+)"/g)].map(m => m[1]));
  assert.deepEqual([...used].filter(k => !(k in T.fr)), []);
});

test('la liste des wilayas du serveur est identique à celle du front', () => {
  const server = require(path.join(ROOT, 'server', 'wilayas'));
  const literal = html.match(/const WILAYAS = \[([\s\S]*?)\];/)[1];
  // Array.from : un tableau créé dans un autre contexte vm n'a pas le même prototype (deepEqual strict)
  const front = Array.from(vm.runInNewContext('[' + literal + ']'));
  assert.equal(server.length, 69);
  assert.deepEqual(server, front);
});

test('les slugs de wilayas sont uniques et ne collisionnent pas avec les mots réservés', () => {
  const { slugify } = require(path.join(ROOT, 'server', 'seo'));
  const slugs = require(path.join(ROOT, 'server', 'wilayas')).map(slugify);
  assert.equal(new Set(slugs).size, slugs.length);
  const reserved = ['vente', 'location', 'location-saisonniere', 'appartements', 'villas', 'maisons',
    'bureaux', 'locaux-commerciaux', 'terrains', 'fermes', 'entrepots', 'annonce'];
  assert.deepEqual(slugs.filter(s => reserved.includes(s) || !s), []);
});

test('la fonction slugify du front produit les mêmes slugs que celle du serveur', () => {
  const src = html.match(/function slugify\(s\) \{[\s\S]*?\n\}/)[0];
  const front = vm.runInNewContext(src + '; slugify');
  const { slugify } = require(path.join(ROOT, 'server', 'seo'));
  for (const s of ['Appartement F4 vue mer à Alger', "M'Sila", 'Béjaïa', 'Local commercial 120m² Annaba', '', 'فيلا'])
    assert.equal(front(s), slugify(s), `divergence pour « ${s} »`);
});
