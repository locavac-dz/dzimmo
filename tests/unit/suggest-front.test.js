// Tests unitaires — autocomplétion de la barre de recherche.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');

const app  = read('app.js');
const html = read('index.html');

test('initSuggest : définie et appelée dans init()', () => {
  assert.ok(app.includes('function initSuggest()'),  'initSuggest non définie');
  assert.ok(app.includes('initSuggest();'),           'initSuggest non appelée dans init()');
});

test('fetchSuggest : appelle /search/suggest avec encodeURIComponent', () => {
  assert.ok(app.includes("api('/search/suggest?q=' + encodeURIComponent(q))"), 'appel API absent');
});

test('renderSuggest : utilise data-id + data-title + onclick selectSuggest(this)', () => {
  assert.ok(app.includes('function renderSuggest(items)'),        'renderSuggest non définie');
  assert.ok(app.includes('data-id="${p.id}"'),                    'data-id absent');
  assert.ok(app.includes('data-title="${esc(p.title)}"'),         'data-title absent');
  assert.ok(app.includes('onclick="selectSuggest(this)"'),        'appel selectSuggest absent');
  // Pas de données en dur dans onclick
  assert.ok(!app.match(/onclick="selectSuggest\([^)]+,[^)]+\)"/), 'données en dur dans onclick !');
});

test('selectSuggest : lit id et title depuis this.dataset', () => {
  assert.ok(app.includes('function selectSuggest(el)'),  'selectSuggest non définie');
  assert.ok(app.includes('el.dataset.id'),               'dataset.id absent');
  assert.ok(app.includes('el.dataset.title'),            'dataset.title absent');
});

test('closeSuggest : définie et appelée sur Escape et clic hors', () => {
  assert.ok(app.includes('function closeSuggest()'),         'closeSuggest non définie');
  assert.ok(app.includes("e.key === 'Escape'"),              'Escape absent');
  assert.ok(app.includes("closest('#suggest-wrap')"),        'clic hors absent');
});

test('debounce : _suggestTimer avec setTimeout 280 ms', () => {
  assert.ok(app.includes('_suggestTimer = setTimeout'),  'debounce absent');
  assert.ok(app.includes('280'),                          'délai absent');
});

test('index.html : #suggest-wrap, #suggest-box et #f-q présents', () => {
  assert.ok(html.includes('id="suggest-wrap"'), '#suggest-wrap absent');
  assert.ok(html.includes('id="suggest-box"'),  '#suggest-box absent');
  assert.ok(html.includes('id="f-q"'),           '#f-q absent');
});
