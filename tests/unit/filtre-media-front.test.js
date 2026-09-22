// Tests unitaires — filtre "avec média" côté front.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');

const app  = read('app.js');
const html = read('index.html');

test('filter_has_video / filter_has_tour : traductions FR et AR', () => {
  assert.ok(app.includes("filter_has_video:'Vidéo'"),              'filter_has_video FR absent');
  assert.ok(app.includes("filter_has_tour:'Visite virtuelle'"),    'filter_has_tour FR absent');
  assert.ok(app.includes("filter_has_video:'فيديو'"),              'filter_has_video AR absent');
  assert.ok(app.includes("filter_has_tour:'جولة افتراضية'"),      'filter_has_tour AR absent');
});

test('toggleMediaFilter : définie dans app.js, appelée avec this dans index.html', () => {
  assert.ok(app.includes('function toggleMediaFilter(btn)'),  'toggleMediaFilter non définie');
  assert.ok(html.includes('toggleMediaFilter(this)'),         'appel avec this absent de index.html');
  assert.ok(!html.match(/toggleMediaFilter\(['"][^'"]+['"]\)/), 'données en dur dans onclick !');
});

test('getMediaFilters : définie et utilisée dans loadAnnonces', () => {
  assert.ok(app.includes('function getMediaFilters()'),             'getMediaFilters non définie');
  assert.ok(app.includes("params.set('has_video', '1')"),           "params.set has_video absent");
  assert.ok(app.includes("params.set('has_tour',  '1')"),           "params.set has_tour absent");
});

test('clearMediaFilters : définie', () => {
  assert.ok(app.includes('function clearMediaFilters()'), 'clearMediaFilters non définie');
});

test('URL persistence : f-has-video / f-has-tour', () => {
  assert.ok(app.includes("urlParams.set('f-has-video', '1')"), 'f-has-video absent de l\'URL');
  assert.ok(app.includes("urlParams.set('f-has-tour',  '1')"), 'f-has-tour absent de l\'URL');
});

test('restauration depuis URL : f-has-video / f-has-tour dans init()', () => {
  assert.ok(app.includes("params.get('f-has-video') === '1'"), 'restauration f-has-video absente');
  assert.ok(app.includes("params.get('f-has-tour')  === '1'"), 'restauration f-has-tour absente');
});

test('landingOnly : faux quand des filtres média sont actifs', () => {
  const block = app.slice(app.indexOf('const landingOnly'));
  const line  = block.slice(0, block.indexOf(';'));
  assert.ok(line.includes('mf.has_video'), 'mf.has_video absent de landingOnly');
  assert.ok(line.includes('mf.has_tour'),  'mf.has_tour absent de landingOnly');
});

test('index.html : boutons #f-has-video et #f-has-tour présents', () => {
  assert.ok(html.includes('id="f-has-video"'), '#f-has-video absent de index.html');
  assert.ok(html.includes('id="f-has-tour"'),  '#f-has-tour absent de index.html');
});
