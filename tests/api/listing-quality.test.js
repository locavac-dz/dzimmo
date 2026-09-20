// Qualité des annonces : doublons (même annonceur, autre annonceur) et prix au m² très éloigné du marché. Un signal bloquant envoie
// l'annonce en modération, même pour une agence vérifiée ; il reste invisible du public.
const test   = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer } = require('../helpers/server');
const { AR } = require('../../server/i18n');

let s, admin, quality;
const q = (sql, p) => s.db.pool.query(sql, p);
const rnd = () => crypto.randomBytes(6).toString('hex');
let seq = 0;
// Texte unique et assez long (≥ 60 caractères normalisés) pour ne jamais ressembler à une autre annonce
const uniqueText = () => `Description ${rnd()} ${rnd()} avec assez de mots pour dépasser largement le seuil de comparaison des textes ${++seq}`;

test.before(async () => {
  s = await startServer();
  quality = require('../../server/quality');       // après startServer : ce module ouvre la connexion à la base
  admin = await s.makeAdmin(await s.register('admin'));
});
test.after(async () => { await s.stop(); process.env.MODERATION = 'on'; });

// n annonces comparables actives (100 m², 10 000 000 DA → 100 000 DA/m²) dans une wilaya, un mode et un type
async function market(n, { wilaya = 'Oran', mode = 'vente', type = 'appartement', price = 10000000, surface = 100 } = {}) {
  for (let i = 0; i < n; i++)
    await q(`INSERT INTO properties (owner_id, title, description, mode, type_bien, price, surface_m2, wilaya, status, published_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW())`, [admin.id, `Marché ${rnd()}`, uniqueText(), mode, type, price, surface, wilaya]);
}
const reset = async () => { await q('DELETE FROM properties'); await q('DELETE FROM agencies'); };

const post = (user, over = {}, headers = {}) => s.request('POST', '/api/properties', { token: user.token, headers, body: {
  title: `Appartement ${rnd()}`, description: uniqueText(), mode: 'vente', type_bien: 'appartement', price: 10000000, surface_m2: 100, wilaya: 'Oran', photos: [], ...over } });
const flagsOf = async id => (await q('SELECT flags, details FROM listing_quality WHERE property_id = $1', [id])).rows[0];
const statusOf = async id => (await q('SELECT status FROM properties WHERE id = $1', [id])).rows[0].status;
async function trusted(label) {            // propriétaire d'une agence vérifiée : publie sans modération
  const u = await s.register(label);
  await q(`INSERT INTO agencies (owner_id, name, wilaya, verified) VALUES ($1, $2, 'Oran', true)`, [u.id, 'Agence ' + label]);
  return u;
}

// ── Fonctions pures ──────────────────────────────────────────────────────────
test('normalisation : sans accents, casse ni ponctuation ; lettres arabes conservées', () => {
  assert.equal(quality.normalize('  Àppartement Très-Beau ! F3 à Oran / '), 'appartement tres beau f3 a oran');
  assert.equal(quality.normalize('Ça va'), 'ca va');
  assert.equal(quality.normalize('شقة جميلة في وهران!'), 'شقة جميلة في وهران');
  assert.equal(quality.normalize(''), '');
  assert.equal(quality.normalize(null), '');
  assert.equal(quality.normalize(undefined), '');
  assert.equal(quality.normalize(12345), '12345');
  assert.equal(quality.normalize('<script>alert(1)</script>'), 'script alert 1 script');
});

test('empreinte : identique aux accents, casse et ponctuation près ; absente pour un texte court', () => {
  const a = 'Belle villa avec piscine et jardin, proche de la mer, vue dégagée, quartier calme';
  const b = 'BELLE VILLA avec piscine et jardin - proche de la mer, vue degagee ; quartier calme!!';
  assert.equal(quality.fingerprint(a), quality.fingerprint(b));
  assert.notEqual(quality.fingerprint(a), quality.fingerprint(a + ' et parking'));
  assert.match(quality.fingerprint(a), /^[a-f0-9]{40}$/);
  for (const short of ['', null, undefined, 'Villa', 'x'.repeat(59), '   villa   ']) assert.equal(quality.fingerprint(short), null, String(short));
  assert.notEqual(quality.fingerprint('x'.repeat(60)), null, '60 caractères : comparé');
});

