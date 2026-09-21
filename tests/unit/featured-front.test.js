// « À la une » côté front : traductions FR/AR, badge, bande, fenêtre de commande, bouton du tableau de bord et de l'administration.
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
  const b = lang === 'fr' ? app.indexOf('\n  ar: {') : app.indexOf('\n};', a);
  return app.slice(a, b);
}
function text(lang, key) {
  const m = block(lang).match(new RegExp(String.raw`\b${key}:\s*(['"])((?:\\.|(?!\1).)*)\1`));
  return m ? m[2] : null;
}
// Extrait une fonction (ou une constante) du script, de son début jusqu'à la « } » ou au « ; » de tête de ligne suivant
function extract(startMarker, endMarker) {
  const a = app.indexOf(startMarker);
  assert.ok(a >= 0, startMarker);
  const b = app.indexOf(endMarker, a);
  assert.ok(b > a, endMarker);
  return app.slice(a, b);
}

const KEYS = ['featured_badge', 'featured_title', 'u_day_one', 'u_day_two', 'u_day_many', 'dash_feature_btn', 'dash_featured_until',
  'pr_title', 'pr_intro', 'pr_extend_note', 'pr_test_note', 'pr_pay', 'pr_closed', 'pr_choose', 'pr_done'];

test('chaque texte de la mise à la une existe en français et en arabe', () => {
  for (const k of KEYS) for (const lang of ['fr', 'ar']) {
    const t = text(lang, k);
    assert.ok(t, `${lang}.${k}`);
    if (lang === 'ar' && !k.startsWith('u_day')) assert.match(t, /[؀-ۿ]/, `${k} en arabe`);
  }
  for (const k of ['dash_featured_until', 'pr_done']) for (const lang of ['fr', 'ar']) assert.ok(text(lang, k).includes('{date}'), `${lang}.${k} garde {date}`);
});

test('les textes de la fenêtre du HTML ont leur clé de traduction', () => {
  for (const m of html.matchAll(/id="modal-promote"[\s\S]*?(?=<!-- Toast -->)/g))
    for (const [, key] of m[0].matchAll(/data-i18n="([^"]+)"/g)) assert.ok(text('fr', key) && text('ar', key), key);
});

test('la page contient les deux bandes et la fenêtre, et reste légère', () => {
  assert.match(html, /<section id="home-featured" class="featured-strip hidden"><\/section>/);
  assert.match(html, /<section id="annonces-featured" class="featured-strip hidden"><\/section>/);
  assert.match(html, /id="modal-promote"/);
  assert.match(html, /id="promote-plans"/);
  assert.ok(Buffer.byteLength(read('index.html')) < 120 * 1024);
});

test('durée : « jour » suit le nombre, avec le duel et le pluriel arabes', () => {
  const src = extract('function unit(n, base) {', '\n\n// ── Thème');
  const tr = { fr: {}, ar: {} };
  for (const l of ['fr', 'ar']) for (const k of ['u_day_one', 'u_day_two', 'u_day_many']) tr[l][k] = text(l, k);
  const ctx = { currentLang: 'fr', T: k => tr[ctx.currentLang][k] };
  vm.createContext(ctx);
  vm.runInContext(`${src}\nthis.unit = unit;`, ctx);
  assert.deepEqual([1, 7, 30].map(n => ctx.unit(n, 'u_day')), ['jour', 'jours', 'jours']);
  ctx.currentLang = 'ar';
  assert.deepEqual([1, 2, 7, 15, 30].map(n => ctx.unit(n, 'u_day')), ['يوم', 'يومان', 'أيام', 'يوم', 'يوم']);
});

test('isFeatured : seule une date de fin future compte', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extract('const isFeatured', '\n\n') + '\nthis.isFeatured = isFeatured;', ctx);
  const dans = ms => new Date(Date.now() + ms).toISOString();
  assert.equal(ctx.isFeatured({ featured_until: dans(60000) }), true);
  assert.equal(ctx.isFeatured({ featured_until: dans(-60000) }), false);
  for (const p of [{}, { featured_until: null }, { featured_until: 'pas une date' }, null, undefined]) assert.equal(ctx.isFeatured(p), false, String(p));
});

test('la carte porte la pastille « À la une », traduite', () => {
  assert.match(app, /\$\{isFeatured\(p\) \? '<span class="featured-badge">' \+ T\('featured_badge'\) \+ '<\/span>' : ''\}/);
});

// Bande exécutée avec de faux éléments : rien n'est affiché sans annonce ni en cas d'erreur, tout titre passe par cardHTML (donc esc)
async function strip(apiImpl, filters, limit) {
  const box = { innerHTML: 'ancien', cls: new Set(['hidden']), classList: { add(c) { box.cls.add(c); }, remove(c) { box.cls.delete(c); } } };
  const calls = [];
  const ctx = { document: { getElementById: id => (id === 'zone' ? box : null) }, URLSearchParams,
    api: async path => { calls.push(path); return apiImpl(path); }, T: k => k, cardHTML: p => `<i>${p.id}</i>` };
  vm.createContext(ctx);
  vm.runInContext(extract('async function loadFeatured', '\n\nfunction cardHTML') + '\nthis.loadFeatured = loadFeatured;', ctx);
  await ctx.loadFeatured('zone', filters, limit);
  return { box, calls };
}

