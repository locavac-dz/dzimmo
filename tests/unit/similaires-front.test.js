// Badge « Nouveau », annonces similaires et partage social côté front.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');

const app = read('app.js');
const css = read('app.css');

function hasTrans(lang, key) {
  // Cherche la clé dans le bon bloc de traductions
  const marker = lang === 'fr' ? '\n  fr: {' : '\n  ar: {';
  const a = app.indexOf(marker);
  if (a < 0) return false;
  const end = lang === 'fr' ? app.indexOf('\n  ar: {') : app.indexOf('\n};', a);
  return new RegExp(`\\b${key}:`).test(app.slice(a, end));
}

test('new_badge : traductions FR et AR', () => {
  assert.ok(hasTrans('fr', 'new_badge'), 'clé new_badge absente du bloc FR');
  assert.ok(hasTrans('ar', 'new_badge'), 'clé new_badge absente du bloc AR');
});

test('cardHTML : affiche .new-badge pour les annonces récentes', () => {
  assert.ok(app.includes('new-badge'), '.new-badge absent de cardHTML');
  assert.ok(app.includes("T('new_badge')"), "T('new_badge') absent de cardHTML");
  assert.ok(app.includes('isNew'), 'isNew absent de cardHTML');
});

test('CSS .new-badge défini', () => {
  assert.ok(css.includes('.new-badge'), '.new-badge absent du CSS');
});

test('loadSimilarProperties utilise /properties/:id/similar', () => {
  assert.ok(app.includes('/properties/\' + id + \'/similar'), 'endpoint /similar absent de loadSimilarProperties');
});

test('shareProperty : pas de données utilisateur directement dans onclick', () => {
  // Les boutons FB et X passent les données via data-* et reçoivent this
  assert.ok(app.includes("shareProperty('facebook',this)"), 'bouton Facebook absent');
  assert.ok(app.includes("shareProperty('x',this)"),       'bouton X absent');
  assert.ok(app.includes('data-id='), 'data-id absent des boutons de partage');
  assert.ok(app.includes('data-title='), 'data-title absent des boutons de partage');
});

test('shareProperty : fonction globale définie', () => {
  assert.ok(app.includes('function shareProperty('), 'shareProperty non défini');
  assert.ok(app.includes("network === 'facebook'"), 'cas facebook absent');
  assert.ok(app.includes("network === 'x'"),        'cas x absent');
});