test('signaux bloquants : copie, prix trop bas, prix trop élevé ; le doublon du même annonceur n\'en est pas un', () => {
  assert.deepEqual(quality.BLOCKING, ['duplicate_other', 'price_low', 'price_high']);
  assert.equal(quality.isBlocking(['duplicate_own']), false);
  assert.equal(quality.isBlocking([]), false);
  assert.equal(quality.isBlocking(['duplicate_own', 'price_low']), true);
  assert.deepEqual([quality.LOW_RATIO, quality.HIGH_RATIO, quality.MIN_LOCAL, quality.MIN_NATIONAL], [0.25, 4, 5, 15]);
});

// ── Prix au m² ───────────────────────────────────────────────────────────────
test('prix au m² : dans la fourchette (¼ à 4 fois la médiane) = aucun signal, l\'annonce suit le circuit normal', async () => {
  await reset(); await market(6);
  const u = await s.register('prix-normal');
  for (const [price, surface] of [[10000000, 100], [3000000, 100], [30000000, 100], [2600000, 100], [39000000, 100]]) {
    const r = await post(u, { price, surface_m2: surface });
    assert.equal(r.status, 201, `${price}`);
    assert.deepEqual(r.body.warnings, [], `${price} : aucun avertissement`);
    assert.equal(r.body.status, 'pending', 'propriétaire ordinaire : modération habituelle');
    assert.deepEqual((await flagsOf(r.body.id)).flags, []);
  }
});

test('prix trop bas (moins du quart de la médiane) : signalé, avertissement à l\'annonceur, envoyé en modération', async () => {
  await reset(); await market(6);
  const u = await s.register('prix-bas');
  const r = await post(u, { price: 2000000, surface_m2: 100 });     // 20 000 DA/m² contre 100 000 : ratio 0,2
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.warnings, [{ code: 'price_low', ratio: 0.2 }]);
  const f = await flagsOf(r.body.id);
  assert.deepEqual(f.flags, ['price_low']);
  assert.equal(f.details.price.median, 100000);
  assert.equal(f.details.price.ppm2, 20000);
  assert.equal(f.details.price.scope, 'wilaya');
  assert.ok(f.details.price.sample >= 6);
  assert.equal(r.body.status, 'pending');
});

test('prix trop élevé (plus de 4 fois la médiane) : signalé', async () => {
  await reset(); await market(6);
  const u = await s.register('prix-haut');
  const r = await post(u, { price: 50000000, surface_m2: 100 });     // 500 000 DA/m² : ratio 5
  assert.deepEqual(r.body.warnings, [{ code: 'price_high', ratio: 5 }]);
  assert.deepEqual((await flagsOf(r.body.id)).flags, ['price_high']);
});

test('marché trop étroit : pas de jugement de prix (moins de 5 comparables dans la wilaya et moins de 15 dans le pays)', async () => {
  await reset(); await market(4);
  const u = await s.register('marche-etroit');
  const r = await post(u, { price: 100000, surface_m2: 100 });       // 1 000 DA/m² : aberrant, mais rien à comparer
  assert.deepEqual(r.body.warnings, []);
  assert.deepEqual((await flagsOf(r.body.id)).flags, []);
});

test('repli national : à défaut de 5 comparables dans la wilaya, 15 dans le pays suffisent', async () => {
  await reset(); await market(16, { wilaya: 'Alger' });
  const u = await s.register('national');
  const r = await post(u, { wilaya: 'Tipaza', price: 1000000, surface_m2: 100 });     // 10 000 DA/m² vs médiane 100 000
  assert.deepEqual(r.body.warnings.map(w => w.code), ['price_low']);
  assert.equal((await flagsOf(r.body.id)).details.price.scope, 'pays');
  // 5 comparables locaux : on compare localement, pas au pays
  await market(5, { wilaya: 'Tipaza', price: 1000000, surface: 100 });                 // médiane locale 10 000
  const ok = await post(u, { wilaya: 'Tipaza', price: 1000000, surface_m2: 100 });
  assert.deepEqual(ok.body.warnings, []);
  assert.equal((await flagsOf(ok.body.id)).details.price.scope, 'wilaya');
});

