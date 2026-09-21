// Mise à la une (« À la une ») : formules, commande et paiement simulé, prolongation, bande publique, attribution par un administrateur.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const { AR } = require('../../server/i18n');

let s, owner, other, admin, n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);
const row = async id => (await q('SELECT * FROM properties WHERE id = $1', [id])).rows[0];
const order = (id, days, user = owner) => s.request('POST', '/api/promotions', { token: user.token, body: { property_id: id, days } });
const pay = (promoId, user = owner) => s.request('POST', `/api/promotions/${promoId}/simulate`, { token: user.token });
const bande = (qs = '') => s.request('GET', '/api/properties/featured' + qs);
const jours = ms => ms / 86400000;

async function listing(over = {}, status = 'active') {
  const r = await s.request('POST', '/api/properties', { token: owner.token, body: {
    title: 'Annonce à la une ' + ++n, mode: 'vente', type_bien: 'appartement', price: 9000000, wilaya: 'Oran', description: 'Texte', ...over } });
  assert.equal(r.status, 201);
  await q(`UPDATE properties SET status = $2, published_at = now() WHERE id = $1`, [r.body.id, status]);
  return r.body.id;
}

test.before(async () => {
  s = await startServer();
  owner = await s.register('une-owner');
  other = await s.register('une-autre');
  admin = await s.makeAdmin(await s.register('une-admin'));
});
test.after(async () => { await s.stop(); });

test('migration 024 : colonne featured_until, table promotions et index', async () => {
  const col = await q(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'properties' AND column_name = 'featured_until'`);
  assert.equal(col.rowCount, 1);
  const idx = (await q(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename IN ('properties', 'promotions')`)).rows.map(r => r.indexname);
  for (const i of ['idx_properties_featured', 'idx_promotions_property', 'idx_promotions_owner']) assert.ok(idx.includes(i), i);
});

test('GET /plans : public, formules en DZD, mode simulé annoncé', async () => {
  const r = await s.request('GET', '/api/promotions/plans');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.currency, 'DZD');
  assert.equal(r.body.simulated, true);
  assert.deepEqual(r.body.plans.map(p => p.days), [7, 15, 30]);
  assert.ok(r.body.plans.every(p => Number.isInteger(p.price) && p.price > 0));
});

test('commande puis paiement simulé : featured_until posé, promotion « paid »', async () => {
  const id = await listing();
  assert.equal((await row(id)).featured_until, null);
  const o = await order(id, 7);
  assert.equal(o.status, 201);
  assert.equal(o.body.simulated, true);
  assert.equal(o.body.amount, 1500);
  assert.equal(o.body.currency, 'DZD');
  assert.equal((await row(id)).featured_until, null, 'rien avant le paiement');
  const p = await pay(o.body.id);
  assert.equal(p.status, 200);
  const until = new Date((await row(id)).featured_until).getTime();
  assert.ok(Math.abs(jours(until - Date.now()) - 7) < 0.01, 'environ 7 jours');
  assert.equal(new Date(p.body.featured_until).getTime(), until);
  assert.equal((await q('SELECT status FROM promotions WHERE id = $1', [o.body.id])).rows[0].status, 'paid');
});

test('un paiement ne compte qu\'une fois (confirmation répétée : 409, durée inchangée)', async () => {
  const id = await listing();
  const o = await order(id, 7);
  assert.equal((await pay(o.body.id)).status, 200);
  const avant = (await row(id)).featured_until;
  const r = await pay(o.body.id);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "Ce paiement n'est plus en attente.");
  assert.deepEqual((await row(id)).featured_until, avant);
});

test('un second achat prolonge depuis la fin en cours, pas depuis aujourd\'hui', async () => {
  const id = await listing();
  await pay((await order(id, 7)).body.id);
  await pay((await order(id, 15)).body.id);
  const until = new Date((await row(id)).featured_until).getTime();
  assert.ok(Math.abs(jours(until - Date.now()) - 22) < 0.01, '7 + 15 jours');
});

test('une mise à la une terminée repart d\'aujourd\'hui', async () => {
  const id = await listing();
  await q(`UPDATE properties SET featured_until = now() - interval '5 days' WHERE id = $1`, [id]);
  await pay((await order(id, 7)).body.id);
  assert.ok(Math.abs(jours(new Date((await row(id)).featured_until).getTime() - Date.now()) - 7) < 0.01);
});

test('une nouvelle commande annule la commande en attente de la même annonce', async () => {
  const id = await listing();
  const a = await order(id, 7);
  const b = await order(id, 30);
  const st = async pid => (await q('SELECT status FROM promotions WHERE id = $1', [pid])).rows[0].status;
  assert.equal(await st(a.body.id), 'cancelled');
  assert.equal(await st(b.body.id), 'pending');
  assert.equal((await pay(a.body.id)).status, 409, 'l\'ancienne commande ne peut plus être payée');
  assert.equal((await pay(b.body.id)).status, 200);
});

