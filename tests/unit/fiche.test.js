// Fiche imprimable : libellés d'équipements identiques à ceux du site, textes FR et AR complets, QR sans service tiers, images validées.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');
const fiche = require('../../server/fiche');

const app = read('app.js');
const css = read('fiche.css');
const ARABIC = /[؀-ۿ]/;

// Libellés feat_* du site : la première occurrence est le français, la seconde l'arabe
const labelsOf = lang => {
  const seen = {};
  for (const m of app.matchAll(/\bfeat_(\w+):\s*'((?:\\.|[^'\\])*)'/g)) (seen[m[1]] ||= []).push(m[2]);
  return Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v[lang === 'fr' ? 0 : 1]]));
};

test('équipements : mêmes libellés que le site, en français et en arabe', () => {
  const fr = labelsOf('fr'), ar = labelsOf('ar');
  assert.ok(Object.keys(fiche.FEATURES.fr).length >= 19);
  for (const [k, label] of Object.entries(fiche.FEATURES.fr)) assert.equal(label, fr[k], `fr ${k}`);
  for (const [k, label] of Object.entries(fiche.FEATURES.ar)) { assert.equal(label, ar[k], `ar ${k}`); assert.match(label, ARABIC); }
  assert.deepEqual(Object.keys(fiche.FEATURES.ar), Object.keys(fiche.FEATURES.fr));
});

test('qrSvg : un SVG autonome, sans image ni adresse externe', () => {
  const svg = fiche.qrSvg('https://dzimmo.test/annonce/12-villa');
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.doesNotMatch(svg, /<image|href=|<script|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
  assert.notEqual(svg, fiche.qrSvg('https://dzimmo.test/annonce/13-villa'), 'le contenu dépend de l\'adresse');
});

test('photoSrc : miniature du .webp du site, autres fichiers du site inchangés, tout le reste refusé', () => {
  assert.equal(fiche.photoSrc('/uploads/a-1.webp'), '/uploads/thumbs/960/a-1.webp');
  assert.equal(fiche.photoSrc('/uploads/a-1.jpg'), '/uploads/a-1.jpg');
  assert.equal(fiche.photoSrc('https://images.unsplash.com/photo-1'), 'https://images.unsplash.com/photo-1');
  for (const bad of ['javascript:alert(1)', 'https://evil.example/x.png', '/uploads/../secret.webp', '" onerror="x', '', null, 42])
    assert.equal(fiche.photoSrc(bad), null, String(bad));
});

test('render : au plus 4 photos, description bornée, langue inconnue = français', () => {
  const p = { id: 5, title: 'Titre', description: 'x'.repeat(5000), mode: 'vente', type_bien: 'villa', price: 1000000, wilaya: 'Oran',
    image: '/uploads/1.webp', photos: ['/uploads/1.webp', '/uploads/2.webp', '/uploads/3.webp', '/uploads/4.webp', '/uploads/5.webp', '/uploads/6.webp'], features: [] };
  const html = fiche.render(p, { lang: 'xx', pageUrl: 'https://dzimmo.test/annonce/5-titre', backPath: '/annonce/5-titre' });
  assert.equal((html.match(/<img /g) || []).length, fiche.MAX_PHOTOS);
  assert.match(html, /<html lang="fr" dir="ltr">/);
  const desc = html.match(/<p class="desc">([^<]*)<\/p>/)[1];
  assert.ok(desc.length <= fiche.MAX_DESCRIPTION);
  assert.match(desc, /…$/);
});

test('textes : le français et l\'arabe ont les mêmes entrées, l\'arabe est en arabe', () => {
  const p = { id: 1, title: 'T', mode: 'location_longue', type_bien: 'appartement', price: 50000, wilaya: 'Alger', status: 'rented',
    surface_m2: 80, rooms: 3, baths: 1, floor: 4, total_floors: 8, features: ['wifi'], photos: [] };
  const ctx = { pageUrl: 'https://dzimmo.test/annonce/1-t', backPath: '/annonce/1-t' };
  const fr = fiche.render(p, { ...ctx, lang: 'fr' }), ar = fiche.render(p, { ...ctx, lang: 'ar' });
  assert.match(fr, /Loué/); assert.match(fr, /Étage 4 sur 8/); assert.match(fr, /1 salle de bain/); assert.match(fr, /Wi-Fi/);
  assert.match(ar, /مؤجَّر/); assert.match(ar, /الطابق 4 من 8/); assert.match(ar, /حمّام واحد/); assert.match(ar, /واي فاي/);
  assert.match(ar, /الوصف|التجهيزات|الاتصال/);
});

test('front : bouton « Imprimer la fiche » traduit en français et en arabe ; CSS de la fiche sans style en ligne, imprimable', () => {
  const all = [...app.matchAll(/\bdet_print:\s*'((?:\\.|[^'\\])*)'/g)].map(m => m[1]);
  assert.equal(all.length, 2);
  assert.match(all[1], ARABIC);
  assert.match(css, /@media print/);
  assert.match(css, /@page \{[^}]*A4/);
  assert.match(css, /\.toolbar \{ display: none; \}/, 'la barre d\'outils ne s\'imprime pas');
  assert.match(read('app.css'), /\.print-link \{/);
});
