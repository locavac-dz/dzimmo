// Écran « Modifier mon annonce » : ce que la route PUT /api/properties/:id accepte (commune, adresse, étage, vidéo, visite),
// ce qu'elle refuse (nombres absurdes, titre vide) et ce qui repasse en modération.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const { AR } = require('../../server/i18n');

let s, owner, other, admin, n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);
const put = (id, body, user = owner, headers) => s.request('PUT', `/api/properties/${id}`, { token: user.token, body, headers });
const row = async id => (await q('SELECT * FROM properties WHERE id = $1', [id])).rows[0];

// Annonce publiée (active) avec quelques valeurs de départ
async function listing(over = {}) {
  const r = await s.request('POST', '/api/properties', { token: owner.token, body: {
    title: 'Annonce à modifier ' + ++n, mode: 'vente', type_bien: 'appartement', price: 9000000, wilaya: 'Oran',
    surface_m2: 80, rooms: 3, baths: 1, floor: 2, commune: 'Bir El Djir', address: 'Rue 1', description: 'Texte de départ', ...over } });
  assert.equal(r.status, 201);
  await q(`UPDATE properties SET status = 'active', published_at = now() WHERE id = $1`, [r.body.id]);
  return r.body.id;
}

test.before(async () => {
  s = await startServer();
  owner = await s.register('mod-owner');
  other = await s.register('mod-autre');
  admin = await s.makeAdmin(await s.register('mod-admin'));
});
test.after(async () => { await s.stop(); });

test('commune, adresse et étage se modifient ; l\'étage 0 (rez-de-chaussée) est gardé, vider un champ le remet à vide', async () => {
  const id = await listing();
  const r = await put(id, { commune: '  Es Senia ', address: 'Boulevard 5 Juillet', floor: 0 });
  assert.equal(r.status, 200);
  let p = await row(id);
  assert.equal(p.commune, 'Es Senia'); assert.equal(p.address, 'Boulevard 5 Juillet'); assert.equal(p.floor, 0);
  assert.equal((await put(id, { commune: '', address: null, floor: null })).status, 200);
  p = await row(id);
  assert.equal(p.commune, null); assert.equal(p.address, null); assert.equal(p.floor, null);
});

test('surface, pièces et salles de bain vides deviennent NULL (jamais 0), les valeurs valides sont écrites', async () => {
  const id = await listing();
  assert.equal((await put(id, { surface_m2: null, rooms: '', baths: 0 })).status, 200);
  let p = await row(id);
  assert.equal(p.surface_m2, null); assert.equal(p.rooms, null); assert.equal(p.baths, null);
  assert.equal((await put(id, { surface_m2: 95, rooms: 4, baths: 2 })).status, 200);
  p = await row(id);
  assert.equal(Number(p.surface_m2), 95); assert.equal(p.rooms, 4); assert.equal(p.baths, 2);
});

test('valeurs absurdes : 400 avec message français et arabe, et rien n\'est modifié', async () => {
  const id = await listing();
  const before = await row(id);
  const cases = [
    [{ price: 0 }, 'Prix invalide.'], [{ price: -5 }, 'Prix invalide.'], [{ price: 'abc' }, 'Prix invalide.'], [{ price: null }, 'Prix invalide.'],
    [{ title: '   ' }, 'Titre invalide.'], [{ title: null }, 'Titre invalide.'], [{ title: 42 }, 'Titre invalide.'],
    [{ surface_m2: 'grand' }, 'Valeur numérique invalide.'], [{ rooms: -1 }, 'Valeur numérique invalide.'], [{ floor: 'x' }, 'Valeur numérique invalide.'],
  ];
  for (const [body, msg] of cases) {
    const r = await put(id, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, msg, JSON.stringify(body));
    assert.ok(AR[msg], `traduction arabe de « ${msg} »`);
    const ar = await put(id, body, owner, { 'X-Lang': 'ar' });
    assert.equal(ar.body.error, AR[msg]);
  }
  const after = await row(id);
  for (const k of ['title', 'price', 'surface_m2', 'rooms', 'baths', 'floor', 'commune']) assert.equal(String(after[k]), String(before[k]), k);
});

test('le mode, le type de bien et la wilaya ne changent pas par cette route', async () => {
  const id = await listing();
  const r = await put(id, { mode: 'location_longue', type_bien: 'villa', wilaya: 'Alger', title: 'Nouveau titre valide' });
  assert.equal(r.status, 200);
  const p = await row(id);
  assert.equal(p.mode, 'vente'); assert.equal(p.type_bien, 'appartement'); assert.equal(p.wilaya, 'Oran');
});

test('vidéo et visite : ajout, remplacement et retrait depuis l\'écran de modification', async () => {
  const id = await listing();
  assert.equal((await put(id, { video_url: 'https://youtu.be/dQw4w9WgXcQ', tour_url: 'https://kuula.co/post/7Tk4N' })).status, 200);
  let p = await row(id);
  assert.equal(p.video_url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'); assert.equal(p.tour_url, 'https://kuula.co/share/7Tk4N');
  assert.equal((await put(id, { video_url: null, tour_url: '' })).status, 200);
  p = await row(id);
  assert.equal(p.video_url, null); assert.equal(p.tour_url, null);
  assert.equal((await put(id, { video_url: 'https://exemple.com/video' })).status, 400);
});

test('modération : commune, adresse et étage ne remettent pas l\'annonce en validation ; un nouveau lien vidéo, si', async () => {
  const id = await listing();
  const r1 = await put(id, { commune: 'Autre commune', floor: 5, price: 9500000 });
  assert.equal(r1.body.status, 'active');
  const r2 = await put(id, { video_url: 'https://vimeo.com/123456789' });
  assert.equal(r2.body.status, 'pending');
  assert.equal((await row(id)).status, 'pending');
});

test('une annonce refusée qu\'on corrige repart en validation', async () => {
  const id = await listing();
  await q(`UPDATE properties SET status = 'rejected', moderation_reason = 'photos' WHERE id = $1`, [id]);
  const r = await put(id, { description: 'Description corrigée après le refus' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending');
});

test('droits : un autre membre reçoit 403, un administrateur peut modifier, un id inconnu donne 404', async () => {
  const id = await listing();
  assert.equal((await put(id, { commune: 'X' }, other)).status, 403);
  assert.equal((await put(id, { commune: 'Y' }, admin)).status, 200);
  assert.equal((await put(999999, { commune: 'Z' })).status, 404);
  assert.equal((await s.request('PUT', `/api/properties/${id}`, { body: { commune: 'W' } })).status, 401);
});

test('la liste du tableau de bord renvoie toutes les colonnes que l\'écran de modification remplit', async () => {
  const id = await listing({ features: ['parking'], video_url: 'https://vimeo.com/123456789' });
  const list = await s.request('GET', `/api/properties/user/${owner.id}?limit=100`, { token: owner.token });
  const p = list.body.find(x => x.id === id);
  assert.ok(p);
  for (const k of ['title', 'mode', 'type_bien', 'wilaya', 'price', 'surface_m2', 'rooms', 'baths', 'floor', 'commune', 'address', 'description',
                   'features', 'photos', 'image', 'video_url', 'tour_url']) assert.ok(k in p, k);
  assert.ok(Array.isArray(p.features) && p.features.includes('parking'));
  assert.ok(Array.isArray(p.photos));
});
