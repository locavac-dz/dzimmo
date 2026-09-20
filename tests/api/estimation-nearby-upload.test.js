// Routes restées sans test : estimation du prix au m² (GET /api/properties/estimation), annonces proches d'un point
// (GET /api/properties/nearby) et envoi de plusieurs photos (POST /api/upload/multiple).
// Les données sont créées ici, dans des wilayas de test : rien ne dépend des annonces de démonstration.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const sharp  = require('sharp');
const { startServer, ROOT } = require('../helpers/server');

let s, owner;
const UPLOADS = path.join(ROOT, 'public', 'uploads');
const made = [];
const q   = (sql, p) => s.db.pool.query(sql, p);
const get = url => s.request('GET', url);

// Une annonce minimale ; renvoie son id
async function listing(over = {}) {
  const p = { title: 'Bien de test', mode: 'vente', type_bien: 'appartement', price: 10000000, surface_m2: 100, rooms: 3,
              wilaya: 'Wilaya-Test', status: 'active', lat: null, lng: null, ...over };
  return (await q(`INSERT INTO properties (owner_id, title, mode, type_bien, price, surface_m2, rooms, wilaya, status, lat, lng)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [owner.id, p.title, p.mode, p.type_bien, p.price, p.surface_m2, p.rooms, p.wilaya, p.status, p.lat, p.lng])).rows[0].id;
}

test.before(async () => {
  s = await startServer();
  owner = await s.register('bailleur');
});
test.after(async () => {
  for (const f of made) fs.rmSync(f, { force: true });
  await s.stop();
});

test('estimation : moyenne et quartiles du prix au m² de la wilaya, annonces non publiées ou aberrantes exclues', async () => {
  for (const price of [8000000, 10000000, 12000000, 14000000]) await listing({ price });            // 80 000 à 140 000 DZD/m²
  await listing({ price: 90000000, status: 'pending' });                                            // non publiée
  await listing({ price: 90000000, surface_m2: 3 });                                                // surface absurde
  await listing({ price: 60000, mode: 'location_longue' });                                         // un loyer n'entre pas dans les ventes
  const r = await get('/api/properties/estimation?mode=vente&type_bien=appartement&wilaya=Wilaya-Test');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { count: 4, avg_pm2: 110000, p25_pm2: 95000, p75_pm2: 125000, scope: 'wilaya' });
  const rent = (await get('/api/properties/estimation?mode=location_longue&wilaya=Wilaya-Test')).body;
  assert.equal(rent.scope, 'national', 'une seule annonce dans la wilaya : repli national');
  assert.ok(rent.count >= 1);
});

test('estimation : filtre par nombre de pièces (6 = « 6 et plus »), wilaya sans donnée → repli national', async () => {
  await listing({ wilaya: 'Wilaya-Pieces', rooms: 6, price: 20000000 });
  await listing({ wilaya: 'Wilaya-Pieces', rooms: 8, price: 30000000 });
  await listing({ wilaya: 'Wilaya-Pieces', rooms: 2, price: 5000000 });
  const big = (await get('/api/properties/estimation?mode=vente&wilaya=Wilaya-Pieces&rooms=6')).body;
  assert.deepEqual([big.count, big.avg_pm2, big.scope], [2, 250000, 'wilaya']);
  const none = (await get('/api/properties/estimation?mode=vente&wilaya=Wilaya-Inconnue')).body;
  assert.equal(none.scope, 'national');
  assert.ok(none.count >= 7);
  const empty = (await get('/api/properties/estimation?mode=location_courte&type_bien=entrepot&rooms=5&wilaya=Wilaya-Inconnue')).body;
  assert.deepEqual(empty, { count: 0, avg_pm2: null, p25_pm2: null, p75_pm2: null, scope: 'national' });
});

test('estimation : mode absent ou inconnu refusé (on ne mélange pas loyers et prix de vente), paramètres absurdes sans erreur 500', async () => {
  for (const qs of ['', '?mode=', '?mode=troc', '?mode=vente&mode=location_longue', '?wilaya=Wilaya-Test']) {
    const r = await get('/api/properties/estimation' + qs);
    assert.equal(r.status, 400, qs);
    assert.equal(r.body.error, 'mode_required');
  }
  const ar = await s.request('GET', '/api/properties/estimation', { headers: { 'X-Lang': 'ar' } });
  assert.match(ar.body.error, /[؀-ۿ]/);
  for (const qs of ['&rooms=abc', '&rooms=-4', '&rooms=99999999999999999999', '&type_bien=chateau', '&wilaya=a&wilaya=b', "&wilaya=' OR 1=1 --", '&type_bien[]=villa'])
    assert.equal((await get('/api/properties/estimation?mode=vente' + qs)).status, 200, qs);
});

test('nearby : annonces publiées dans le rayon, triées par distance, avec leur distance', async () => {
  // Trois points autour de (30.0, 3.0), loin de toute annonce de démonstration : ~1,1 km, ~5,6 km, ~33 km
  const near = await listing({ title: 'Tout près',  lat: 30.01, lng: 3.0 });
  const mid  = await listing({ title: 'Assez près', lat: 30.05, lng: 3.0 });
  const far  = await listing({ title: 'Loin',       lat: 30.30, lng: 3.0 });
  const hidden = await listing({ title: 'En attente', lat: 30.001, lng: 3.0, status: 'pending' });
  await listing({ title: 'Sans position' });

  const r = await get('/api/properties/nearby?lat=30&lng=3&radius=10');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.map(p => p.id), [near, mid]);
  assert.equal(r.body.total, 2);
  assert.deepEqual([r.body.radius, r.body.lat, r.body.lng], [10, 30, 3]);
  const km = r.body.data.map(p => Number(p.distance_km));
  assert.ok(km[0] > 1 && km[0] < 1.2 && km[1] > 5.4 && km[1] < 5.7, 'distances : ' + km);
  assert.equal(r.body.data[0].owner_name, 'Test bailleur');
  assert.equal('owner_email' in r.body.data[0] || 'email' in r.body.data[0], false, 'pas d\'adresse email du propriétaire');

  const wide = (await get('/api/properties/nearby?lat=30&lng=3&radius=50')).body.data.map(p => p.id);
  assert.deepEqual(wide, [near, mid, far]);
  assert.equal(wide.includes(hidden), false, 'une annonce en attente n\'apparaît jamais');
  const same = (await get('/api/properties/nearby?lat=30.01&lng=3')).body;
  assert.equal(same.radius, 5, 'rayon par défaut');
  assert.equal(Number(same.data[0].distance_km), 0, 'même point : distance nulle, pas de NaN');
});

test('nearby : coordonnées invalides refusées, rayon borné, réponse bornée à 100 annonces', async () => {
  for (const qs of ['', '?lat=abc&lng=3', '?lat=30', '?lat=91&lng=3', '?lat=30&lng=181', '?lat=-91&lng=0', '?lat=Infinity&lng=3', '?lat=30&lng=NaN']) {
    const r = await get('/api/properties/nearby' + qs);
    assert.equal(r.status, 400, qs);
    assert.equal(r.body.error, 'Coordonnées invalides.');
  }
  assert.equal((await get('/api/properties/nearby?lat=30&lng=3&radius=100000')).body.radius, 100);
  assert.equal((await get('/api/properties/nearby?lat=30&lng=3&radius=-5')).body.radius, 0.1);
  assert.equal((await get('/api/properties/nearby?lat=30&lng=3&radius=abc')).body.radius, 5);
  await q(`INSERT INTO properties (owner_id, title, mode, type_bien, price, wilaya, status, lat, lng)
           SELECT $1, 'Dense ' || g, 'vente', 'terrain', 1000000, 'Wilaya-Dense', 'active', -20 + g * 0.0001, 10
           FROM generate_series(1, 130) g`, [owner.id]);
  const dense = (await get('/api/properties/nearby?lat=-20&lng=10&radius=50')).body;
  assert.equal(dense.data.length, 100);
  // Les pôles et l'antiméridien ne font pas échouer le calcul
  for (const qs of ['?lat=90&lng=0', '?lat=-90&lng=180', '?lat=0&lng=-180']) assert.equal((await get('/api/properties/nearby' + qs)).status, 200, qs);
});

// ── Envoi de plusieurs photos ────────────────────────────────────────────────
const image = (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
async function upload(files, token, field = 'files', headers = {}) {
  const fd = new FormData();
  for (const f of files) fd.append(field, new Blob([f.data], { type: f.type || 'image/png' }), f.name || 'photo.png');
  const res = await fetch(s.base + '/api/upload/multiple', { method: 'POST', body: fd,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } });
  const body = await res.json().catch(() => null);
  for (const u of body?.urls || []) made.push(path.join(UPLOADS, path.basename(u)));
  return { status: res.status, body };
}
const uploadsNow = () => new Set(fs.readdirSync(UPLOADS).filter(f => f.endsWith('.webp')));

test('upload/multiple : plusieurs photos deviennent des WebP de 1920 px au plus, dans l\'ordre d\'envoi', async () => {
  const r = await upload([{ data: await image(2400, 1200, '#0C6E4F') }, { data: await image(300, 200, '#ef4444'), name: 'petite.png' }], owner.token);
  assert.equal(r.status, 200);
  assert.equal(r.body.urls.length, 2);
  for (const u of r.body.urls) assert.match(u, /^\/uploads\/[\w.-]+\.webp$/);
  const metas = await Promise.all(r.body.urls.map(u => sharp(path.join(UPLOADS, path.basename(u))).metadata()));
  assert.deepEqual(metas.map(m => [m.format, m.width]), [['webp', 1920], ['webp', 300]], 'grande réduite, petite jamais agrandie');
  assert.equal(new Set(r.body.urls).size, 2, 'noms uniques');
});

test('upload/multiple : connexion exigée, fichiers refusés avec un message traduit', async () => {
  const png = await image(50, 50, '#000');
  assert.equal((await upload([{ data: png }], null)).status, 401);
  assert.deepEqual(await upload([], owner.token), { status: 400, body: { error: 'Aucun fichier reçu.' } });
  const cases = [
    [[{ data: Buffer.from('<?php echo 1;'), name: 'shell.php', type: 'image/png' }], 'Format non supporté. Utilisez JPEG, PNG ou WebP.'],
    [[{ data: Buffer.from('<svg/>'), name: 'a.svg', type: 'image/svg+xml' }], 'Format non supporté. Utilisez JPEG, PNG ou WebP.'],
    [Array.from({ length: 11 }, () => ({ data: png })), 'Fichier inattendu.'],
  ];
  for (const [files, error] of cases) {
    const r = await upload(files, owner.token);
    assert.deepEqual(r, { status: 400, body: { error } });
    assert.match((await upload(files, owner.token, 'files', { 'X-Lang': 'ar' })).body.error, /[؀-ۿ]/);
  }
  assert.equal((await upload([{ data: png }], owner.token, 'autre-champ')).status, 400, 'champ de formulaire inattendu');
});

test('upload/multiple : une image illisible fait échouer tout l\'envoi (400, pas 500) sans laisser de fichier orphelin', async () => {
  const before = uploadsNow();
  // Taille inhabituelle : d'autres fichiers de test envoient des photos en même temps dans ce dossier, on ne cherche que la nôtre
  const r = await upload([{ data: await image(83, 47, '#123456') }, { data: Buffer.from('ceci n\'est pas une image'), name: 'fausse.png' }], owner.token);
  assert.deepEqual(r, { status: 400, body: { error: 'Image illisible ou corrompue.' } });
  await new Promise(done => setTimeout(done, 200));   // la suppression des fichiers déjà écrits n'attend pas la réponse
  const orphans = [];
  for (const f of [...uploadsNow()].filter(f => !before.has(f))) {
    const m = await sharp(path.join(UPLOADS, f)).metadata().catch(() => null);
    if (m && m.width === 83 && m.height === 47) orphans.push(f);
  }
  assert.deepEqual(orphans, [], 'la photo valide du même envoi est retirée');
  // Même règle pour l'envoi simple
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('pas une image')], { type: 'image/png' }), 'fausse.png');
  const single = await fetch(s.base + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + owner.token, 'X-Lang': 'ar' }, body: fd });
  assert.equal(single.status, 400);
  assert.match((await single.json()).error, /[؀-ۿ]/);
});
