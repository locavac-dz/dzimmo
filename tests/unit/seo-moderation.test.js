// Fonctions pures : URL / slugs (SEO) et détection de changement de contenu (modération).
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const { slugify, propertyPath, landingPath } = require(path.join(ROOT, 'server', 'seo'));
const moderation = require(path.join(ROOT, 'server', 'moderation'));

test('slugify : accents, ponctuation, longueur', () => {
  assert.equal(slugify('Appartement F4 vue mer à Alger'), 'appartement-f4-vue-mer-a-alger');
  assert.equal(slugify("M'Sila"), 'm-sila');
  assert.equal(slugify('  --Villa   Béjaïa!!  '), 'villa-bejaia');
  assert.equal(slugify('فيلا'), '');
  const long = slugify('a'.repeat(200));
  assert.ok(long.length <= 60 && !long.endsWith('-'));
});

test('propertyPath : id + slug, repli sur type-mode-wilaya pour un titre non latin', () => {
  assert.equal(propertyPath({ id: 12, title: 'Villa avec piscine à Oran' }), '/annonce/12-villa-avec-piscine-a-oran');
  assert.equal(propertyPath({ id: 5, title: 'فيلا', type_bien: 'villa', mode: 'vente', wilaya: 'Oran' }),
    '/annonce/5-villa-vente-oran');
});

test('landingPath : ordre canonique mode / type / wilaya', () => {
  assert.equal(landingPath({ mode: 'vente' }), '/vente');
  assert.equal(landingPath({ mode: 'location_longue', wilaya: 'Alger' }), '/location/alger');
  assert.equal(landingPath({ mode: 'vente', type: 'appartement', wilaya: 'Sidi Bel Abbès' }),
    '/vente/appartements/sidi-bel-abbes');
  assert.equal(landingPath({ mode: 'location_courte', type: 'villa' }), '/location-saisonniere/villas');
});

test('contentChanged : seuls titre, description et photos déclenchent une nouvelle modération', () => {
  const p = { title: 'Titre', description: 'Desc', image: 'a.jpg', photos: ['a.jpg'], price: 100 };
  assert.equal(moderation.contentChanged(p, {}), false);
  assert.equal(moderation.contentChanged(p, { price: 200 }), false, 'le prix ne relance pas la modération');
  assert.equal(moderation.contentChanged(p, { title: 'Titre' }), false, 'valeur identique');
  assert.equal(moderation.contentChanged(p, { title: 'Autre' }), true);
  assert.equal(moderation.contentChanged(p, { description: 'Nouvelle' }), true);
  assert.equal(moderation.contentChanged(p, { image: 'b.jpg' }), true);
  assert.equal(moderation.contentChanged(p, { photos: JSON.stringify(['a.jpg']) }), false, 'mêmes photos');
  assert.equal(moderation.contentChanged(p, { photos: JSON.stringify(['a.jpg', 'b.jpg']) }), true);
});

test('les statuts non publics sont bien pending et rejected', () => {
  assert.deepEqual([...moderation.HIDDEN_STATUSES].sort(), ['pending', 'rejected']);
});
