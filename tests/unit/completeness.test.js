// Tests unitaires du score de complétude des annonces.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');

const src = read('app.js');

// Extrait la fonction completenessScore depuis le source de app.js et l'évalue dans un contexte minimal.
const match = src.match(/function completenessScore\(d\)\s*\{[\s\S]*?\n\}/);
assert.ok(match, 'completenessScore introuvable dans app.js');
const fn = new Function('return ' + match[0])();

const full = {
  title:          'Villa de standing avec grande terrasse',     // >= 20 chars
  description:    'Magnifique villa entièrement rénovée en 2023, exposée plein sud, vue dégagée, quartier calme et résidentiel, proche de toutes commodités.',  // >= 100 chars
  photos:         ['/a.jpg', '/b.jpg', '/c.jpg'],               // >= 3
  price:          25000000,
  surface_m2:     200,
  rooms:          5,
  commune:        'Ben Aknoun',
  features:       ['parking', 'piscine', 'jardın'],             // >= 3
  video_url:      'https://www.youtube.com/watch?v=abc',
};

test('annonce complète : score 100', () => {
  assert.equal(fn(full), 100);
});

test('titre court (< 20 chars) : −20', () => {
  assert.equal(fn({ ...full, title: 'Villa' }), 80);
});

test('description courte (< 100 chars) : −20', () => {
  assert.equal(fn({ ...full, description: 'Courte.' }), 80);
});

test('moins de 3 photos : −20', () => {
  assert.equal(fn({ ...full, photos: ['/a.jpg', '/b.jpg'] }), 80);
});

test('photos_count pris en priorité sur photos[]', () => {
  assert.equal(fn({ ...full, photos_count: 2 }), 80);
  assert.equal(fn({ ...full, photos_count: 3 }), 100);
});

test('prix absent : −10', () => {
  assert.equal(fn({ ...full, price: 0 }), 90);
});

test('surface absente : −10', () => {
  assert.equal(fn({ ...full, surface_m2: null }), 90);
});

test('pièces absentes : −5', () => {
  assert.equal(fn({ ...full, rooms: 0 }), 95);
});

test('commune absente : −5', () => {
  assert.equal(fn({ ...full, commune: '' }), 95);
});

test('moins de 3 équipements : −5', () => {
  assert.equal(fn({ ...full, features: ['parking', 'piscine'] }), 95);
});

test('features_count pris en priorité sur features[]', () => {
  assert.equal(fn({ ...full, features_count: 2 }), 95);
  assert.equal(fn({ ...full, features_count: 3 }), 100);
});

test('ni vidéo ni visite : −5', () => {
  assert.equal(fn({ ...full, video_url: null, tour_url: null }), 95);
});

test('tour_url suffit pour +5', () => {
  assert.equal(fn({ ...full, video_url: null, tour_url: 'https://my.matterport.com/show/?m=xyz' }), 100);
});

test('annonce vide : score 0', () => {
  assert.equal(fn({}), 0);
});
