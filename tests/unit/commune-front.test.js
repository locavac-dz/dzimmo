// Pages de commune côté front : lecture du chemin, libellé FR / AR, pastille, filtre envoyé à l'API, aucune donnée dans onclick.
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const { read, readFront } = require('../helpers/front');

const app  = read('app.js');
const css  = read('app.css');
const html = readFront();

function block(lang) {
  const a = app.indexOf(`\n  ${lang}: {`);
  assert.ok(a > 0, `bloc ${lang}`);
  return app.slice(a, lang === 'fr' ? app.indexOf('\n  ar: {') : app.indexOf('\n};', a));
}
const text = (lang, key) => (block(lang).match(new RegExp(String.raw`\b${key}:\s*(['"])((?:\\.|(?!\1).)*)\1`)) || [])[2] || null;
function extract(startMarker, endMarker) {
  const a = app.indexOf(startMarker);
  assert.ok(a >= 0, startMarker);
  const b = app.indexOf(endMarker, a);
  assert.ok(b > a, endMarker);
  return app.slice(a, b);
}

// Contexte minimal : les fonctions réelles du script, avec de fausses dépendances
function context() {
  const box = { classes: new Set(['hidden']), textContent: '' };
  const els = { 'commune-chip': { classList: { toggle: (c, on) => (on ? box.classes.add(c) : box.classes.delete(c)) } }, 'commune-label': box };
  const ctx = { currentLang: 'fr', WILAYAS: ['Alger', 'Oran', 'Sétif'], WILAYAS_AR: { Oran: 'وهران' }, document: { getElementById: id => els[id] || null },
    T: k => ({ seo_t_all: 'Biens immobiliers', seo_t_villa: 'Villas', seo_m_vente: 'à vendre', seo_in: 'à' })[k] || k, loadAnnonces: () => { ctx.reloaded = true; } };
  ctx.wilayaName = w => (ctx.currentLang === 'ar' && ctx.WILAYAS_AR[w]) || w;
  vm.createContext(ctx);
  const src = [extract('function slugify(s) {', '\n\n'), extract('const SEO_MODES', '\nfunction relabelSeo'), ''].join('\n');
  vm.runInContext(src + '\nthis.parse = parseLandingPath; this.path = landingPath; this.label = seoLabel; this.setCommune = setCommune; this.clearCommune = clearCommune; this.state = () => _commune;', ctx);
  return { ctx, box };
}

test('parseLandingPath : commune en dernier segment, type avant la wilaya ou (ancienne forme) après', () => {
  const { ctx } = context();
  const p = x => JSON.parse(JSON.stringify(ctx.parse(x)));
  assert.deepEqual(p('/vente/oran/bir-el-djir'), { mode: 'vente', type: '', wilaya: 'Oran', commune: 'bir-el-djir' });
  assert.deepEqual(p('/vente/villas/oran/bir-el-djir'), { mode: 'vente', type: 'villa', wilaya: 'Oran', commune: 'bir-el-djir' });
  assert.deepEqual(p('/vente/villas/oran'), { mode: 'vente', type: 'villa', wilaya: 'Oran', commune: '' });
  assert.deepEqual(p('/vente/oran/villas'), { mode: 'vente', type: 'villa', wilaya: 'Oran', commune: '' });
  assert.deepEqual(p('/location/oran'), { mode: 'location_longue', type: '', wilaya: 'Oran', commune: '' });
  assert.equal(p('/vente').wilaya, '');
});

test('parseLandingPath : ce qui n\'est pas une page de recherche est refusé', () => {
  const { ctx } = context();
  for (const x of ['/', '/agences', '/vente/bir-el-djir', '/vente/oran/bir-el-djir/x', '/vente/villas/oran/bir-el-djir/x', '/vente/oran/<b>', '/vente/oran/-x',
    '/vente/oran/bir_el', '/vente/oran/BIR', '/annonce/12-villa'])
    assert.equal(ctx.parse(x), null, x);
});

