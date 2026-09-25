// Statistiques de l'annonceur : vues, favoris et clics par jour sur 30 jours, totaux et conseils (GET /api/properties/:id/stats).
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, owner, other, admin, fans = [], n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);
const stats = (id, user) => s.request('GET', `/api/properties/${id}/stats`, user ? { token: user.token } : {});
const today = async () => (await q('SELECT CURRENT_DATE::text d')).rows[0].d;
const ago = async k => (await q('SELECT (CURRENT_DATE - $1::int)::text d', [k])).rows[0].d;

// Annonce publiée (active), publiée il y a 20 jours ; par défaut minimale : sans photo, sans vidéo, sans équipement
async function listing(over = {}) {
  const r = await s.request('POST', '/api/properties', { token: owner.token, body: { title: 'Stats annonceur ' + ++n, mode: 'vente', type_bien: 'villa', price: 9000000, wilaya: 'Oran', ...over } });
  assert.equal(r.status, 201);
  await q(`UPDATE properties SET status = 'active', published_at = now() - interval '20 days' WHERE id = $1`, [r.body.id]);
  return r.body.id;
}

test.before(async () => {
  s = await startServer();
  owner = await s.register('sa-owner');
  other = await s.register('sa-autre');
  admin = await s.makeAdmin(await s.register('sa-admin'));
  for (let i = 0; i < 3; i++) fans.push(await s.register('sa-fan' + i));
});
test.after(async () => { await s.stop(); });

test('accès : propriétaire et administrateur seulement ; anonyme 401, tiers 403, inconnu 404', async () => {
  const id = await listing();
  assert.equal((await stats(id)).status, 401);
  assert.equal((await stats(id, other)).status, 403);
  assert.equal((await stats(id, owner)).status, 200);
  assert.equal((await stats(id, admin)).status, 200);
  assert.equal((await stats(999999, owner)).status, 404);
  assert.equal((await stats('abc', owner)).status, 404);
});

test("forme : 30 jours consécutifs jusqu'à aujourd'hui, tout à zéro pour une annonce sans activité", async () => {
  const id = await listing();
  const r = (await stats(id, owner)).body;
  assert.equal(r.days.length, 30);
  assert.equal(r.days[29], await today());
  assert.equal(r.days[0], await ago(29));
  assert.deepEqual(r.views, []); assert.deepEqual(r.favorites, []); assert.deepEqual(r.clicks, []);
  assert.deepEqual(r.totals, { views_30d: 0, views_7d: 0, favorites_30d: 0, favorites_total: 0, calls_30d: 0, whatsapps_30d: 0, contacts_30d: 0, conversion_rate: 0 });
  assert.ok(Array.isArray(r.advice));
});

test('vues, favoris, clics et demandes comptés par jour ; au-delà de 30 jours ils sortent des séries (pas du total de favoris)', async () => {
  const id = await listing();
  await q(`INSERT INTO property_views_daily (property_id, day, views) VALUES ($1, CURRENT_DATE, 5), ($1, CURRENT_DATE - 3, 4), ($1, CURRENT_DATE - 8, 10), ($1, CURRENT_DATE - 40, 99)`, [id]);
  await q(`INSERT INTO contact_clicks (property_id, day, channel, n) VALUES ($1, CURRENT_DATE, 'call', 2), ($1, CURRENT_DATE, 'whatsapp', 1), ($1, CURRENT_DATE - 5, 'call', 3), ($1, CURRENT_DATE - 50, 'call', 8)`, [id]);
  await q(`INSERT INTO favorites (user_id, property_id, created_at) VALUES ($2, $1, now()), ($3, $1, now() - interval '3 days'), ($4, $1, now() - interval '45 days')`, [id, fans[0].id, fans[1].id, fans[2].id]);
  await q(`INSERT INTO contact_requests (property_id, user_id, type) VALUES ($1, $2, 'info')`, [id, fans[0].id]);
  await q(`INSERT INTO contact_requests (property_id, user_id, type, created_at) VALUES ($1, $2, 'info', now() - interval '60 days')`, [id, fans[1].id]);

  const r = (await stats(id, owner)).body;
  assert.deepEqual(r.totals, { views_30d: 19, views_7d: 9, favorites_30d: 2, favorites_total: 3, calls_30d: 5, whatsapps_30d: 1, contacts_30d: 1, conversion_rate: 5.3 });
  const at = (rows, day, key) => rows.filter(x => x.day === day).reduce((t, x) => t + Number(x[key]), 0);
  assert.equal(at(r.views, r.days[29], 'views'), 5);
  assert.equal(at(r.favorites, r.days[29], 'n'), 1);
  assert.equal(at(r.favorites, r.days[26], 'n'), 1);
  for (const rows of [r.views, r.favorites, r.clicks]) assert.ok(rows.every(x => r.days.includes(x.day)));
  // les canaux restent distincts dans `clicks`
  assert.deepEqual(r.clicks.filter(x => x.day === r.days[29]).map(x => [x.channel, Number(x.n)]).sort(), [['call', 2], ['whatsapp', 1]]);
});