test('comparaison par mode et par type : une location n\'est pas comparée à des ventes, un terrain pas à des appartements', async () => {
  await reset(); await market(6);                                    // ventes d'appartements
  const u = await s.register('mode-type');
  assert.deepEqual((await post(u, { mode: 'location_longue', price: 60000, surface_m2: 100 })).body.warnings, [], 'aucune location comparable');
  assert.deepEqual((await post(u, { type_bien: 'terrain', price: 100000, surface_m2: 100 })).body.warnings, [], 'aucun terrain comparable');
});

test('sans surface ou avec une surface dérisoire : pas de jugement de prix', async () => {
  await reset(); await market(6);
  const u = await s.register('sans-surface');
  for (const surface_m2 of [undefined, null, 0, 5, 3, -20]) assert.deepEqual((await post(u, { price: 100, surface_m2 })).body.warnings, [], String(surface_m2));
});

test('les annonces non publiées (en attente, refusées, archivées) ne comptent pas dans le marché', async () => {
  await reset(); await market(6);
  await q(`UPDATE properties SET status = 'pending' WHERE id IN (SELECT id FROM properties ORDER BY id LIMIT 3)`);   // il n'en reste que 3 actives
  const u = await s.register('marche-actives');
  assert.deepEqual((await post(u, { price: 100000, surface_m2: 100 })).body.warnings, [], '3 actives : marché trop étroit');
});

