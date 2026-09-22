// Tests unitaires — bouton "Partager cette recherche".
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');

const app  = read('app.js');
const html = read('index.html');

test('share_search / link_copied : traductions FR et AR', () => {
  assert.ok(app.includes("share_search:'🔗 Partager'"),      'share_search FR absent');
  assert.ok(app.includes("link_copied:'Lien copié !'"),      'link_copied FR absent');
  assert.ok(app.includes("share_search:'🔗 مشاركة'"),       'share_search AR absent');
  assert.ok(app.includes("link_copied:'تم نسخ الرابط !'"), 'link_copied AR absent');
});

test('shareSearch : définie et utilise navigator.clipboard', () => {
  assert.ok(app.includes('function shareSearch()'),              'shareSearch non définie');
  assert.ok(app.includes('navigator.clipboard.writeText'),       'clipboard.writeText absent');
  assert.ok(app.includes("T('link_copied')"),                    'toast link_copied absent');
});

test('index.html : bouton shareSearch présent dans la barre de filtres', () => {
  assert.ok(html.includes('shareSearch()'), 'appel shareSearch absent de index.html');
  assert.ok(html.includes('data-i18n="share_search"'), 'data-i18n share_search absent');
});
