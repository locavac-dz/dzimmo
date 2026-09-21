// Carte : zone dessinée et « autour de moi » côté front (public/app.js + index.html) — structure, traductions, vie privée.
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const { read, readFront } = require('../helpers/front');
const { MAX_VERTICES } = require('../../server/geo');

const app  = read('app.js');
const html = readFront();

// Code de la carte : du premier helper au chargement d'une zone
const start = app.indexOf('function mapFilterValues()');
const end   = app.indexOf('// ── Stats journalières');
const carte = app.slice(start, end);

// Bloc de traductions d'une langue
function block(lang) {
  const a = app.indexOf(`\n  ${lang}: {`);
  assert.ok(a > 0, `bloc ${lang}`);
  const b = lang === 'fr' ? app.indexOf('\n  ar: {') : app.indexOf('\n};', a);
  return app.slice(a, b);
}

const KEYS = ['map_draw_mode', 'map_draw_exit', 'map_draw_hint', 'map_draw_finish', 'map_draw_undo', 'map_draw_clear', 'map_draw_min',
              'map_draw_max', 'map_zone_results_poly', 'map_truncated', 'map_me_btn', 'map_me_locating', 'map_me_denied', 'map_me_here'];

test('carte : chaque nouveau texte existe en français et en arabe (l\'arabe contient de l\'arabe)', () => {
  for (const lang of ['fr', 'ar']) {
    const src = block(lang);
    for (const k of KEYS) {
      const m = src.match(new RegExp(String.raw`\b${k}:\s*(['"])((?:\\.|(?!\1).)*)\1`));
      assert.ok(m, `${lang}.${k}`);
      if (lang === 'ar') assert.match(m[2], /[؀-ۿ]/, `${k} en arabe`);
    }
  }
  // les textes à trous gardent leur paramètre dans les deux langues
  for (const lang of ['fr', 'ar']) {
    assert.match(block(lang), /map_zone_results_poly:'\{n\}|map_zone_results_poly:'[^']*\{n\}/, lang);
    assert.match(block(lang), /map_truncated:'[^']*\{n\}/, lang);
  }
});

test('carte : les boutons de la page existent et appellent des fonctions définies', () => {
  for (const [id, fn] of [['map-zone-btn', 'toggleMapZone'], ['map-me-btn', 'mapAroundMe'], ['map-draw-btn', 'toggleMapDraw']]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*onclick="${fn}\\(\\)"`), id);
    assert.match(app, new RegExp(`function ${fn}\\(`), fn);
  }
  for (const fn of ['finishMapDraw', 'undoMapDraw', 'clearMapDraw'])
    assert.ok(html.includes(`onclick="${fn}()"`) && app.includes(`function ${fn}(`), fn);
  assert.match(html, /id="map-draw-controls" class="hidden"/);
  // chaque bouton porte sa clé de traduction, connue des deux langues
  for (const id of ['map-me-btn', 'map-draw-btn']) {
    const key = html.match(new RegExp(`id="${id}"[^>]*data-i18n="([a-z_]+)"`))[1];
    assert.ok(KEYS.includes(key), key);
  }
});

test('carte : aucune donnée de la page dans un onclick (data-id) et tout ce qui vient du serveur est échappé', () => {
  const clicks = [...carte.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
  assert.ok(clicks.length > 0);
  for (const c of clicks) assert.equal(c, "showPage('detail',Number(this.dataset.id))", c);
  assert.match(carte, /data-id="\$\{Number\(p\.id\)\}"/);
  // les valeurs de l'annonce insérées dans la fenêtre passent par esc() (le prix et le texte de traduction sont déjà mis en forme)
  const popup = carte.slice(carte.indexOf('const popup'), carte.indexOf('return L.marker'));
  for (const m of popup.matchAll(/\$\{([^}]*)\}/g)) {
    const expr = m[1];
    if (/^(esc\(|Number\(p\.id\)|color$|dist$|priceText\(p\)$|T\('map_view'\)$)/.test(expr)) continue;
    assert.fail(`valeur non échappée dans la fenêtre de la carte : \${${expr}}`);
  }
});

test('carte : la zone part en POST (jamais dans l\'adresse) et la position du visiteur est arrondie à 3 décimales', () => {
  assert.match(carte, /api\('\/properties\/zone', 'POST', body\)/);
  assert.doesNotMatch(carte, /\/properties\/zone\?/);
  assert.match(carte, /mapCoord\(pos\.coords\.latitude, 3\)/);
  assert.match(carte, /mapCoord\(pos\.coords\.longitude, 3\)/);
  // la position n'est ni mémorisée ni journalisée
  assert.doesNotMatch(carte, /localStorage|sessionStorage|console\.(log|info)\([^)]*(lat|lng|coords)/);
  assert.match(carte, /getCurrentPosition/);
});

test('carte : mapCoord arrondit ; le nombre de points du tracé suit la limite du serveur', () => {
  const src = carte.slice(carte.indexOf('function mapCoord'), carte.indexOf('function setMapBtn'));
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.mapCoord = mapCoord;', ctx);
  assert.equal(ctx.mapCoord(36.7538291, 3), 36.754);
  assert.equal(ctx.mapCoord(3.0588123456, 3), 3.059);
  assert.equal(ctx.mapCoord(3.0588123456), 3.05881);
  assert.equal(ctx.mapCoord(-0.0004, 3), -0);
  assert.match(carte, new RegExp(`MAP_MAX_POINTS = ${MAX_VERTICES};`));
});

test('carte : les filtres rafraîchissent le rayon ou la zone actifs et une réponse périmée est ignorée', () => {
  const load = carte.slice(carte.indexOf('async function loadMapMarkers'), carte.indexOf('// ── Carte : rayon'));
  assert.match(load, /_mapMode === 'radius' && _mapZoneCenter\) return loadNearbyMarkers\(\)/);
  assert.match(load, /_mapMode === 'draw' && _mapPolygon\)\s+return loadZoneMarkers\(\)/);
  for (const fn of ['loadMapMarkers', 'loadNearbyMarkers', 'loadZoneMarkers']) {
    const body = carte.slice(carte.indexOf(`async function ${fn}`));
    const own = body.slice(0, body.indexOf('\n}\n'));
    assert.match(own, /const req = \+\+_mapReq/, fn);
    assert.match(own, /req !== _mapReq/, fn);
  }
  assert.match(html, /id="map-wilaya" onchange="loadMapMarkers\(\)"/);
});
