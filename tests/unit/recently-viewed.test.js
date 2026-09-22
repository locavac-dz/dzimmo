// Tests unitaires — annonces récemment vues (localStorage).
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');

const app  = read('app.js');
const html = read('index.html');

test('recently_viewed : traductions FR et AR', () => {
  assert.ok(app.includes("recently_viewed:'Récemment vus'"),   'recently_viewed FR absent');
  assert.ok(app.includes("recently_viewed:'شوهدت مؤخراً'"),   'recently_viewed AR absent');
});

test('trackView : définie dans app.js', () => {
  assert.ok(app.includes('function trackView(p)'), 'trackView non définie');
});

test('trackView : stocke dans VIEWED_KEY (dzimmo_viewed)', () => {
  assert.ok(app.includes("'dzimmo_viewed'"), 'clé localStorage absente');
});

test('trackView : plafond à VIEWED_MAX (6)', () => {
  assert.ok(app.includes('VIEWED_MAX = 6'), 'VIEWED_MAX absent');
  assert.ok(app.includes('filtered.slice(0, VIEWED_MAX)'), 'slice absent');
});

test('recentlyViewedHTML : définie et utilise cardHTML', () => {
  assert.ok(app.includes('function recentlyViewedHTML()'), 'recentlyViewedHTML non définie');
  assert.ok(app.includes('items.map(p => cardHTML(p))'), 'cardHTML absent dans recentlyViewedHTML');
});

test('showRecentlyViewed : met à jour #home-recently-viewed', () => {
  assert.ok(app.includes('function showRecentlyViewed()'), 'showRecentlyViewed non définie');
  assert.ok(app.includes("getElementById('home-recently-viewed')"), '#home-recently-viewed absent');
});

test('trackView : appelée dans renderDetail', () => {
  assert.ok(app.includes('trackView(p);'), 'trackView non appelée dans renderDetail');
});

test('showRecentlyViewed : appelée dans loadHomeProperties', () => {
  assert.ok(app.includes('showRecentlyViewed();'), 'showRecentlyViewed non appelée dans loadHomeProperties');
});

test('index.html : contient #home-recently-viewed', () => {
  assert.ok(html.includes('id="home-recently-viewed"'), '#home-recently-viewed absent de index.html');
});
