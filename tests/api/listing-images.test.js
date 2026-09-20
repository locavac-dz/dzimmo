// image et photos d'une annonce : uniquement nos envois (/uploads/…) ou un domaine de la liste blanche, sur les trois routes qui les écrivent
// (création, modification, ajout d'une photo) ; migration de nettoyage des annonces existantes.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { startServer } = require('../helpers/server');
const { AR } = require('../../server/i18n');
const images = require('../../server/images');

const BAD = 'Image invalide : envoyez-la depuis le formulaire.';
const MANY = 'Trop de photos (20 maximum).';
const UNSPLASH = 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80';

let s, owner, admin, n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);
const base = over => ({ title: 'Annonce image ' + ++n, mode: 'vente', type_bien: 'villa', price: 9000000, wilaya: 'Oran', ...over });
const create = (body, headers) => s.request('POST', '/api/properties', { token: owner.token, body: base(body), headers });
const row = async id => (await q('SELECT image, photos, status, title, price FROM properties WHERE id = $1', [id])).rows[0];
const count = async () => (await q('SELECT COUNT(*)::int c FROM properties')).rows[0].c;

test.before(async () => {
  s = await startServer();
  owner = await s.register('img');
  admin = await s.makeAdmin(await s.register('img-admin'));
});
test.after(async () => { await s.stop(); });

// Valeurs refusées : attribut injecté, schémas dangereux, adresses externes, chemins hors /uploads, formats inconnus, adresses piégées
const BAD_STRINGS = [
  'x" onerror="alert(1)', '"><img src=x onerror=alert(1)>', "x' onerror='alert(1)", 'javascript:alert(1)', 'JaVaScRiPt:alert(1)',
  'data:image/png;base64,AAAA', 'vbscript:x', 'file:///etc/passwd',
  'http://images.unsplash.com/photo.jpg', 'https://evil.example/x.jpg', 'https://images.unsplash.com.evil.example/x.jpg', 'https://evil.example/images.unsplash.com/x.jpg',
  'https://user:pw@images.unsplash.com/x.jpg', 'https://images.unsplash.com:8443/x.jpg', 'https://images.unsplash.com/x"y', "https://images.unsplash.com/x'y",
  'https://images.unsplash.com/x\\y', 'https://images.unsplash.com/x y', 'https://images.unsplash.com/x\ny', 'https://images.unsplash.com/<b>',
  'https://images.unsplash.com', 'https://IMAGES.unsplash.com.', '//evil.example/a.jpg', '/a.jpg', 'a.jpg', 'uploads/a.jpg',
  '/uploads/../../etc/passwd', '/uploads/a/b.webp', '/uploads/a.svg', '/uploads/a.webp?x=1', '/uploads/a.webp#x', '/uploads/a b.webp', '/uploads/.webp',
  '/uploads/a.webp ', ' /uploads/a.webp', '/uploads/a.webp\u0000',
  '/uploads/' + 'a'.repeat(300) + '.webp', UNSPLASH + '&x=' + 'a'.repeat(300),
];
const BAD_TYPES = [42, true, {}, ['/uploads/a.webp'], [], ['x']];

test('valeurs valides : envoi du site, domaine de la liste blanche, champs vides ou absents', async () => {
  for (const image of ['/uploads/1700000000000-abc123.webp', '/uploads/a.JPG', '/uploads/photo_1-2.png', '/uploads/x.jpeg', '/uploads/x.gif', UNSPLASH, '', null, undefined]) {
    const r = await create({ image, photos: image ? [image] : [] });
    assert.equal(r.status, 201, JSON.stringify(image) + ' ' + JSON.stringify(r.body));
  }
  const many = Array.from({ length: 20 }, (_, i) => `/uploads/p${i}.webp`);
  const r = await create({ photos: many });
  assert.equal(r.status, 201, '20 photos : le maximum');
  const saved = await row(r.body.id);
  assert.deepEqual([saved.image, saved.photos.length], ['/uploads/p0.webp', 20], 'la première photo sert d\'image principale');
  const mixed = await create({ image: UNSPLASH, photos: [UNSPLASH, '/uploads/b.webp'] });
  assert.deepEqual((await row(mixed.body.id)).photos, [UNSPLASH, '/uploads/b.webp']);
  assert.equal((await create({ photos: null })).status, 201);
  assert.equal((await create({})).status, 201, 'sans image ni photos');
});

