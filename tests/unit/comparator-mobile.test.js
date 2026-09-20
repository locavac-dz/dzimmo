// Comparateur de biens sur mobile : barre compacte, cohabitation avec la barre d'appel de la fiche, tableau lisible.
// Le code testé est celui de public/index.html, extrait et exécuté tel quel (aucun navigateur nécessaire).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
const fn = name => html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

// Bloc @media mobile propre au comparateur (repérable à son commentaire)
const mobileCss = html.match(/\/\* Comparateur sur mobile[\s\S]*?@media \(max-width: 768px\) \{([\s\S]*?)\n    \}\n/)[1];

test('barre : les miniatures perdent leur titre sur mobile (tuile de taille fixe, pastille grise sans photo)', () => {
  assert.match(mobileCss, /#compare-bar \.cmp-thumb span \{ display: none; \}/);
  assert.match(mobileCss, /#compare-bar \.cmp-thumb \{[^}]*width: 46px; height: 38px;[^}]*background: var\(--border\)/, 'taille fixe : visible même sans photo');
  assert.match(mobileCss, /#compare-bar \.cmp-thumb img \{ width: 100%; height: 100%;/);
  assert.match(mobileCss, /#compare-bar \{\s*flex-wrap: wrap;/, 'passe à la ligne plutôt que de déborder sur un écran étroit');
  assert.match(mobileCss, /#compare-thumbs \{ flex: 0 1 auto; flex-wrap: nowrap;/);
});

test('barre : le style de #compare-thumbs est une règle CSS (un style en ligne empêcherait de l\'adapter au mobile)', () => {
  assert.doesNotMatch(html, /<div id="compare-thumbs" style=/);
  assert.match(html, /#compare-thumbs \{ display: flex; gap: \.5rem; flex: 1; flex-wrap: wrap; \}/);
});

test('barre : le bouton « retirer » d\'une miniature est assez grand pour un doigt et suit le sens d\'écriture', () => {
  const rm = mobileCss.match(/#compare-bar \.cmp-rm \{([^}]*)\}/)[1];
  assert.match(rm, /width: 24px; height: 24px/);
  assert.match(rm, /inset-inline-end: -9px/, 'coin correct en arabe aussi');
  assert.match(mobileCss, /\.card-cmp, \.card-fav \{ width: 38px; height: 38px; \}/, 'boutons de comparaison et de favori des cartes');
});

test('fiche : la barre du comparateur se pose au-dessus de la barre d\'appel (même variable de hauteur)', () => {
  assert.match(html, /--qc-h: 72px;/);
  assert.match(html, /\.quick-contact \{\s*position: fixed;[^}]*min-height: calc\(var\(--qc-h\) \+ env\(safe-area-inset-bottom, 0px\)\);/, 'la barre d\'appel a au moins cette hauteur');
  assert.match(mobileCss, /body\.qc-on #compare-bar \{ bottom: calc\(var\(--qc-h\) \+ env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(mobileCss, /body\.cmp-on \{ padding-bottom: 4\.5rem; \}/, 'bas des pages dégagé');
  assert.match(mobileCss, /body\.qc-on\.cmp-on \{ padding-bottom: calc\(4\.5rem \+ var\(--qc-h\)\); \}/, 'et les deux barres ensemble');
  // z-index : la barre d'appel (801) ne recouvre plus le comparateur, qui est décalé au-dessus d'elle
  assert.match(html, /#compare-bar \{\s*position: fixed; bottom: 0;/);
});

test('tableau : colonne des critères collée à l\'écran pendant le défilement, alignée selon la langue', () => {
  assert.match(html, /#compare-modal td:first-child \{ text-align: start;/, 'plus « left » en dur (faux en arabe)');
  assert.doesNotMatch(html, /#compare-modal td:first-child \{ text-align: left/);
  assert.match(mobileCss, /#compare-modal th:first-child, #compare-modal td:first-child \{\s*position: sticky; inset-inline-start: 0;/);
  assert.match(mobileCss, /#compare-modal td:first-child \{ background: var\(--white\); \}/, 'fond opaque : le texte défilant ne se voit pas derrière');
  assert.match(mobileCss, /#compare-modal th:not\(:first-child\), #compare-modal td:not\(:first-child\) \{ min-width: 118px; \}/);
});

// Contexte : faux DOM minimal pour updateCompareBar
function bar(list) {
  const cls = new Set(), barCls = new Set();
  const els = { 'compare-bar': { classList: { add: c => barCls.add(c), remove: c => barCls.delete(c) } }, 'compare-thumbs': { innerHTML: '' } };
  const body = { classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), add: c => cls.add(c), remove: c => cls.delete(c) } };
  const ctx = { _compareList: list, document: { body, getElementById: id => els[id] }, T: k => ({ cmp_remove: 'Retirer' })[k] || k,
    esc: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') };
  vm.createContext(ctx);
  vm.runInContext(fn('updateCompareBar'), ctx);
  return { ctx, cls, barCls, els };
}

test('updateCompareBar : la page reçoit « cmp-on » tant qu\'un bien est comparé', () => {
  const { ctx, cls, barCls } = bar([]);
  ctx.updateCompareBar();
  assert.equal(cls.has('cmp-on'), false);
  assert.equal(barCls.has('visible'), false);
  ctx._compareList.push({ id: 1, title: 'Villa', image: '/a.jpg' });
  ctx.updateCompareBar();
  assert.equal(cls.has('cmp-on'), true);
  assert.equal(barCls.has('visible'), true);
  ctx._compareList.length = 0;
  ctx.updateCompareBar();
  assert.equal(cls.has('cmp-on'), false, 'retiré quand la liste est vidée');
  assert.equal(barCls.has('visible'), false);
});

test('updateCompareBar : titre en infobulle et dans l\'étiquette du bouton, échappé', () => {
  const { ctx, els } = bar([{ id: 7, title: 'Villa "F5" <b>x</b>', image: '' }]);
  ctx.updateCompareBar();
  const h = els['compare-thumbs'].innerHTML;
  assert.match(h, /<div class="cmp-thumb" title="Villa &quot;F5&quot; &lt;b>x&lt;\/b>">/);
  assert.match(h, /aria-label="Retirer : Villa &quot;F5&quot; &lt;b>x&lt;\/b>"/);
  assert.doesNotMatch(h, /<b>x<\/b>/, 'aucun HTML injecté par un titre d\'annonce');
  assert.match(h, /onclick="toggleCompare\(7\)"/);
});

test('barre d\'appel : la classe « qc-on » suit la fiche affichée', () => {
  assert.match(html, /container\.classList\.toggle\('has-qc', !!container\.querySelector\('\.quick-contact'\)\);\s*document\.body\.classList\.toggle\('qc-on', !!container\.querySelector\('\.quick-contact'\)\);/,
    'posée par la fiche seulement s\'il y a une barre d\'appel');
  assert.match(html, /function showPage\(page, data = null\) \{\s*(?:toggleMenu\(false\);\s*)?document\.body\.classList\.remove\('qc-on'\);/, 'retirée dès qu\'on change de page');
});
