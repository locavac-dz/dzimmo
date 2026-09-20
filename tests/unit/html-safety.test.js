// Gabarits de public/index.html : les données ne doivent jamais casser un attribut HTML (src, onclick).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { readFront } = require('../helpers/front');

const html = readFront();

test('les images du site sont échappées dans les gabarits d\'annonces (src issu des données)', () => {
  assert.doesNotMatch(html, /src="\$\{(?:p\.image|photos\[\d\]|d\.property_image|c\.property_img|img)\b/, 'src non échappé');
  assert.doesNotMatch(html, /src="\$\{p\.image \|\|/);
});

test('fiche d\'annonce : la visionneuse lit les photos dans une variable, jamais du JSON dans un onclick (les guillemets cassaient l\'attribut)', () => {
  assert.doesNotMatch(html, /photosJSON/);
  assert.match(html, /window\._detailPhotos = photos;/);
  const calls = [...html.matchAll(/onclick="openLightbox\(([^"]*)\)"/g)].map(m => m[1]);
  assert.ok(calls.length >= 3, 'trois ouvertures de la visionneuse dans la fiche : ' + calls.length);
  // variable globale (parfois indexée par annonce) et un indice : jamais de JSON ni de donnée de la page dans l'attribut
  for (const a of calls) assert.match(a, /^window\._\w+(?:\[\$\{\w+\.id\}\])?, (?:\d|\$\{i\})$/, a);
});

test('aucun onclick ne contient de JSON ni de texte issu des données (titre, commune…) : data-* et this.dataset', () => {
  const onclicks = [...html.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
  assert.ok(onclicks.length > 50, 'les gabarits sont bien lus : ' + onclicks.length);
  for (const a of onclicks) {
    assert.doesNotMatch(a, /JSON\.stringify/, 'JSON dans un onclick : ' + a);
    assert.doesNotMatch(a, /\$\{\w+\.(?:title|commune|description|name|body|address)\b/, 'donnée de la page dans un onclick : ' + a);
  }
  // partage WhatsApp et suppression admin : le titre passe par un attribut data-title échappé
  assert.match(html, /data-title="\$\{esc\(p\.title\)\}" onclick="shareWhatsApp\(\$\{p\.id\}, this\.dataset\.title/);
  assert.match(html, /data-title="\$\{esc\(p\.title\)\}" onclick="adminDeleteProperty\(\$\{p\.id\}, this\.dataset\.title\)/);
});

test('fiche et comparateur : équipements, commune, type et mode sont échappés avant innerHTML', () => {
  assert.match(html, /class="feature-chip">\$\{esc\(FEATURES\[f\] \|\| f\)\}/, 'équipement non échappé');
  assert.doesNotMatch(html, /\$\{FEATURES\[f\] \|\| f\}/);
  assert.match(html, /p => esc\(p\.commune \|\| '—'\)/, 'commune non échappée dans le comparateur');
  assert.match(html, /p => esc\(TYPES\[p\.type_bien\] \|\| p\.type_bien\)/);
  assert.match(html, /p => esc\(MODES\[p\.mode\] \|\| p\.mode\)/);
  assert.match(html, /p => esc\(wilayaName\(p\.wilaya\) \|\| '—'\)/);
});