test('création : image refusée dans toutes les formes invalides, message traduit, rien n\'est enregistré', async () => {
  const before = await count();
  for (const image of [...BAD_STRINGS, ...BAD_TYPES.filter(v => !(Array.isArray(v) && v.length === 0 && false))]) {
    const r = await create({ image });
    assert.equal(r.status, 400, 'image = ' + JSON.stringify(image).slice(0, 80));
    assert.equal(r.body.error, BAD);
  }
  assert.equal((await create({ image: 'javascript:alert(1)' }, { 'X-Lang': 'ar' })).body.error, AR[BAD]);
  assert.equal(await count(), before, 'aucune annonce créée');
});

test('création : photos refusées (élément invalide, mauvais types, trop nombreuses)', async () => {
  const before = await count();
  for (const bad of BAD_STRINGS) {
    const r = await create({ photos: ['/uploads/ok.webp', bad] });
    assert.equal(r.status, 400, 'photos contient ' + JSON.stringify(bad).slice(0, 80));
    assert.equal(r.body.error, BAD);
  }
  for (const photos of ['/uploads/a.webp', 'abc', 42, true, {}, { 0: '/uploads/a.webp' }, [1], [null], [undefined], [['/uploads/a.webp']], [{ url: '/uploads/a.webp' }], [true]]) {
    const r = await create({ photos });
    assert.equal(r.status, 400, 'photos = ' + JSON.stringify(photos));
    assert.equal(r.body.error, BAD);
  }
  const tooMany = await create({ photos: Array.from({ length: 21 }, (_, i) => `/uploads/p${i}.webp`) });
  assert.deepEqual([tooMany.status, tooMany.body.error], [400, MANY]);
  assert.equal((await create({ photos: Array.from({ length: 21 }, (_, i) => `/uploads/p${i}.webp`) }, { 'X-Lang': 'ar' })).body.error, AR[MANY]);
  assert.equal(await count(), before);
});

test('modification : mêmes règles, l\'annonce ne change pas en cas de refus ; image vidée par null ; sans ces champs, rien à vérifier', async () => {
  const id = (await create({ image: '/uploads/a.webp', photos: ['/uploads/a.webp', '/uploads/b.webp'] })).body.id;
  const put = (body, token = owner.token) => s.request('PUT', `/api/properties/${id}`, { token, body });
  const before = await row(id);
  for (const bad of ['x" onerror="alert(1)', 'javascript:alert(1)', 'https://evil.example/x.jpg', '/a.jpg', 42, {}, true]) {
    const r = await put({ price: 1234, title: 'Changé', image: bad });
    assert.deepEqual([r.status, r.body.error], [400, BAD], 'image = ' + JSON.stringify(bad));
  }
  for (const photos of [['/uploads/a.webp', 'javascript:x'], 'abc', {}, [1], Array.from({ length: 21 }, (_, i) => `/uploads/p${i}.webp`)]) {
    const r = await put({ price: 1234, photos });
    assert.equal(r.status, 400, JSON.stringify(photos).slice(0, 60));
    assert.equal(r.body.error, Array.isArray(photos) && photos.length === 21 ? MANY : BAD);
  }
  assert.deepEqual(await row(id), before, 'aucun champ modifié par une requête refusée (même le prix et le titre envoyés avec)');
  assert.equal((await put({ image: 'x" onerror="1' }, admin.token)).status, 400, 'un admin non plus');
  // Valides
  assert.equal((await put({ image: UNSPLASH, photos: [UNSPLASH, '/uploads/c.webp'] })).status, 200);
  const ok = await row(id);
  assert.deepEqual([ok.image, ok.photos], [UNSPLASH, [UNSPLASH, '/uploads/c.webp']]);
  assert.equal((await put({ image: null })).status, 200);
  assert.equal((await row(id)).image, '', 'null : image vidée, jamais NULL');
  assert.equal((await put({ image: '' })).status, 200);
  assert.equal((await put({ photos: null, price: 4321 })).status, 200, 'photos: null = inchangé');
  assert.deepEqual([(await row(id)).photos, Number((await row(id)).price)], [[UNSPLASH, '/uploads/c.webp'], 4321]);
});