test('refus : non connecté, formule inconnue, annonce inconnue, autre annonceur, annonce non publiée', async () => {
  const id = await listing();
  assert.equal((await s.request('POST', '/api/promotions', { body: { property_id: id, days: 7 } })).status, 401);
  const f = await order(id, 8);
  assert.equal(f.status, 400); assert.equal(f.body.error, 'Formule invalide.');
  assert.equal((await order(id, 'abc')).status, 400);
  assert.equal((await order(999999999, 7)).status, 404);
  assert.equal((await order('pas-un-id', 7)).status, 404);
  const autre = await order(id, 7, other);
  assert.equal(autre.status, 403); assert.equal(autre.body.error, 'Accès refusé.');
  for (const st of ['pending', 'archived', 'rejected']) {
    const r = await order(await listing({}, st), 7);
    assert.equal(r.status, 409, st);
    assert.equal(r.body.error, 'Seule une annonce publiée peut être mise à la une.');
  }
});

test('confirmation du paiement d\'un autre annonceur ou d\'une commande inconnue refusée', async () => {
  const id = await listing();
  const o = await order(id, 7);
  const r = await pay(o.body.id, other);
  assert.equal(r.status, 403);
  assert.equal((await row(id)).featured_until, null);
  assert.equal((await pay(999999999)).status, 404);
  assert.equal((await pay('x')).status, 404);
  assert.equal((await s.request('POST', `/api/promotions/${o.body.id}/simulate`)).status, 401);
});

test('mises à la une fermées (FEATURED_ENABLED=false) : 503 et aucune formule affichée', async () => {
  const id = await listing();
  process.env.FEATURED_ENABLED = 'false';
  try {
    const plans = await s.request('GET', '/api/promotions/plans');
    assert.equal(plans.body.enabled, false); assert.deepEqual(plans.body.plans, []); assert.equal(plans.body.simulated, false);
    const r = await order(id, 7);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'Les mises à la une ne sont pas ouvertes pour le moment.');
  } finally { delete process.env.FEATURED_ENABLED; }
});

test('paiement réel non raccordé (PAYMENT_PROVIDER=satim) : 503, commande annulée, simulation fermée (404)', async () => {
  const id = await listing();
  process.env.PAYMENT_PROVIDER = 'satim';
  const log = console.error; console.error = () => {};
  try {
    const r = await order(id, 7);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "Le paiement en ligne n'est pas disponible.");
    assert.equal((await q(`SELECT count(*)::int AS n FROM promotions WHERE property_id = $1 AND status = 'pending'`, [id])).rows[0].n, 0);
    const p = await pay(1);
    assert.equal(p.status, 404); assert.equal(p.body.error, 'Route introuvable.');
  } finally { delete process.env.PAYMENT_PROVIDER; console.error = log; }
});

test('bande /featured : annonces publiées à la une seulement, sans donnée privée', async () => {
  const une   = await listing({ title: 'Bande visible' });
  const expir = await listing({ title: 'Bande expirée' });
  const jamais = await listing({ title: 'Bande jamais' });
  const attente = await listing({ title: 'Bande en attente' }, 'pending');
  await q(`UPDATE properties SET featured_until = now() + interval '3 days' WHERE id = ANY($1)`, [[une, attente]]);
  await q(`UPDATE properties SET featured_until = now() - interval '1 minute' WHERE id = $1`, [expir]);
  const r = await bande('?limit=12');
  assert.equal(r.status, 200);
  const ids = r.body.data.map(p => p.id);
  assert.ok(ids.includes(une));
  for (const absent of [expir, jamais, attente]) assert.ok(!ids.includes(absent), 'présente à tort : ' + absent);
  const txt = JSON.stringify(r.body);
  assert.ok(!txt.includes(owner.email), 'jamais d\'email de propriétaire');
  assert.ok(!('owner_email' in r.body.data[0]));
  assert.ok(r.body.data[0].featured_until);
});