test('une annonce n\'est pas comparée à elle-même quand on la modifie', async () => {
  await reset(); await market(5);
  const a = await s.register('soi-meme');
  const id = (await post(a, { price: 10000000 })).body.id;
  await s.request('PUT', `/api/admin/properties/${id}/moderate`, { token: admin.token, body: { decision: 'approve' } });
  const r = await s.request('PUT', `/api/properties/${id}`, { token: a.token, body: { price: 10500000 } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.warnings, []);
  assert.deepEqual((await flagsOf(id)).flags, []);
});

// ── Effet sur la publication ─────────────────────────────────────────────────
test('agence vérifiée : publication directe, sauf signal bloquant (alors modération, et « held » pour l\'annonceur)', async () => {
  await reset(); await market(6);
  const ag = await trusted('agence');
  const normal = await post(ag);
  assert.deepEqual([normal.body.status, normal.body.held], ['active', false]);
  const cheap = await post(ag, { price: 1000000 });
  assert.equal(cheap.body.status, 'pending', 'prix suspect : contrôlé malgré la confiance');
  assert.equal(cheap.body.held, true);
  assert.deepEqual(cheap.body.warnings.map(w => w.code), ['price_low']);
  assert.equal(await statusOf(cheap.body.id), 'pending');
  // Elle apparaît dans la file de modération
  const queue = (await s.request('GET', '/api/admin/moderation?per_page=100', { token: admin.token })).body.items;
  assert.ok(queue.some(p => p.id === cheap.body.id));
});

test('administrateur : publie toujours directement, le signal est enregistré pour information', async () => {
  await reset(); await market(6);
  const r = await post(admin, { price: 1000000 });
  assert.equal(r.body.status, 'active');
  assert.equal(r.body.held, false);
  assert.deepEqual((await flagsOf(r.body.id)).flags, ['price_low']);
});

test('modération désactivée (MODERATION=off) : tout est publié directement, les signaux sont quand même enregistrés', async () => {
  await reset(); await market(6);
  process.env.MODERATION = 'off';
  try {
    const u = await s.register('sans-moderation');
    const r = await post(u, { price: 1000000 });
    assert.equal(r.body.status, 'active');
    assert.deepEqual(r.body.warnings.map(w => w.code), ['price_low']);
    assert.deepEqual((await flagsOf(r.body.id)).flags, ['price_low']);
  } finally { process.env.MODERATION = 'on'; }
});

test('modifier le prix d\'une annonce publiée vers une valeur aberrante la remet en modération (sauf administrateur)', async () => {
  await reset(); await market(6);
  const ag = await trusted('bascule');
  const id = (await post(ag)).body.id;
  assert.equal(await statusOf(id), 'active');
  const r = await s.request('PUT', `/api/properties/${id}`, { token: ag.token, body: { price: 900000 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending', 'publier un prix normal puis le changer n\'échappe pas au contrôle');
  assert.deepEqual(r.body.warnings.map(w => w.code), ['price_low']);
  assert.equal(await statusOf(id), 'pending');
  // Prix redevenu normal : signaux effacés, mais l'annonce reste à valider (pas de republication automatique)
  const back = await s.request('PUT', `/api/properties/${id}`, { token: ag.token, body: { price: 10000000 } });
  assert.deepEqual(back.body.warnings, []);
  assert.deepEqual((await flagsOf(id)).flags, []);
  assert.equal(await statusOf(id), 'pending');
  // Un administrateur modifie sans repasser en modération
  await q(`UPDATE properties SET status = 'active' WHERE id = $1`, [id]);
  const adm = await s.request('PUT', `/api/properties/${id}`, { token: admin.token, body: { price: 900000 } });
  assert.equal(adm.body.status, 'active');
  assert.deepEqual((await flagsOf(id)).flags, ['price_low']);
});

test('archiver, baisser le prix hors ligne puis réactiver : la remise en ligne est réévaluée et bloquée', async () => {
  await reset(); await market(6);
  const ag = await trusted('archive-prix');
  const id = (await post(ag)).body.id;
  const put = body => s.request('PUT', `/api/properties/${id}`, { token: ag.token, body });
  assert.equal((await put({ status: 'archived' })).body.status, 'archived');
  // Hors ligne, le prix aberrant est signalé mais l'annonce reste simplement archivée
  const low = await put({ price: 900000 });
  assert.equal(low.body.status, 'archived');
  assert.deepEqual(low.body.warnings.map(w => w.code), ['price_low']);
  // La réactivation seule (aucun champ de prix dans la requête) est réévaluée : signal bloquant → modération
  const back = await put({ status: 'active' });
  assert.equal(back.status, 200);
  assert.equal(back.body.status, 'pending');
  assert.deepEqual(back.body.warnings.map(w => w.code), ['price_low']);
  assert.equal(await statusOf(id), 'pending');
  // Prix normal : la réactivation d'une annonce archivée passe
  await q(`UPDATE properties SET status = 'archived' WHERE id = $1`, [id]);
  assert.equal((await put({ price: 10000000 })).body.status, 'archived');
  const ok = await put({ status: 'active' });
  assert.equal(ok.body.status, 'active');
  assert.deepEqual(ok.body.warnings, []);
});

// ── Doublons ─────────────────────────────────────────────────────────────────
test('doublon du même annonceur : avertissement (titre ou texte identique, prix à ±5 %), sans blocage', async () => {
  await reset();
  const u = await s.register('doublon-own');
  const text = uniqueText();
  const first = await post(u, { title: 'Villa vue mer', description: text, price: 20000000 });
  assert.deepEqual(first.body.warnings, []);
  // Même texte, autre titre, prix à +4 %
  const second = await post(u, { title: 'Grande villa', description: text, price: 20800000 });
  assert.equal(second.status, 201);
  assert.deepEqual(second.body.warnings, [{ code: 'duplicate_own', id: first.body.id, title: 'Villa vue mer' }]);
  assert.equal(second.body.status, 'pending', 'non bloquant : circuit normal');
  assert.equal(second.body.held, false);
  // Même titre (accents et casse près), autre texte, même prix
  const third = await post(u, { title: 'VILLA  vue mér!', description: uniqueText(), price: 20000000 });
  assert.deepEqual(third.body.warnings.map(w => w.code), ['duplicate_own']);
  // Prix à +6 % ou autre wilaya / mode / type : pas un doublon
  assert.deepEqual((await post(u, { title: 'Villa vue mer', description: uniqueText(), price: 21200000 })).body.warnings, []);
  assert.deepEqual((await post(u, { title: 'Villa vue mer', description: uniqueText(), price: 20000000, wilaya: 'Alger' })).body.warnings, []);
  assert.deepEqual((await post(u, { title: 'Villa vue mer', description: uniqueText(), price: 20000000, mode: 'location_longue' })).body.warnings, []);
  assert.deepEqual((await post(u, { title: 'Villa vue mer', description: uniqueText(), price: 20000000, type_bien: 'villa' })).body.warnings.map(w => w.code), []);
});

test('double envoi (même annonce deux fois en quelques secondes) : refusé, message traduit', async () => {
  await reset();
  const u = await s.register('double');
  const body = { title: 'Local commercial centre', description: uniqueText(), price: 8000000 };
  assert.equal((await post(u, body)).status, 201);
  const again = await post(u, body);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'Vous avez déjà publié cette annonce.');
  const ar = await post(u, body, { 'X-Lang': 'ar' });
  assert.equal(ar.body.error, AR['Vous avez déjà publié cette annonce.']);
  assert.equal((await q('SELECT COUNT(*)::int c FROM properties WHERE owner_id = $1', [u.id])).rows[0].c, 1, 'une seule annonce créée');
  // Quelques minutes plus tard, republier est un simple doublon (avertissement)
  await q(`UPDATE properties SET created_at = NOW() - interval '10 minutes' WHERE owner_id = $1`, [u.id]);
  const later = await post(u, body);
  assert.equal(later.status, 201);
  assert.deepEqual(later.body.warnings.map(w => w.code), ['duplicate_own']);
});

test('promoteur : plusieurs biens identiques avec des titres et des prix différents ne sont pas des doublons', async () => {
  await reset();
  const u = await s.register('promoteur');
  const text = uniqueText();
  const a = await post(u, { title: 'F3 résidence Les Palmiers étage 1', description: text, price: 9000000 });
  const b = await post(u, { title: 'F3 résidence Les Palmiers étage 2', description: text, price: 12000000 });    // même texte mais prix +33 %
  assert.deepEqual(a.body.warnings, []);
  assert.deepEqual(b.body.warnings, []);
});

test('texte copié d\'un autre annonceur : signal bloquant, même pour une agence vérifiée, sans révéler l\'annonce d\'origine', async () => {
  await reset();
  const original = await s.register('original');
  const text = uniqueText();
  const orig = await post(original, { description: text });
  const copier = await trusted('copieur');
  const copy = await post(copier, { description: text.toUpperCase().replace(/ /g, '  ') });     // casse et espaces changés
  assert.equal(copy.status, 201);
  assert.equal(copy.body.status, 'pending', 'agence vérifiée mais texte copié : contrôlé');
  assert.equal(copy.body.held, true);
  assert.deepEqual(copy.body.warnings, [{ code: 'duplicate_other' }], 'aucun identifiant ni titre de l\'autre annonce');
  assert.deepEqual(Object.keys(copy.body.warnings[0]), ['code'], 'le seul champ est le code du signal');
  const f = await flagsOf(copy.body.id);
  assert.deepEqual(f.flags, ['duplicate_other']);
  assert.equal(f.details.duplicate_other.id, orig.body.id, 'le modérateur, lui, sait quelle annonce');
  // Le propriétaire ne voit pas son propre texte comme une copie
  assert.deepEqual((await post(original, { description: uniqueText() })).body.warnings, []);
  // Un annonceur qui reprend son propre texte (autre titre, autre prix) : jamais « copié d'un autre annonceur »
  const mine = uniqueText();
  await post(original, { description: mine });
  const own = await post(original, { title: 'Autre titre différent', description: mine, price: 30000000 });
  assert.deepEqual(own.body.warnings.map(w => w.code), [], 'ses propres annonces ne sont pas « d\'un autre annonceur »');
});

test('texte court (moins de 60 caractères normalisés), annonces refusées, archivées ou vendues : jamais comparés', async () => {
  await reset();
  const [a, b] = [await s.register('court-a'), await s.register('court-b')];
  await post(a, { description: 'Belle villa proche de la mer' });
  assert.deepEqual((await post(b, { description: 'Belle villa proche de la mer' })).body.warnings, [], 'texte court');
  const text = uniqueText();
  const orig = await post(a, { description: text });
  for (const status of ['rejected', 'archived', 'sold', 'rented']) {
    await q('UPDATE properties SET status = $1 WHERE id = $2', [status, orig.body.id]);
    assert.deepEqual((await post(b, { description: text })).body.warnings.filter(w => w.code === 'duplicate_other'), [], status);
  }
  await q(`UPDATE properties SET status = 'active' WHERE id = $1`, [orig.body.id]);
  assert.deepEqual((await post(await s.register('court-c'), { description: text })).body.warnings.map(w => w.code), ['duplicate_other'], 'active : comparée');
});

test('annonces antérieures à la fonction : leurs empreintes sont calculées au démarrage (backfill), la copie est alors détectée', async () => {
  await reset();
  const old = await s.register('ancien');
  const text = uniqueText();
  await q(`INSERT INTO properties (owner_id, title, description, mode, type_bien, price, surface_m2, wilaya, status, published_at)
           VALUES ($1, 'Ancienne annonce', $2, 'vente', 'villa', 15000000, 200, 'Oran', 'active', NOW())`, [old.id, text]);
  const newcomer = await s.register('nouveau');
  assert.deepEqual((await post(newcomer, { description: text })).body.warnings, [], 'sans empreinte, la copie passe inaperçue');
  const n = await quality.backfill();
  assert.ok(n >= 1);
  assert.equal(await quality.backfill(), 0 + (await q('SELECT COUNT(*)::int c FROM properties p LEFT JOIN listing_quality q ON q.property_id = p.id WHERE q.property_id IS NULL')).rows[0].c, 'plus rien à calculer');
  assert.deepEqual((await post(await s.register('copieur2'), { description: text })).body.warnings.map(w => w.code), ['duplicate_other']);
});

// ── Confidentialité ──────────────────────────────────────────────────────────
test('les signaux ne sont visibles ni du public ni des autres membres : ni fiche, ni liste, ni profil de l\'annonceur', async () => {
  await reset(); await market(6);
  const u = await s.register('confidentiel');
  const r = await post(u, { price: 1000000 });
  await q(`UPDATE properties SET status = 'active' WHERE id = $1`, [r.body.id]);
  const detail = (await s.request('GET', `/api/properties/${r.body.id}`)).body;
  const inList = (await s.request('GET', '/api/properties?limit=200')).body.data.find(p => p.id === r.body.id);
  const pub = (await s.request('GET', `/api/properties/user/${u.id}`)).body.find(p => p.id === r.body.id);
  for (const o of [detail, inList, pub]) for (const k of ['quality_flags', 'quality_details', 'flags', 'fingerprint', 'title_key', 'details', 'price_low'])
    assert.ok(!(k in o), `« ${k} » ne doit pas être public`);
  assert.doesNotMatch(JSON.stringify([detail, inList, pub]), /price_low|duplicate_other|fingerprint/);
  // L'annonceur, lui, voit ses propres signaux
  const own = (await s.request('GET', `/api/properties/user/${u.id}`, { token: u.token })).body.find(p => p.id === r.body.id);
  assert.deepEqual(own.quality_flags, ['price_low']);
  // Favoris : même règle
  const fan = await s.register('fan');
  await s.request('POST', '/api/favorites', { token: fan.token, body: { property_id: r.body.id } });
  assert.ok(!('quality_flags' in (await s.request('GET', '/api/favorites', { token: fan.token })).body[0]));
});

test('modération : les signaux et leurs détails sont montrés aux administrateurs seulement', async () => {
  await reset(); await market(6);
  const u = await s.register('mod-signaux');
  const r = await post(u, { price: 1000000 });
  const queue = (await s.request('GET', '/api/admin/moderation?per_page=100', { token: admin.token })).body.items;
  const card = queue.find(p => p.id === r.body.id);
  assert.deepEqual(card.quality_flags, ['price_low']);
  assert.equal(card.quality_details.price.median, 100000);
  assert.equal((await s.request('GET', '/api/admin/moderation', { token: u.token })).status, 403);
  assert.equal((await s.request('GET', '/api/admin/moderation')).status, 401);
});

test('suppression d\'une annonce : ses signaux disparaissent avec elle', async () => {
  await reset();
  const u = await s.register('suppr');
  const id = (await post(u)).body.id;
  assert.equal((await q('SELECT COUNT(*)::int c FROM listing_quality WHERE property_id = $1', [id])).rows[0].c, 1);
  await s.request('DELETE', `/api/properties/${id}`, { token: u.token });
  assert.equal((await q('SELECT COUNT(*)::int c FROM listing_quality WHERE property_id = $1', [id])).rows[0].c, 0);
});