test('modification d\'une annonce dont l\'ancienne image est invalide : autres champs modifiables, image seule refusée', async () => {
  const id = (await create({})).body.id;
  await q(`UPDATE properties SET image = 'https://ancien.example/x.jpg', photos = '["https://ancien.example/x.jpg"]' WHERE id = $1`, [id]);
  assert.equal((await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { price: 777 } })).status, 200, 'le prix se change sans toucher aux images');
  assert.equal((await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { image: 'https://ancien.example/x.jpg' } })).status, 400,
    'renvoyer la valeur invalide telle quelle est refusé : il faut la remplacer');
  assert.equal((await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { image: '/uploads/nouveau.webp', photos: ['/uploads/nouveau.webp'] } })).status, 200);
});

test('ajout d\'une photo : url valide seulement, total plafonné, propriétaire seulement', async () => {
  const id = (await create({ photos: ['/uploads/a.webp'] })).body.id;
  const add = (url, token = owner.token, headers) => s.request('POST', `/api/properties/${id}/photos`, { token, body: { url }, headers });
  assert.equal((await s.request('POST', `/api/properties/${id}/photos`, { token: owner.token, body: {} })).body.error, 'URL requise.');
  for (const bad of [...BAD_STRINGS.slice(0, 20), 42, {}, ['/uploads/b.webp'], true]) {
    const r = await add(bad);
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 70));
    assert.equal(r.body.error, BAD);
  }
  assert.equal((await add('javascript:x', owner.token, { 'X-Lang': 'ar' })).body.error, AR[BAD]);
  assert.deepEqual((await row(id)).photos, ['/uploads/a.webp'], 'rien n\'a été ajouté');
  assert.equal((await add('/uploads/b.webp', admin.token)).status, 403);
  const ok = await add('/uploads/b.webp');
  assert.deepEqual([ok.status, ok.body.photos], [200, ['/uploads/a.webp', '/uploads/b.webp']]);
  assert.equal((await add(UNSPLASH)).status, 200);
  for (let i = 0; i < 17; i++) assert.equal((await add(`/uploads/n${i}.webp`)).status, 200, 'photo ' + (i + 4));   // 3 + 17 = 20
  const full = await add('/uploads/de-trop.webp');
  assert.deepEqual([full.status, full.body.error], [400, MANY]);
  assert.equal((await row(id)).photos.length, 20);
});

test('suppression d\'une photo : inchangée (elle ne fait que retirer une valeur déjà stockée)', async () => {
  const id = (await create({ photos: ['/uploads/a.webp', '/uploads/b.webp'] })).body.id;
  const del = await s.request('DELETE', `/api/properties/${id}/photos`, { token: owner.token, body: { url: '/uploads/a.webp' } });
  assert.deepEqual(del.body.photos, ['/uploads/b.webp']);
});