test('bande /featured : filtres, limite bornée, entrées absurdes ignorées', async () => {
  const oran = await listing({ title: 'Filtre Oran', wilaya: 'Oran', mode: 'vente', type_bien: 'villa' });
  const alger = await listing({ title: 'Filtre Alger', wilaya: 'Alger', mode: 'location_longue', type_bien: 'bureau' });
  await q(`UPDATE properties SET featured_until = now() + interval '2 days' WHERE id = ANY($1)`, [[oran, alger]]);
  const ids = async qs => (await bande(qs)).body.data.map(p => p.id);
  let l = await ids('?limit=12&wilaya=Alger');
  assert.ok(l.includes(alger) && !l.includes(oran));
  l = await ids('?limit=12&type_bien=villa');
  assert.ok(l.includes(oran) && !l.includes(alger));
  l = await ids('?limit=12&mode=location_longue');
  assert.ok(l.includes(alger) && !l.includes(oran));
  // valeurs invalides : ignorées (pas d'erreur SQL), tableau ou texte trop long compris
  for (const qs of ['?mode=nimporte', '?type_bien=xx', '?limit=abc', '?wilaya[]=a&wilaya[]=b', '?wilaya=' + 'a'.repeat(200)])
    assert.equal((await bande(qs)).status, 200, qs);
  // limite bornée : 1 au moins, 12 au plus
  const beaucoup = [];
  for (let i = 0; i < 14; i++) beaucoup.push(await listing({ title: 'Lot ' + i }));
  await q(`UPDATE properties SET featured_until = now() + interval '2 days' WHERE id = ANY($1)`, [beaucoup]);
  assert.equal((await bande('?limit=500')).body.data.length, 12);
  assert.equal((await bande('?limit=0')).body.data.length, 6, 'limite illisible : 6 par défaut');
  assert.equal((await bande('?limit=1')).body.data.length, 1);
  assert.equal((await bande()).body.data.length, 6);
});

test('l\'annonce à la une reste dans la liste normale (pagination inchangée)', async () => {
  const id = await listing({ title: 'Toujours listée', wilaya: 'Tlemcen' });
  await q(`UPDATE properties SET featured_until = now() + interval '2 days' WHERE id = $1`, [id]);
  const r = await s.request('GET', '/api/properties?wilaya=Tlemcen');
  assert.ok(r.body.data.some(p => p.id === id));
});

test('administrateur : attribue, prolonge, retire ; historisé à 0 DZD', async () => {
  const id = await listing();
  const put = (i, days, user = admin) => s.request('PUT', `/api/admin/properties/${i}/une`, { token: user.token, body: { days } });
  const a = await put(id, 10);
  assert.equal(a.status, 200);
  assert.ok(Math.abs(jours(new Date(a.body.featured_until).getTime() - Date.now()) - 10) < 0.01);
  const b = await put(id, 5);
  assert.ok(Math.abs(jours(new Date(b.body.featured_until).getTime() - Date.now()) - 15) < 0.01, 'prolonge');
  const h = (await q(`SELECT amount, provider, status FROM promotions WHERE property_id = $1 ORDER BY id`, [id])).rows;
  assert.deepEqual(h.map(x => [Number(x.amount), x.provider, x.status]), [[0, 'admin', 'paid'], [0, 'admin', 'paid']]);
  const c = await put(id, 0);
  assert.equal(c.status, 200); assert.equal(c.body.featured_until, null);
  assert.equal((await row(id)).featured_until, null);
});

test('administrateur : durée invalide 400, annonce inconnue 404, non-admin refusé', async () => {
  const id = await listing();
  const put = (i, days, user = admin) => s.request('PUT', `/api/admin/properties/${i}/une`, { token: user.token, body: { days } });
  for (const d of [-1, 366, 1.5, '7', null, undefined]) {
    const r = await put(id, d);
    assert.equal(r.status, 400, String(d)); assert.equal(r.body.error, 'Durée invalide.');
  }
  assert.equal((await put(999999999, 7)).status, 404);
  assert.equal((await put('x', 7)).status, 404);
  assert.equal((await put(id, 7, owner)).status, 403);
  assert.equal((await s.request('PUT', `/api/admin/properties/${id}/une`, { body: { days: 7 } })).status, 401);
  assert.equal((await row(id)).featured_until, null);
});

test('la liste d\'administration porte featured_until', async () => {
  const id = await listing({ title: 'Liste admin une' });
  await q(`UPDATE properties SET featured_until = now() + interval '1 day' WHERE id = $1`, [id]);
  const r = await s.request('GET', '/api/admin/properties?q=' + encodeURIComponent('Liste admin une'), { token: admin.token });
  assert.equal(r.status, 200);
  const l = (r.body.data || r.body.items || []).find(p => p.id === id);
  assert.ok(l && l.featured_until);
});

test('messages d\'erreur traduits en arabe', async () => {
  for (const m of ['Formule invalide.', 'Durée invalide.', 'Seule une annonce publiée peut être mise à la une.', "Ce paiement n'est plus en attente.",
    'Paiement introuvable.', "Le paiement en ligne n'est pas disponible.", 'Les mises à la une ne sont pas ouvertes pour le moment.'])
    assert.ok(AR[m], m);
  const id = await listing();
  const r = await s.request('POST', '/api/promotions', { token: owner.token, body: { property_id: id, days: 8 }, headers: { 'X-Lang': 'ar' } });
  assert.equal(r.body.error, AR['Formule invalide.']);
});
