// Recherche sur la carte : zone dessinée (POST /api/properties/zone) et autour d'un point (GET /api/properties/nearby).
// Les annonces sont créées ici, dans des coins du globe sans annonce de démonstration : rien ne dépend des données du seed.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const geo = require('../../server/geo');

let s, owner;
const q = (sql, p) => s.db.pool.query(sql, p);

// Une annonce minimale à une position donnée ; renvoie son id
async function listing(lat, lng, over = {}) {
  const p = { title: 'Bien de la carte', mode: 'vente', type_bien: 'appartement', wilaya: 'Wilaya-Carte', status: 'active', ...over };
  return (await q(`INSERT INTO properties (owner_id, title, mode, type_bien, price, surface_m2, rooms, wilaya, status, lat, lng)
                   VALUES ($1,$2,$3,$4,1000000,50,2,$5,$6,$7,$8) RETURNING id`,
    [owner.id, p.title, p.mode, p.type_bien, p.wilaya, p.status, lat, lng])).rows[0].id;
}
const zone = body => s.request('POST', '/api/properties/zone', { body });
const ids  = r => r.body.data.map(p => p.id).sort((a, b) => a - b);
const asc  = list => [...list].sort((a, b) => a - b);

// Un carré de 0,2° de côté autour de (10, 10) ; un polygone en L dont l'angle nord-est (lat > 10, lng > 10) est vide
const SQUARE  = [[9.9, 9.9], [9.9, 10.1], [10.1, 10.1], [10.1, 9.9]];
const L_SHAPE = [[9.0, 9.0], [9.0, 11.0], [10.0, 11.0], [10.0, 10.0], [11.0, 10.0], [11.0, 9.0]];

test.before(async () => {
  s = await startServer();
  owner = await s.register('cartographe');
});
test.after(async () => { await s.stop(); });

test('zone : les annonces dans le polygone sont renvoyées, celles à l\'extérieur non', async () => {
  const inside  = await listing(10.0, 10.0);
  const edge    = await listing(10.05, 9.95);
  const outside = await listing(10.3, 10.0);
  const far     = await listing(-20, 50);
  const r = await zone({ polygon: SQUARE });
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r), asc([inside, edge]));
  assert.ok(!ids(r).includes(outside) && !ids(r).includes(far));
  assert.equal(r.body.total, 2);
  assert.equal(r.body.truncated, false);
});

test('zone : un polygone concave (en L) exclut l\'encoche', async () => {
  const west  = await listing(9.5, 9.5);
  const east  = await listing(9.5, 10.6);
  const north = await listing(10.6, 9.5);
  const notch = await listing(10.5, 10.5);
  const r = await zone({ polygon: L_SHAPE });
  assert.equal(r.status, 200);
  for (const id of [west, east, north]) assert.ok(ids(r).includes(id), `annonce ${id} dans le L`);
  assert.ok(!ids(r).includes(notch), 'l\'encoche est hors zone');
});

test('zone : sommet de fermeture répété, sens horaire ou anti-horaire : même résultat', async () => {
  const a = await zone({ polygon: SQUARE });
  const b = await zone({ polygon: [...SQUARE, SQUARE[0]] });
  const c = await zone({ polygon: [...SQUARE].reverse() });
  assert.ok(ids(a).length > 0);
  assert.deepEqual(ids(b), ids(a));
  assert.deepEqual(ids(c), ids(a));
});

test('zone : annonces non publiées ou sans position exclues', async () => {
  const pending = await listing(10.01, 10.01, { status: 'pending' });
  const sold    = await listing(10.02, 10.02, { status: 'sold' });
  const nopos   = (await q(`INSERT INTO properties (owner_id, title, mode, type_bien, price, surface_m2, rooms, wilaya, status)
                            VALUES ($1,'Sans position','vente','appartement',1000000,50,2,'Wilaya-Carte','active') RETURNING id`, [owner.id])).rows[0].id;
  const r = await zone({ polygon: SQUARE });
  for (const id of [pending, sold, nopos]) assert.ok(!ids(r).includes(id), `annonce ${id} exclue`);
});

test('zone : filtres mode, type de bien et wilaya ; une valeur inconnue est ignorée', async () => {
  const loc  = await listing(10.03, 10.03, { mode: 'location_longue', type_bien: 'villa', wilaya: 'Autre-Wilaya' });
  const rent = await zone({ polygon: SQUARE, mode: 'location_longue' });
  assert.ok(ids(rent).includes(loc));
  assert.ok(rent.body.data.every(p => p.mode === 'location_longue'));
  const villa = await zone({ polygon: SQUARE, type_bien: 'villa' });
  assert.ok(villa.body.data.length > 0 && villa.body.data.every(p => p.type_bien === 'villa'));
  const wil = await zone({ polygon: SQUARE, wilaya: 'Autre-Wilaya' });
  assert.deepEqual(ids(wil), [loc]);
  const bogus = await zone({ polygon: SQUARE, mode: 'nimporte', type_bien: ['x'] });
  assert.equal(bogus.status, 200);
  assert.ok(ids(bogus).includes(loc), 'filtre inconnu ignoré, pas d\'erreur');
});