// ── Migration 011 : nettoyage des annonces existantes ───────────────────────────────────────────────────────────────
test('migration 011 : valeurs invalides retirées, valides et annonces intactes, rejouable', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'migrations', '011_clean_listing_images.sql'), 'utf8');
  const ins = async (image, photos, status = 'active') => (await q(
    `INSERT INTO properties (owner_id, title, description, mode, type_bien, price, wilaya, status, image, photos, published_at)
     VALUES ($1, $2, 'D', 'vente', 'villa', 1, 'Oran', $3, $4, $5::jsonb, NOW()) RETURNING id`, [owner.id, 'Legacy ' + ++n, status, image, photos])).rows[0].id;
  const long = '/uploads/' + 'a'.repeat(300) + '.webp';
  const ids = {
    clean:   await ins('/uploads/a.webp', JSON.stringify(['/uploads/a.webp', UNSPLASH])),
    dirty:   await ins('x" onerror="alert(1)', JSON.stringify(['/uploads/a.webp', 'javascript:alert(1)', 'https://evil.example/x.jpg', UNSPLASH, 42, null, ['/uploads/a.webp'], '/uploads/z.webp'])),
    allBad:  await ins('http://images.unsplash.com/x.jpg', JSON.stringify(['/a.jpg', 'data:x'])),
    long:    await ins(long, JSON.stringify([long])),
    empty:   await ins('', '[]'),
    nulls:   await ins(null, '[]'),
    object:  await ins('/uploads/a.webp', '{"0":"/uploads/a.webp"}'),
    text:    await ins('/uploads/a.webp', '"/uploads/a.webp"'),
    pending: await ins('"><svg onload=1>', JSON.stringify(['"><svg onload=1>']), 'pending'),
    weird:   await ins('https://images.unsplash.com/x"y', JSON.stringify(['https://images.unsplash.com.evil.example/x.jpg', 'https://user:pw@images.unsplash.com/x.jpg'])),
  };
  const total = await count();
  await q(sql);
  const r = async k => await row(ids[k]);
  assert.deepEqual([(await r('clean')).image, (await r('clean')).photos], ['/uploads/a.webp', ['/uploads/a.webp', UNSPLASH]], 'valeurs valides intactes');
  assert.deepEqual([(await r('dirty')).image, (await r('dirty')).photos], ['', ['/uploads/a.webp', UNSPLASH, '/uploads/z.webp']], 'invalides retirées, ordre des autres conservé');
  assert.deepEqual([(await r('allBad')).image, (await r('allBad')).photos], ['', []]);
  assert.deepEqual([(await r('long')).image, (await r('long')).photos], ['', []], 'au-delà de 300 caractères');
  assert.deepEqual([(await r('empty')).image, (await r('empty')).photos], ['', []]);
  assert.deepEqual([(await r('nulls')).image, (await r('nulls')).photos], [null, []], 'NULL reste NULL');
  assert.deepEqual([(await r('object')).image, (await r('object')).photos], ['/uploads/a.webp', []], 'photos qui n\'est pas un tableau : tableau vide');
  assert.deepEqual((await r('text')).photos, []);
  assert.deepEqual([(await r('weird')).image, (await r('weird')).photos], ['', []], 'adresses piégées');
  assert.equal((await r('pending')).status, 'pending', 'le statut ne change pas');
  assert.equal(await count(), total, 'aucune annonce supprimée');
  const after = JSON.stringify(await Promise.all(Object.keys(ids).map(r)));
  await q(sql);
  assert.equal(JSON.stringify(await Promise.all(Object.keys(ids).map(r))), after, 'rejouable sans effet');
});

test('les annonces de démonstration (seed) restent valides : leurs images passent la règle du serveur', () => {
  const seed = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'db.js'), 'utf8');
  const urls = [...seed.matchAll(/image:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(urls.length >= 3, 'extraction : ' + urls.length);
  for (const u of urls) assert.ok(images.isListingImage(u), u);
  assert.deepEqual(images.REMOTE_HOSTS, ['images.unsplash.com'], 'ajouter un domaine est une décision de sécurité : à faire ici et dans la migration 011');
});

test('une seule règle pour les fichiers envoyés : agence, programme et annonce partagent server/images.js', () => {
  const dir = path.join(__dirname, '..', '..', 'server');
  const all = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') && all.push(path.join(d, e.name)); })(dir);
  const withRule = all.filter(f => fs.readFileSync(f, 'utf8').includes('\\/uploads\\/')).map(f => path.basename(f));
  assert.deepEqual(withRule, ['images.js'], 'la regex des envois ne doit exister qu\'une fois');
  for (const f of ['agency.js', 'projects.js']) assert.match(fs.readFileSync(path.join(dir, f), 'utf8'), /require\('\.\/images'\)/);
  // La migration reprend la même règle
  const mig = fs.readFileSync(path.join(dir, 'migrations', '011_clean_listing_images.sql'), 'utf8');
  assert.ok(mig.includes('images\\.unsplash\\.com') && mig.includes('length(v) <= 300'));
  assert.equal(images.MAX_LENGTH, 300);
});