test("vie privée : la réponse ne contient ni identifiant ni email des membres qui ont mis l'annonce en favori", async () => {
  const id = await listing();
  await q('INSERT INTO favorites (user_id, property_id) VALUES ($2, $1), ($3, $1)', [id, fans[0].id, fans[1].id]);
  const body = JSON.stringify((await stats(id, owner)).body);
  for (const f of fans) assert.ok(!body.includes(f.email), 'email');
  assert.ok(!/user_id|email|owner_id/.test(body));
});

test('conseils : annonce sans photo ni description → les plus importants, 4 au plus, sous forme de codes', async () => {
  const id = await listing();
  const r = (await stats(id, owner)).body;
  assert.ok(r.advice.length >= 1 && r.advice.length <= 4);
  assert.ok(r.advice.some(a => a.code === 'few_photos' && a.level === 'warn' && a.params.n === 0));
  for (const a of r.advice) { assert.deepEqual(Object.keys(a).sort(), ['code', 'level', 'params']); assert.match(a.code, /^[a-z_]+$/); }
});

test('conseils : téléphone absent, puis renseigné ; le conseil disparaît', async () => {
  const u = await s.register('sa-phone');
  await q('UPDATE users SET phone = NULL WHERE id = $1', [u.id]);
  const create = await s.request('POST', '/api/properties', { token: u.token, body: { title: 'Sans téléphone', mode: 'vente', type_bien: 'villa', price: 1000000, wilaya: 'Oran' } });
  await q(`UPDATE properties SET status = 'active' WHERE id = $1`, [create.body.id]);
  const codes = async () => (await stats(create.body.id, u)).body.advice.map(a => a.code);
  assert.ok((await codes()).includes('no_phone'));
  await q(`UPDATE users SET phone = '0550123456' WHERE id = $1`, [u.id]);
  assert.ok(!(await codes()).includes('no_phone'));
});

test("conseils : « prix élevé » vient du contrôle de qualité de l'annonce, avec l'écart en pourcentage", async () => {
  const id = await listing();
  await q(`INSERT INTO listing_quality (property_id, flags, details) VALUES ($1, '["price_high"]', '{"price":{"ratio":1.75}}')
           ON CONFLICT (property_id) DO UPDATE SET flags = EXCLUDED.flags, details = EXCLUDED.details`, [id]);
  const r = (await stats(id, owner)).body;
  assert.deepEqual(r.advice[0], { code: 'price_high', level: 'warn', params: { pct: 75 } });
});

test('conseils : beaucoup de vues sans réaction, puis un favori les fait disparaître', async () => {
  const id = await listing({ description: 'd'.repeat(200), lat: 36.7, lng: 3.05, features: ['parking'], video_url: 'https://vimeo.com/123456789' });
  await q('INSERT INTO property_views_daily (property_id, day, views) SELECT $1, CURRENT_DATE - g, 3 FROM generate_series(0, 14) g', [id]);
  let r = (await stats(id, owner)).body;
  assert.deepEqual(r.advice.find(a => a.code === 'no_engagement'), { code: 'no_engagement', level: 'warn', params: { views: 45 } });
  await q('INSERT INTO favorites (user_id, property_id) VALUES ($2, $1)', [id, fans[0].id]);
  r = (await stats(id, owner)).body;
  assert.ok(!r.advice.some(a => a.code === 'no_engagement'));
});

test("conseils : une annonce non publiée n'en reçoit pas (les chiffres restent visibles)", async () => {
  const id = await listing();
  await q(`UPDATE properties SET status = 'pending' WHERE id = $1`, [id]);
  const r = (await stats(id, owner)).body;
  assert.deepEqual(r.advice, []);
  assert.equal(r.days.length, 30);
});

test("un favori ajouté par l'API compte aujourd'hui, et son retrait le fait disparaître", async () => {
  const id = await listing();
  const add = await s.request('POST', '/api/favorites', { token: fans[0].token, body: { property_id: id } });
  assert.ok([200, 201].includes(add.status), String(add.status));
  let r = (await stats(id, owner)).body;
  assert.equal(r.totals.favorites_30d, 1);
  assert.deepEqual(r.favorites, [{ day: await today(), n: 1 }]);
  await s.request('DELETE', `/api/favorites/${id}`, { token: fans[0].token });
  r = (await stats(id, owner)).body;
  assert.equal(r.totals.favorites_total, 0);
});

test("migration 023 : l'index des favoris par annonce existe", async () => {
  const r = await q(`SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_favorites_property'`);
  assert.equal(r.rowCount, 1);
});
