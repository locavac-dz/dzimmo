// Tests unitaires — page tendances du marché côté front.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');

const app  = read('app.js');
const html = read('index.html');

test('market_title / market_sub / market_no_data : traductions FR et AR', () => {
  assert.ok(app.includes("market_title:'Tendances du marché'"),                      'market_title FR absent');
  assert.ok(app.includes("market_sub:'Prix médian au m² par wilaya"),                'market_sub FR absent');
  assert.ok(app.includes("market_no_data:'Pas encore assez de données disponibles.'")), 'market_no_data FR absent';
  assert.ok(app.includes("market_title:'توجهات السوق'"),                             'market_title AR absent');
  assert.ok(app.includes("market_sub:'متوسط السعر"),                                  'market_sub AR absent');
  assert.ok(app.includes("market_no_data:'لا توجد بيانات كافية.'"),                  'market_no_data AR absent');
});

test('loadMarket : définie et appelle /stats/market', () => {
  assert.ok(app.includes('async function loadMarket()'),    'loadMarket non définie');
  assert.ok(app.includes("api('/stats/market')"),           '/stats/market absent');
});

test('marketHTML : fonction pure → chaîne HTML, utilise esc() et wilayaName()', () => {
  assert.ok(app.includes('function marketHTML(data)'),      'marketHTML non définie');
  // wilayaName doit être appelé sur r.wilaya (pas r.wilaya brut dans le HTML)
  assert.ok(app.includes('wilayaName(r.wilaya)'),           'wilayaName absent dans marketHTML');
});

test('PAGES contient tendances', () => {
  assert.ok(app.includes("'tendances'"), "tendances absent du tableau PAGES");
});

test('showPage : appelle loadMarket() pour tendances', () => {
  assert.ok(app.includes("page === 'tendances')       loadMarket()"), 'loadMarket non câblé dans showPage');
});

test('index.html : page #page-tendances et #market-content présents', () => {
  assert.ok(html.includes('id="page-tendances"'),  '#page-tendances absent');
  assert.ok(html.includes('id="market-content"'),  '#market-content absent');
});

test('index.html : lien tendances dans le footer', () => {
  assert.ok(html.includes("showPage('tendances')"),  'lien tendances absent du footer');
});
