// Écran « Modifier mon annonce » côté front : le formulaire de publication sert aussi à modifier (public/app.js, index.html, pro.js).
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const { read, readFront } = require('../helpers/front');

const app  = read('app.js');
const pro  = read('pro.js');
const html = readFront();

function block(lang) {
  const a = app.indexOf(`\n  ${lang}: {`);
  assert.ok(a > 0, `bloc ${lang}`);
  const b = lang === 'fr' ? app.indexOf('\n  ar: {') : app.indexOf('\n};', a);
  return app.slice(a, b);
}
const text = (lang, key) => { const m = block(lang).match(new RegExp(String.raw`\b${key}:\s*(['"])((?:\\.|(?!\1).)*)\1`)); return m ? m[2] : null; };

test('textes du mode édition : présents en français et en arabe', () => {
  for (const key of ['dash_edit', 'pub_edit_heading', 'pub_edit_submit', 'pub_edit_locked', 'pub_edit_saved', 'pub_edit_pending']) {
    for (const lang of ['fr', 'ar']) {
      const t = text(lang, key);
      assert.ok(t, `${lang}.${key}`);
      if (lang === 'ar') assert.match(t, /[؀-ۿ]/, `${key} en arabe`);
    }
  }
});

test('page : titre, bouton et note ont un identifiant ; « Annuler » passe par cancelPublish', () => {
  assert.match(html, /id="pub-heading-text" data-i18n="pub_heading"/);
  assert.match(html, /id="pub-submit-btn"[^>]*data-i18n="pub_submit"/);
  assert.match(html, /id="pub-edit-note" class="hidden"[^>]*data-i18n="pub_edit_locked"/);
  assert.match(html, /onclick="cancelPublish\(\)" data-i18n="pub_cancel"/);
});

test('tableau de bord : le bouton Modifier ne transmet que l\'identifiant numérique de l\'annonce', () => {
  const m = app.match(/onclick="editProperty\(([^)]*)\)"/);
  assert.ok(m, 'bouton Modifier');
  assert.equal(m[1], '${p.id}');
  assert.match(app, /const p = dashListings\.find\(x => x\.id === id\);/);
});

// ── Exécution des fonctions du formulaire avec un DOM minimal ────────────────────────────────────────────────────────
function fakeDom() {
  const els = {};
  const make = (id, extra = {}) => {
    const cls = new Set(extra.hidden ? ['hidden'] : []);
    return (els[id] = { id, value: '', disabled: false, textContent: '', attrs: {}, ...extra,
      classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); } },
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; } });
  };
  ['pub-title', 'pub-mode', 'pub-type', 'pub-wilaya', 'pub-price', 'pub-surface', 'pub-rooms', 'pub-baths', 'pub-floor', 'pub-commune', 'pub-address',
   'pub-desc', 'pub-video', 'pub-tour', 'pub-heading-text', 'pub-submit-btn', 'pub-error', 'pub-success'].forEach(id => make(id));
  make('pub-edit-note', { hidden: true }); make('pub-as-wrap');
  const toggles = ['parking', 'balcon', 'piscine'].map(v => { const b = make('ft-' + v); b.dataset = { v }; return b; });
  return { els, toggles, document: {
    getElementById: id => els[id] || null,
    querySelectorAll: sel => sel === '.feature-toggle' ? toggles : sel === '.feature-toggle.selected' ? toggles.filter(b => b.classList.contains('selected')) : [],
  } };
}

