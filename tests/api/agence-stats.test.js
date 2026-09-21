// GET /api/agencies/me/stats — statistiques globales de l'agence (30 derniers jours).
// Accessible uniquement au propriétaire de l'agence ; retourne days (30 dates), totals, séries journalières et top 5.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, owner, agencyId, propId;
const q = (sql, p) => s.db.pool.query(sql, p);

test.before(async () => {
  s = await startServer();
  owner = await s.register('owner-ag');
  agencyId = (await q(
    `INSERT INTO agencies (owner_id, name, kind, wilaya) VALUES ($1, 'Test Agence', 'agence', 'Alger') RETURNING id`,
    [owner.id]
  )).rows[0].id;
  propId = (await q(
    `INSERT INTO properties (owner_id, agency_id, title, mode, type_bien, price, wilaya, status)
     VALUES ($1, $2, 'Appart test', 'vente', 'appartement', 5000000, 'Alger', 'active') RETURNING id`,
    [owner.id, agencyId]
  )).rows[0].id;
  // Injecter des données : 5 vues hier, 3 aujourd'hui, 2 favoris, clics, 2 demandes
  await q(`INSERT INTO property_views_daily (property_id, day, views) VALUES ($1, CURRENT_DATE - 1, 5)`, [propId]);
  await q(`INSERT INTO property_views_daily (property_id, day, views) VALUES ($1, CURRENT_DATE, 3)`, [propId]);
  const u1 = await s.register('fav-1-ag');
  const u2 = await s.register('fav-2-ag');
  await q(`INSERT INTO favorites (user_id, property_id) VALUES ($1, $2), ($3, $2)`, [u1.id, propId, u2.id]);
  await q(`INSERT INTO contact_clicks (property_id, day, channel, n) VALUES ($1, CURRENT_DATE, 'call', 2), ($1, CURRENT_DATE, 'whatsapp', 1)`, [propId]);
  await q(
    `INSERT INTO contact_requests (user_id, property_id, type, status) VALUES ($1, $2, 'visite', 'pending'), ($3, $2, 'info', 'pending')`,
    [u1.id, propId, u2.id]
  );
});
test.after(async () => { await s.stop(); });

const get = (token) => s.request('GET', '/api/agencies/me/stats', { token });

test('401 sans authentification', async () => {
  const r = await s.request('GET', '/api/agencies/me/stats');
  assert.equal(r.status, 401);
});

test('404 si le compte n\'a pas d\'agence', async () => {
  const other = await s.register('no-agency-ag');
  const r = await get(other.token);
  assert.equal(r.status, 404);
});

test('structure de base : days (30 entrées), totals complets, top et séries présents', async () => {
  const r = await get(owner.token);
  assert.equal(r.status, 200);
  const d = r.body;
  assert.equal(d.days.length, 30, '30 dates');
  for (const day of d.days) assert.match(day, /^\d{4}-\d{2}-\d{2}$/, 'format ISO');
  // la dernière date est aujourd'hui côté base (fuseau algérien) : on vérifie seulement le format, pas la valeur exacte
  for (const k of ['views_30d', 'views_7d', 'favorites_30d', 'favorites_total', 'calls_30d', 'whatsapps_30d', 'contacts_30d', 'listings_active', 'listings_total'])
    assert.ok(Object.hasOwn(d.totals, k), `totals.${k}`);
  assert.ok(Array.isArray(d.top));
  assert.ok(Array.isArray(d.views));
  assert.ok(Array.isArray(d.favorites));
  assert.ok(Array.isArray(d.clicks));
});

test('totaux corrects avec les données insérées', async () => {
  const t = (await get(owner.token)).body.totals;
  assert.equal(t.views_30d,       8,  '5 + 3 vues');
  assert.equal(t.views_7d,        8,  'les 7 derniers jours couvrent les deux dates');
  assert.equal(t.favorites_30d,   2,  '2 favoris récents');
  assert.equal(t.favorites_total, 2,  '2 favoris au total');
  assert.equal(t.calls_30d,       2,  '2 appels');
  assert.equal(t.whatsapps_30d,   1,  '1 WhatsApp');
  assert.equal(t.contacts_30d,    2,  '2 demandes de contact');
  assert.equal(t.listings_active, 1,  '1 annonce active');
  assert.equal(t.listings_total,  1,  '1 annonce au total');
});

test('top listings triés par vues décroissantes, champs obligatoires, sans email', async () => {
  const { body } = await get(owner.token);
  const { top } = body;
  assert.ok(top.length >= 1, 'au moins une annonce');
  const first = top[0];
  for (const k of ['id', 'title', 'views_30d', 'contacts_30d', 'status'])
    assert.ok(Object.hasOwn(first, k), `top[0].${k}`);
  assert.equal(first.views_30d,    8);
  assert.equal(first.contacts_30d, 2);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(owner.email.replace(/[.+]/g, '\\$&')));
});

test('agence vide (aucune annonce) : tous les totaux à 0, top vide', async () => {
  const empty = await s.register('empty-ag-owner');
  await q(`INSERT INTO agencies (owner_id, name, kind, wilaya) VALUES ($1, 'Vide', 'agence', 'Oran')`, [empty.id]);
  const r = await get(empty.token);
  assert.equal(r.status, 200);
  for (const v of Object.values(r.body.totals)) assert.equal(v, 0, `attendu 0, reçu ${v}`);
  assert.deepEqual(r.body.top, []);
});

test('les annonces d\'une autre agence n\'entrent pas dans les stats', async () => {
  const other2 = await s.register('other-ag2');
  const ag2 = (await q(`INSERT INTO agencies (owner_id, name, kind, wilaya) VALUES ($1, 'Ag2', 'agence', 'Oran') RETURNING id`, [other2.id])).rows[0].id;
  const p2 = (await q(
    `INSERT INTO properties (owner_id, agency_id, title, mode, type_bien, price, wilaya, status)
     VALUES ($1, $2, 'Villa autre', 'vente', 'villa', 9000000, 'Oran', 'active') RETURNING id`,
    [other2.id, ag2]
  )).rows[0].id;
  await q(`INSERT INTO property_views_daily (property_id, day, views) VALUES ($1, CURRENT_DATE, 999)`, [p2]);
  const t = (await get(owner.token)).body.totals;
  assert.equal(t.views_30d, 8, 'les 999 vues de l\'autre agence sont exclues');
});
