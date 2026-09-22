// Tests unitaires du filtre équipements côté front.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');

const app  = read('app.js');
const html = read('index.html');

test('filter_features : traductions FR et AR', () => {
  assert.ok(app.includes("filter_features:'Équipements :'"),  'filter_features FR absent');
  assert.ok(app.includes("filter_features:'التجهيزات :'"),    'filter_features AR absent');
});

test('index.html : section f-features-row avec les 8 boutons', () => {
  assert.ok(html.includes('id="f-features-row"'),   'f-features-row absent');
  const features = ['meuble', 'parking', 'balcon', 'ascenseur', 'piscine', 'jardin', 'wifi', 'climatisation'];
  features.forEach(f => assert.ok(html.includes(`data-v="${f}"`), `data-v="${f}" absent`));
});

test('toggleFeatFilter : définie dans app.js, appelée avec this dans index.html (pas de données en dur dans onclick)', () => {
  assert.ok(app.includes('function toggleFeatFilter(btn)'),   'toggleFeatFilter non définie dans app.js');
  assert.ok(html.includes('toggleFeatFilter(this)'),          'appel avec this absent de index.html');
  assert.ok(!html.match(/toggleFeatFilter\(['"][^'"]+['"]\)/), 'données en dur dans onclick !');
});

test('getActiveFeats : définie et utilisée dans loadAnnonces', () => {
  assert.ok(app.includes('function getActiveFeats()'),       'getActiveFeats non définie');
  assert.ok(app.includes("params.set('features', activeFeats.join(','))"),  'features absent des params API');
  assert.ok(app.includes("urlParams.set('f-features', activeFeats.join(','))"), 'f-features absent de l\'URL');
});

test('clearFeatFilters : définie', () => {
  assert.ok(app.includes('function clearFeatFilters()'), 'clearFeatFilters non définie');
});

test('restauration depuis URL : f-features relus dans init()', () => {
  assert.ok(app.includes("params.get('f-features')"),    'f-features non relu depuis URL');
  assert.ok(app.includes("feats.includes(b.dataset.v)"), 'restauration des boutons absente');
});

test('landingOnly : faux quand des équipements sont sélectionnés', () => {
  const block = app.slice(app.indexOf('const landingOnly'));
  const line  = block.slice(0, block.indexOf(';'));
  assert.ok(line.includes('activeFeats.length'), 'activeFeats.length absent de landingOnly');
});

test('rebuildSelects : remplit les labels des boutons f-feat-btn', () => {
  assert.ok(app.includes("T('feat_' + b.dataset.v)"), 'traduction des labels f-feat-btn absente');
});