test('landingPath : la commune n\'est ajoutée qu\'avec une wilaya, sous forme de slug', () => {
  const { ctx } = context();
  assert.equal(ctx.path('vente', 'villa', 'Oran', 'Bir El Djir'), '/vente/villas/oran/bir-el-djir');
  assert.equal(ctx.path('vente', '', 'Oran', 'bir-el-djir'), '/vente/oran/bir-el-djir');
  assert.equal(ctx.path('vente', '', '', 'Bir El Djir'), '/vente');
  assert.equal(ctx.path('vente', '', 'Oran'), '/vente/oran');
});

test('seoLabel : « … à Bir El Djir, Oran » en français, séparateur et nom de wilaya arabes en arabe', () => {
  const { ctx } = context();
  assert.equal(ctx.label('vente', 'villa', 'Oran', 'Bir El Djir'), 'Villas à vendre à Bir El Djir, Oran');
  assert.equal(ctx.label('vente', '', 'Oran'), 'Biens immobiliers à vendre à Oran');
  assert.equal(ctx.label('vente', '', ''), 'Biens immobiliers à vendre');
  ctx.currentLang = 'ar';
  assert.equal(ctx.label('vente', '', 'Oran', 'Bir El Djir'), 'Biens immobiliers à vendre à Bir El Djir، وهران');
});

test('pastille : setCommune l\'affiche (libellé du serveur, sinon slug lisible) ; clearCommune la retire et recharge la liste', () => {
  const { ctx, box } = context();
  ctx.setCommune('bir-el-djir', 'Bir El Djir');
  assert.equal(box.textContent, 'Bir El Djir'); assert.equal(box.classes.has('hidden'), false);
  ctx.setCommune('ain-benian');
  assert.equal(box.textContent, 'Ain Benian', 'sans libellé : le slug rendu lisible');
  ctx.clearCommune();
  assert.equal(ctx.state(), null); assert.equal(box.classes.has('hidden'), true); assert.equal(box.textContent, ''); assert.equal(ctx.reloaded, true);
});

test('libellé de commune : posé avec textContent, jamais avec innerHTML', () => {
  const src = extract('function setCommune(', '\nfunction clearCommune');
  assert.match(src, /commune-label'\)\.textContent = /);
  assert.doesNotMatch(src, /innerHTML/);
});

test('liste des annonces : la commune part à l\'API (avec la wilaya seulement), dans l\'adresse partageable et dans l\'adresse indexable', () => {
  assert.match(app, /if \(_commune && get\('f-wilaya'\)\) params\.set\('commune', _commune\.slug\);/);
  assert.match(app, /if \(_commune && get\('f-wilaya'\)\) urlParams\.set\('f-commune', _commune\.slug\);/);
  assert.match(app, /landingPath\(get\('f-mode'\), get\('f-type'\), get\('f-wilaya'\), commune\?\.slug\)/);
  assert.match(app, /setCommune\(landing\.commune, document\.querySelector\('#seo-landing \[data-seo-k\]'\)\?\.dataset\.seoK\)/);
  assert.match(app, /\/\^\[a-z0-9\]\+\(\?:-\[a-z0-9\]\+\)\*\$\/\.test\(params\.get\('f-commune'\) \|\| ''\)/, 'adresse partagée : slug valide seulement');
  assert.match(app, /getElementById\('f-wilaya'\)\.addEventListener\('change', \(\) => setCommune\(null\)\)/, 'changer de wilaya retire la commune');
});

test('les libellés des liens rendus par le serveur suivent la langue, commune comprise', () => {
  assert.match(app, /seoLabel\(d\.seoM, d\.seoT, d\.seoW, d\.seoK\)/);
});

test('textes de la pastille en français et en arabe, HTML sans style en ligne ni onclick porteur de donnée', () => {
  for (const lang of ['fr', 'ar']) assert.ok(text(lang, 'commune_in'), lang);
  assert.match(text('ar', 'commune_in'), /[؀-ۿ]/);
  const chip = html.match(/<div id="commune-chip"[\s\S]*?<\/div>/)[0];
  assert.match(chip, /class="commune-chip hidden"/);
  assert.match(chip, /onclick="clearCommune\(\)"/);
  assert.doesNotMatch(chip, /style=/);
  for (const [, key] of chip.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(text('fr', key) && text('ar', key), key);
  assert.match(css, /\.commune-chip button \{[^}]*margin-inline-start/, 'RTL : marge logique');
});