function load() {
  const dom = fakeDom();
  const tr = { fr: {}, ar: {} };
  for (const l of ['fr', 'ar']) for (const k of ['pub_heading', 'pub_submit', 'pub_edit_heading', 'pub_edit_submit']) tr[l][k] = text(l, k) || text('fr', k);
  tr.fr.pub_heading = text('fr', 'pub_heading'); tr.fr.pub_submit = text('fr', 'pub_submit');
  const ctx = { document: dom.document, currentLang: 'fr', T: k => tr[ctx.currentLang][k] || tr.fr[k] || k,
    thumbUrl: (u, w) => u + '?w=' + w, esc: s => String(s), uploadedPhotos: [], publishEditId: null,
    renderPhotoPreviews() { ctx.rendered = (ctx.rendered || 0) + 1; } };
  vm.createContext(ctx);
  const a = app.indexOf('const PUB_LOCKED');
  const b = app.indexOf('async function submitProperty');
  assert.ok(a > 0 && b > a);
  vm.runInContext(`${app.slice(a, b)}
    this.syncPublishMode = syncPublishMode; this.resetPublishForm = resetPublishForm; this.fillPublishForm = fillPublishForm;`, ctx);
  return { ctx, dom };
}

const annonce = { id: 7, title: 'Villa vue mer', mode: 'vente', type_bien: 'villa', wilaya: 'Oran', price: '12000000.00', surface_m2: '250', rooms: 5, baths: 2,
  floor: 0, commune: 'Aïn El Turck', address: null, description: 'Belle villa', features: ['parking', 'piscine'],
  photos: ['/uploads/a.jpg', '/uploads/b.jpg'], image: '/uploads/a.jpg', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', tour_url: null };

test('remplissage : chaque champ reprend l\'annonce, l\'étage 0 est gardé, les équipements et photos existants sont repris', () => {
  const { ctx, dom } = load();
  ctx.publishEditId = 7;
  ctx.fillPublishForm(annonce);
  const v = id => dom.els[id].value;
  assert.equal(v('pub-title'), 'Villa vue mer'); assert.equal(v('pub-mode'), 'vente'); assert.equal(v('pub-type'), 'villa'); assert.equal(v('pub-wilaya'), 'Oran');
  assert.equal(v('pub-price'), '12000000'); assert.equal(v('pub-surface'), '250'); assert.equal(v('pub-rooms'), '5'); assert.equal(v('pub-baths'), '2');
  assert.equal(v('pub-floor'), '0', 'rez-de-chaussée');
  assert.equal(v('pub-commune'), 'Aïn El Turck'); assert.equal(v('pub-address'), ''); assert.equal(v('pub-desc'), 'Belle villa');
  assert.equal(v('pub-video'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'); assert.equal(v('pub-tour'), '');
  assert.deepEqual(dom.toggles.map(b => b.classList.contains('selected')), [true, false, true]);
  assert.deepEqual(Array.from(ctx.uploadedPhotos, p => p.url), ['/uploads/a.jpg', '/uploads/b.jpg']);
  assert.ok(ctx.uploadedPhotos.every(p => !p.file && p.preview.includes('w=480')), 'photos en ligne : pas de fichier, vignette réduite');
  assert.ok(ctx.rendered >= 1);
});

test('remplissage : sans liste de photos, la photo principale est reprise ; champs absents = champs vides', () => {
  const { ctx, dom } = load();
  ctx.fillPublishForm({ id: 1, title: 'Sans rien', mode: 'vente', type_bien: 'terrain', wilaya: 'Alger', price: 1, photos: [], image: '/uploads/c.jpg', features: null });
  assert.deepEqual(Array.from(ctx.uploadedPhotos, p => p.url), ['/uploads/c.jpg']);
  assert.equal(dom.els['pub-surface'].value, ''); assert.equal(dom.els['pub-floor'].value, '');
  assert.ok(dom.toggles.every(b => !b.classList.contains('selected')));
});

test('mode édition : titre et bouton passent à « Modifier », mode / type / wilaya sont figés, la vitrine est masquée', () => {
  const { ctx, dom } = load();
  ctx.publishEditId = 7;
  ctx.syncPublishMode();
  assert.equal(dom.els['pub-heading-text'].textContent, text('fr', 'pub_edit_heading'));
  assert.equal(dom.els['pub-heading-text'].attrs['data-i18n'], 'pub_edit_heading', 'la clé suit : le changement de langue garde le bon texte');
  assert.equal(dom.els['pub-submit-btn'].attrs['data-i18n'], 'pub_edit_submit');
  assert.equal(dom.els['pub-edit-note'].classList.contains('hidden'), false);
  for (const id of ['pub-mode', 'pub-type', 'pub-wilaya']) assert.equal(dom.els[id].disabled, true, id);
  assert.equal(dom.els['pub-as-wrap'].classList.contains('hidden'), true);
  // retour à la publication
  ctx.publishEditId = null;
  ctx.syncPublishMode();
  assert.equal(dom.els['pub-heading-text'].attrs['data-i18n'], 'pub_heading');
  assert.equal(dom.els['pub-submit-btn'].attrs['data-i18n'], 'pub_submit');
  assert.equal(dom.els['pub-edit-note'].classList.contains('hidden'), true);
  for (const id of ['pub-mode', 'pub-type', 'pub-wilaya']) assert.equal(dom.els[id].disabled, false, id);
});

test('sortie du mode édition : plus aucune donnée de l\'annonce ne reste dans le formulaire', () => {
  const { ctx, dom } = load();
  ctx.publishEditId = 7;
  ctx.fillPublishForm(annonce);
  ctx.publishEditId = null;
  ctx.resetPublishForm();
  for (const id of ['pub-title', 'pub-price', 'pub-surface', 'pub-commune', 'pub-desc', 'pub-video', 'pub-tour']) assert.equal(dom.els[id].value, '', id);
  assert.equal(ctx.uploadedPhotos.length, 0);
  assert.ok(dom.toggles.every(b => !b.classList.contains('selected')));
  assert.equal(dom.els['pub-mode'].disabled, false);
});

test('showPage : quitter la page de publication en mode édition remet le formulaire à zéro ; l\'arrivée règle le mode', () => {
  assert.match(app, /if \(page !== 'publier' && publishEditId\) \{ publishEditId = null; resetPublishForm\(\); \}/);
  assert.match(app, /if \(page === 'publier'\)\s+\{ syncPublishMode\(\); initPublishAs\(\); \}/);
  assert.match(app, /function cancelPublish\(\) \{ showPage\(publishEditId \? 'dashboard' : 'home'\); \}/);
  // la vitrine (pro.js) n'est pas réaffichée après coup en mode édition
  assert.match(pro, /if \(publishEditId\) return;/);
});

test('envoi : la modification passe par PUT sans mode, type ni wilaya ; les photos en ligne gardent leur adresse, seules les nouvelles sont envoyées', () => {
  const fn = app.slice(app.indexOf('async function submitProperty'), app.indexOf('// ── Messagerie'));
  assert.match(fn, /api\('\/properties\/' \+ editing, 'PUT', fields\)/);
  const fields = fn.slice(fn.indexOf('const fields = {'), fn.indexOf('if (editing) {'));
  assert.doesNotMatch(fields, /\bmode\b|type_bien|wilaya/);
  assert.match(fn, /if \(p\.url\) \{ photoUrls\.push\(p\.url\); continue; \}/);
  assert.match(fn, /api\('\/properties', 'POST', body\)/);
  assert.match(fn, /const body = \{ \.\.\.fields, mode, type_bien: type, wilaya,/);
  assert.match(fields, /video_url:\s+val\('pub-video'\)\.trim\(\) \|\| null/);
  assert.match(fields, /tour_url:\s+val\('pub-tour'\)\.trim\(\) \|\| null/);
  assert.match(fields, /floor:\s+val\('pub-floor'\) === '' \? null : Number\(val\('pub-floor'\)\)/);
});

test('aperçu des photos : l\'adresse est échappée (elle vient de la base en mode édition)', () => {
  const fn = app.slice(app.indexOf('function renderPhotoPreviews'), app.indexOf('function removePhoto'));
  assert.match(fn, /<img src="\$\{esc\(p\.preview\)\}"/);
});