test('bande : annonces reçues → affichée avec le titre ; aucune ou erreur → masquée et vidée', async () => {
  let r = await strip(() => ({ data: [{ id: 1 }, { id: 2 }] }), { mode: 'vente', type_bien: '', wilaya: 'Oran', autre: 'x' }, 3);
  assert.equal(r.box.cls.has('hidden'), false);
  assert.match(r.box.innerHTML, /featured_title/);
  assert.match(r.box.innerHTML, /<i>1<\/i><i>2<\/i>/);
  assert.equal(r.calls[0], '/properties/featured?limit=3&mode=vente&wilaya=Oran', 'filtres connus seulement, vides ignorés');
  r = await strip(() => ({ data: [] }), {});
  assert.equal(r.box.cls.has('hidden'), true); assert.equal(r.box.innerHTML, '');
  r = await strip(() => { throw new Error('panne'); }, {});
  assert.equal(r.box.cls.has('hidden'), true); assert.equal(r.box.innerHTML, '');
});

test('la bande est demandée sur l\'accueil et sur la page 1 des annonces, avec les filtres courants', () => {
  assert.match(app, /loadFeatured\('home-featured', \{ mode \}\);/);
  assert.match(app, /if \(page === 1\) loadFeatured\('annonces-featured', \{ mode: get\('f-mode'\), type_bien: get\('f-type'\), wilaya: get\('f-wilaya'\) \}, 3\);/);
});

test('fenêtre de commande : formules du serveur en nombres, aucune donnée dans onclick, simulation puis rafraîchissement, redirection https seulement', () => {
  assert.match(app, /const days = Number\(pl\.days\), price = Number\(pl\.price\);/);
  assert.match(app, /data-id="\$\{p\.id\}" onclick="openPromote\(this\.dataset\.id\)"/);
  assert.match(app, /data-id="\$\{p\.id\}" onclick="adminFeature\(this\.dataset\.id\)"/);
  assert.match(app, /api\('\/promotions', 'POST', \{ property_id: _promoId, days \}\)/);
  assert.match(app, /api\('\/promotions\/' \+ order\.id \+ '\/simulate', 'POST'\)/);
  assert.match(app, /else if \(isHttps\(order\.redirect\)\) \{\s*location\.href = order\.redirect;/);
  assert.match(app, /btn\.disabled = true;/);
  assert.match(app, /if \(currentPage === 'dashboard'\) dashTab\('mes-annonces'\);/);
});

test('tableau de bord : bouton pour les annonces publiées quand les formules sont ouvertes, date de fin visible', () => {
  assert.match(app, /\$\{p\.status==='active' && promo\.enabled && promo\.plans\.length \? `<button class="btn btn-outline btn-sm promo-btn"/);
  assert.match(app, /T\('dash_featured_until'\)\.replace\('\{date\}', day\(p\.featured_until\)\)/);
});

test('administration : la durée saisie est contrôlée avant l\'envoi (0 à 365 jours)', () => {
  const src = extract('async function adminFeature', '\n\nasync function adminVerifyProperty');
  assert.match(src, /'\/admin\/properties\/' \+ id \+ '\/une', 'PUT', \{ days \}/);
  assert.match(src, /days > 365/);
});

// ── Couleurs ───────────────────────────────────────
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('--gold-text : défini dans les quatre blocs de thème, lisible (AA) sur les fonds clairs et sombres', () => {
  const vals = [...css.matchAll(/--gold-text:\s*(#[0-9a-fA-F]{6})/g)].map(m => m[1]);
  assert.equal(vals.length, 4, 'défaut, clair, sombre, sombre automatique');
  assert.equal(vals.filter(v => v === '#fbbf24').length, 2);
  for (const v of vals) {
    const fonds = v === '#fbbf24' ? ['#0f172a', '#1e293b'] : ['#ffffff', '#f8fafc'];
    for (const f of fonds) assert.ok(contrast(v, f) >= 4.5, `${v} sur ${f}`);
  }
});

test('pastille « À la une » : blanc sur ambre foncé assez contrasté, placée avec inset-inline (RTL)', () => {
  const m = css.match(/\.featured-badge \{[^}]*\}/);
  assert.ok(m);
  assert.match(m[0], /inset-inline-end/);
  const bg = m[0].match(/background:\s*(#[0-9a-fA-F]{6})/)[1];
  assert.ok(contrast(bg, '#ffffff') >= 4.5, bg);
});
