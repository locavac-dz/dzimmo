// Gabarits de public/index.html : les données ne doivent jamais casser un attribut HTML (src, onclick).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

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
