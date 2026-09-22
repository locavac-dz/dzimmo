// Tests d'intégration front : score de complétude dans le formulaire et le tableau de bord.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');

const app = read('app.js');
const html = read('index.html');

test('pub_score_label : traductions FR et AR', () => {
  assert.ok(app.includes("pub_score_label:'Complétude de l\\'annonce'"), 'pub_score_label FR absent');
  assert.ok(app.includes("pub_score_label:'اكتمال الإعلان'"),            'pub_score_label AR absent');
});

test('index.html : jauge pub-score-bar et pub-score-pct présents', () => {
  assert.ok(html.includes('id="pub-score-bar"'), 'pub-score-bar absent de index.html');
  assert.ok(html.includes('id="pub-score-pct"'), 'pub-score-pct absent de index.html');
  assert.ok(html.includes('pub_score_label'),    'data-i18n pub_score_label absent');
});

test('completenessScore : fonction globale définie', () => {
  assert.ok(app.includes('function completenessScore('), 'completenessScore non définie');
});

test('formScoreData : lit les champs du formulaire', () => {
  assert.ok(app.includes('function formScoreData()'), 'formScoreData non définie');
  assert.ok(app.includes("val('pub-title')"),     'pub-title absent de formScoreData');
  assert.ok(app.includes("val('pub-desc')"),      'pub-desc absent de formScoreData');
  assert.ok(app.includes('uploadedPhotos.length'),'photos_count absent de formScoreData');
  assert.ok(app.includes("val('pub-video')"),     'pub-video absent de formScoreData');
  assert.ok(app.includes("val('pub-tour')"),      'pub-tour absent de formScoreData');
});

test('updatePublishScore : met à jour bar et pct', () => {
  assert.ok(app.includes('function updatePublishScore()'), 'updatePublishScore non définie');
  assert.ok(app.includes("'pub-score-bar'"), 'pub-score-bar absent de updatePublishScore');
  assert.ok(app.includes("'pub-score-pct'"), 'pub-score-pct absent de updatePublishScore');
});

test('initPublishScore : branchée dans init()', () => {
  assert.ok(app.includes('initPublishScore()'), 'initPublishScore() non appelée dans init');
});

test('renderPhotoPreviews appelle updatePublishScore', () => {
  const fn = app.slice(app.indexOf('function renderPhotoPreviews'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.ok(body.includes('updatePublishScore()'), 'updatePublishScore non appelé dans renderPhotoPreviews');
});

test('tableau de bord : barre de score par carte', () => {
  assert.ok(app.includes('completenessScore(p)'),         'completenessScore(p) absent du tableau de bord');
  assert.ok(app.includes("width:${score}%;"),             'largeur de la barre de score absente');
  assert.ok(app.includes('scoreColor'),                   'scoreColor absent');
});