test('zone : polygone invalide, trop grand, sans surface ou corps absent → 400 « Zone invalide. »', async () => {
  const bads = [
    undefined, null, 'zone', [], [[10, 10]], [[10, 10], [10, 11]],
    [[10, 10], [10, 11], [11, 11], ['a', 1]],
    [[10, 10], [10, 11], [95, 11]],
    [[10, 10], [10, 11], [11, 190]],
    [[10, 10], [10, 11], [10, 12]],
    [[10, 10], [10, 10], [10, 10]],
    Array.from({ length: 70 }, (_, i) => [10 + Math.sin(i) / 10, 10 + Math.cos(i) / 10]),
  ];
  for (const polygon of bads) {
    const r = await zone({ polygon });
    assert.equal(r.status, 400, String(JSON.stringify(polygon)).slice(0, 60));
    assert.equal(r.body.error, 'Zone invalide.');
  }
  const none = await s.request('POST', '/api/properties/zone');
  assert.equal(none.status, 400);
});

test('zone : le message d\'erreur est traduit en arabe', async () => {
  const r = await s.request('POST', '/api/properties/zone', { body: { polygon: [] }, headers: { 'X-Lang': 'ar' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /[؀-ۿ]/);
});

test('zone : bornée à 100 annonces, « truncated » prévient quand il y en a davantage', async () => {
  for (let i = 0; i < 105; i++) await listing(-30 + (i % 10) * 0.001, -60 + Math.floor(i / 10) * 0.001);
  const r = await zone({ polygon: [[-30.5, -60.5], [-30.5, -59.5], [-29.5, -59.5], [-29.5, -60.5]] });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 100);
  assert.equal(r.body.total, 100);
  assert.equal(r.body.truncated, true);
});

test('zone : ni email ni empreinte de mot de passe dans la réponse', async () => {
  const r = await zone({ polygon: SQUARE });
  assert.ok(r.body.data.length > 0);
  assert.ok(!JSON.stringify(r.body).includes(owner.email), 'email absent');
  assert.ok(!('password_hash' in r.body.data[0]));
});

test('nearby : filtres mode, type et wilaya, tri par distance', async () => {
  const near = await listing(20.0, 20.0, { wilaya: 'Wilaya-Proche' });
  const mid  = await listing(20.02, 20.0, { wilaya: 'Wilaya-Proche', mode: 'location_courte', type_bien: 'villa' });
  const off  = await listing(20.5, 20.0, { wilaya: 'Wilaya-Proche' });
  const all = await s.request('GET', '/api/properties/nearby?lat=20&lng=20&radius=5');
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.data.map(p => p.id), [near, mid], 'le plus proche d\'abord');
  assert.ok(!ids(all).includes(off));
  assert.equal(all.body.truncated, false);
  const f = await s.request('GET', '/api/properties/nearby?lat=20&lng=20&radius=5&mode=location_courte');
  assert.deepEqual(ids(f), [mid]);
  const t = await s.request('GET', '/api/properties/nearby?lat=20&lng=20&radius=5&type_bien=villa&wilaya=Wilaya-Proche');
  assert.deepEqual(ids(t), [mid]);
  const w = await s.request('GET', '/api/properties/nearby?lat=20&lng=20&radius=5&wilaya=Nulle-Part');
  assert.deepEqual(ids(w), []);
});

test('nearby : au-delà de 100 annonces dans le rayon, la réponse est tronquée', async () => {
  for (let i = 0; i < 101; i++) await listing(40 + (i % 10) * 0.0005, 40 + Math.floor(i / 10) * 0.0005, { wilaya: 'Wilaya-Dense' });
  const r = await s.request('GET', '/api/properties/nearby?lat=40&lng=40&radius=5&wilaya=Wilaya-Dense');
  assert.equal(r.body.data.length, 100);
  assert.equal(r.body.truncated, true);
});

test('server/geo : cleanPolygon fusionne les doublons, circleBox couvre le cercle', () => {
  const p = geo.cleanPolygon([[1, 1], [1, 1], [1, 2], [2, 2], [2, 1], [1, 1]]);
  assert.deepEqual(p.lats, [1, 1, 2, 2]);
  assert.deepEqual(p.lngs, [1, 2, 2, 1]);
  assert.deepEqual(p.box, { minLat: 1, maxLat: 2, minLng: 1, maxLng: 2 });
  assert.equal(geo.cleanPolygon([[1, 1], [2, 2]]), null);
  const b = geo.circleBox(36.75, 3.06, 10);
  assert.ok(b.minLat < 36.75 - 10 / 111.32 && b.maxLat > 36.75 + 10 / 111.32);
  assert.ok(b.minLng < 3.06 && b.maxLng > 3.06);
  const pole = geo.circleBox(89.99, 0, 10);
  assert.ok(pole.maxLng - pole.minLng >= 360, 'près du pôle, la longitude n\'est plus restreinte');
});

// « Autour de moi » : la position du navigateur ne marche que si aucun en-tête du site ne l'interdit (le HTTPS, lui, vient de Nginx, voir DEPLOIEMENT.md § 4)
test('« Autour de moi » : aucune politique du serveur n\'interdit la géolocalisation, page d\'accueil comme carte', async () => {
  for (const path of ['/', '/carte', '/ar/carte']) {
    const r = await fetch(s.base + path, { redirect: 'manual' });
    const policy = [r.headers.get('permissions-policy'), r.headers.get('feature-policy')].filter(Boolean).join(' ');
    assert.doesNotMatch(policy, /geolocation\s*=\s*\(\s*\)|geolocation\s+'none'/i, `${path} : ${policy}`);
  }
});
