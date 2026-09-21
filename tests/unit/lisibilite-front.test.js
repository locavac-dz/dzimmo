// Lisibilité et langue du front : vert des textes en thème sombre, titre du site et compteur d'annonces traduits, lien « Retour » de la fiche.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read, readFront } = require('../helpers/front');
const { textOf } = require('../../server/seo-text');

const app  = read('app.js');
const css  = read('app.css');
const html = readFront();

// Contraste WCAG entre deux couleurs #rrggbb
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const bloc = re => { const m = css.match(re); assert.ok(m, String(re)); return m[0]; };

test('--primary-text : défini partout, assez contrasté sur les fonds clairs et sombres (AA = 4,5)', () => {
  const clair  = bloc(/:root\[data-theme="light"\] \{[^}]*\}/);
  const sombre = bloc(/:root\[data-theme="dark"\] \{[^}]*\}/);
  const auto   = bloc(/@media \(prefers-color-scheme: dark\) \{[^}]*\{[^}]*\}/);
  const val = b => { const m = b.match(/--primary-text:\s*(#[0-9a-fA-F]{6})/); assert.ok(m, 'valeur manquante'); return m[1]; };
  assert.ok(css.match(/:root \{[^}]*--primary-text:\s*#0C6E4F/), 'défaut (clair)');
  for (const fond of ['#ffffff', '#f8fafc', '#e8f5f0']) assert.ok(contrast(val(clair), fond) >= 4.5, `clair sur ${fond}`);
  for (const b of [sombre, auto]) for (const fond of ['#0f172a', '#1e293b']) assert.ok(contrast(val(b), fond) >= 4.5, `sombre sur ${fond}`);
});

test('aucun texte ne reprend --primary ni #0C6E4F tel quel (le fond des boutons, lui, reste --primary)', () => {
  const texte = /(?<![-\w])color:\s*(var\(--primary\)|#0C6E4F(?![0-9A-Fa-f]))/;
  for (const [nom, src] of [['app.css', css], ['app.js', app], ['index.html', html], ['pro.js', read('pro.js')]])
    assert.doesNotMatch(src, texte, `${nom} : texte vert non éclairci en thème sombre`);
  assert.match(css, /\.btn-primary \{ background: var\(--primary\); color: #fff; \}/);
});

test('titre du site : traduit dans les deux langues, identique à celui du serveur, et repris au changement de langue', () => {
  const t = (lang) => { const m = app.match(new RegExp(`\\n  ${lang}: \\{[\\s\\S]*?\\bsite_title:'([^']+)'`)); assert.ok(m, lang); return m[1]; };
  assert.equal(t('fr'), textOf('fr').homeTitle);
  assert.equal(t('ar'), textOf('ar').homeTitle);
  assert.match(html, new RegExp(`<title>${textOf('fr').homeTitle}</title>`));
  assert.doesNotMatch(app, /DEFAULT_TITLE/);
  assert.match(app, /document\.title = defaultTitle\(\);/);
  assert.match(app, /\[TRANSLATIONS\.fr\.site_title, TRANSLATIONS\.ar\.site_title\]\.includes\(document\.title\)\) document\.title = T\('site_title'\)/);
});

test('compteur d\'annonces de l\'accueil : mot traduit, avec le duel et le pluriel arabes', () => {
  assert.match(app, /countEl\.textContent = resp\.total \+ ' ' \+ unit\(resp\.total, 'st_ad'\);/);
  assert.doesNotMatch(app, /' annonce' \+ \(resp\.total/);
});

test('chaque lien ou bouton « Retour » de la page est traduisible', () => {
  const lignes = html.split('\n').filter(l => /Retour/.test(l) && /<(a|button)\b/.test(l));
  assert.ok(lignes.length >= 10);
  for (const l of lignes) assert.match(l, /data-i18n="(btn_back|mfa_back)"/, l.trim().slice(0, 100));
});

test('champs figés de l\'écran « Modifier » : ils ont l\'air désactivés', () => {
  assert.match(css, /\.form-group select:disabled \{ opacity: \.6; cursor: not-allowed; \}/);
});
