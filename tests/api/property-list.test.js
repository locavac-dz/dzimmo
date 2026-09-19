// Liste publique des annonces (GET /api/properties) : tris, pages stables, filtres, recherche texte, valeurs invalides.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, owner, agencyId;
const q    = (sql, params) => s.db.pool.query(sql, params);
const list = async (query = '') => (await s.request('GET', '/api/properties' + query));
const ids  = async (query = '') => (await list(query)).body.data.map(p => p.title);

// Insère une annonce (created_at et prix maîtrisés pour des tris déterministes) ; renvoie son id
async function add(title, o = {}) {
  const r = await q(
    `INSERT INTO properties (owner_id, agency_id, title, description, mode, type_bien, price, surface_m2, rooms, wilaya, commune, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [owner.id, o.agency ? agencyId : null, title, o.description ?? '', o.mode ?? 'vente', o.type ?? 'appartement', o.price ?? 1000000,
     'surface' in o ? o.surface : 80, o.rooms ?? 3, o.wilaya ?? 'Oran', o.commune ?? null, o.status ?? 'active', o.at ?? '2026-01-01T10:00:00Z']);
  return r.rows[0].id;
}

test.before(async () => {
  s = await startServer();
  owner = await s.register('proprio');
  await q('DELETE FROM properties');   // sans le jeu de démonstration : les totaux ne dépendent pas du seed
  agencyId = (await q(`INSERT INTO agencies (owner_id, name, logo, phone, wilaya) VALUES ($1, 'Agence Test', 'logo.png', '021000000', 'Oran') RETURNING id`, [owner.id])).rows[0].id;
});
test.after(async () => { await s.stop(); });

test('tri par défaut : plus récentes d\'abord, ex æquo départagés par id décroissant', async () => {
  await q('DELETE FROM properties');
  const a = await add('A ancienne', { at: '2026-01-01T00:00:00Z' });
  const b = await add('B même date 1', { at: '2026-03-01T00:00:00Z' });
  const c = await add('C même date 2', { at: '2026-03-01T00:00:00Z' });
  const d = await add('D récente', { at: '2026-05-01T00:00:00Z' });
  assert.deepEqual(await ids(), ['D récente', 'C même date 2', 'B même date 1', 'A ancienne']);
  assert.deepEqual(await ids('?sort=date_asc'), ['A ancienne', 'B même date 1', 'C même date 2', 'D récente']);
  assert.deepEqual(await ids('?sort=inconnu'), await ids(), 'tri inconnu : tri par défaut');
  assert.ok(a < b && b < c && c < d);
});

test('tris par prix et surface, ex æquo par id', async () => {
  await q('DELETE FROM properties');
  await add('P1', { price: 5000000, surface: 100 });
  await add('P2', { price: 3000000, surface: 100 });
  await add('P3', { price: 5000000, surface: 50 });
  await add('P4', { price: 9000000, surface: null });
  assert.deepEqual(await ids('?sort=price_asc'),  ['P2', 'P1', 'P3', 'P4']);
  assert.deepEqual(await ids('?sort=price_desc'), ['P4', 'P3', 'P1', 'P2']);
  // surface : 100 (P2 avant P1, id décroissant), 50, puis l'annonce sans surface en dernier
  assert.deepEqual(await ids('?sort=surface_desc'), ['P2', 'P1', 'P3', 'P4']);
});

test('parcourir toutes les pages ne répète ni n\'oublie aucune annonce, quel que soit le tri', async () => {
  await q('DELETE FROM properties');
  // 47 annonces dont beaucoup d'ex æquo (mêmes dates, mêmes prix)
  for (let i = 1; i <= 47; i++) await add('Lot ' + i, { price: 1000000 * (1 + i % 4), surface: 40 + (i % 3) * 10, at: `2026-02-0${1 + i % 3}T09:00:00Z` });
  for (const sort of ['date_desc', 'date_asc', 'price_asc', 'price_desc', 'surface_desc']) {
    const seen = [];
    let pages = 1;
    for (let p = 1; p <= pages; p++) {
      const r = (await list(`?limit=10&page=${p}&sort=${sort}`)).body;
      pages = r.pages;
      seen.push(...r.data.map(x => x.id));
    }
    assert.equal(pages, 5, sort);
    assert.equal(seen.length, 47, sort + ' : nombre d\'annonces parcourues');
    assert.equal(new Set(seen).size, 47, sort + ' : aucune annonce en double');
  }
});

test('propriétaire et agence joints aux annonces de la page, ordre conservé', async () => {
  await q('DELETE FROM properties');
  await add('Avec agence', { agency: true, at: '2026-04-02T00:00:00Z' });
  await add('Sans agence', { at: '2026-04-01T00:00:00Z' });
  const r = (await list()).body;
  assert.deepEqual(r.data.map(p => p.title), ['Avec agence', 'Sans agence']);
  assert.equal(r.data[0].agency_name, 'Agence Test');
  assert.equal(r.data[0].agency_logo, 'logo.png');
  assert.equal(r.data[0].agency_phone, '021000000');
  assert.equal(r.data[1].agency_name, null);
  assert.equal(r.data[0].owner_name, 'Test proprio');
  assert.ok('owner_phone' in r.data[0] && 'owner_avatar' in r.data[0]);
  assert.equal(r.total, 2);
  assert.equal(r.page, 1);
  assert.equal(r.pages, 1);
  assert.equal(r.limit, 12);
});

test('filtres : wilaya, mode, type, prix, surface, pièces, cumulés ; total et pages cohérents', async () => {
  await q('DELETE FROM properties');
  await add('Oran vente villa',   { wilaya: 'Oran',  mode: 'vente',           type: 'villa',       price: 30000000, surface: 200, rooms: 6 });
  await add('Oran vente appart',  { wilaya: 'Oran',  mode: 'vente',           type: 'appartement', price: 12000000, surface: 80,  rooms: 3 });
  await add('Alger loc appart',   { wilaya: 'Alger', mode: 'location_longue', type: 'appartement', price: 60000,    surface: 70,  rooms: 2 });
  await add('Alger vente bureau', { wilaya: 'Alger', mode: 'vente',           type: 'bureau',      price: 20000000, surface: 120, rooms: 4, commune: 'Hydra' });
  const t = async qs => (await ids(qs)).sort();
  assert.deepEqual(await t('?wilaya=Oran'), ['Oran vente appart', 'Oran vente villa']);
  assert.deepEqual(await t('?mode=location_longue'), ['Alger loc appart']);
  assert.deepEqual(await t('?type_bien=bureau'), ['Alger vente bureau']);
  assert.deepEqual(await t('?commune=Hydra'), ['Alger vente bureau']);
  assert.deepEqual(await t('?min_price=15000000'), ['Alger vente bureau', 'Oran vente villa']);
  assert.deepEqual(await t('?max_price=12000000'), ['Alger loc appart', 'Oran vente appart']);
  assert.deepEqual(await t('?min_surface=100&max_surface=150'), ['Alger vente bureau']);
  assert.deepEqual(await t('?rooms=4'), ['Alger vente bureau', 'Oran vente villa'], 'pièces : « 4 et plus »');
  assert.deepEqual(await t('?wilaya=Oran&mode=vente&max_price=20000000&rooms=3'), ['Oran vente appart']);
  assert.deepEqual(await t('?wilaya=Constantine'), []);
  assert.deepEqual(await t('?mode=nimporte&type_bien=nimporte'), await t(), 'mode / type inconnus : sans filtre');
  const paged = (await list('?limit=1&page=3')).body;
  assert.deepEqual([paged.total, paged.pages, paged.page, paged.data.length], [4, 4, 3, 1]);
  const hors = (await list('?limit=1&page=99')).body;
  assert.deepEqual([hors.data.length, hors.pages, hors.total], [0, 4, 4], 'page au-delà de la dernière : vide');
});

test('seules les annonces publiques sont listées ; statuts non publics réservés aux admins', async () => {
  await q('DELETE FROM properties');
  await add('Active'); await add('Vendue', { status: 'sold' }); await add('Louée', { status: 'rented' });
  await add('En attente', { status: 'pending' }); await add('Refusée', { status: 'rejected' }); await add('Archivée', { status: 'archived' });
  assert.deepEqual((await ids()).sort(), ['Active'], 'par défaut : actives');
  assert.deepEqual(await ids('?status=sold'), ['Vendue']);
  assert.equal((await list('?status=pending')).status, 403);
  assert.equal((await list('?status=archived')).status, 403);
  const admin = await s.makeAdmin(await s.register('adm'));
  const r = await s.request('GET', '/api/properties?status=pending', { token: admin.token });
  assert.deepEqual(r.body.data.map(p => p.title), ['En attente']);
});

test('recherche texte : titre, commune, wilaya, description, sans casse ni accents cassés', async () => {
  await q('DELETE FROM properties');
  await add('Belle villa avec piscine', { wilaya: 'Blida' });
  await add('Appartement F3', { commune: 'Bab Ezzouar', wilaya: 'Alger' });
  await add('Terrain agricole', { type: 'terrain', description: 'Proche de la Mitidja, eau et électricité', wilaya: 'Tipaza' });
  await add('Local', { description: 'Vue sur mer', wilaya: 'Béjaïa' });
  assert.deepEqual(await ids('?q=PISCINE'), ['Belle villa avec piscine'], 'titre, sans tenir compte de la casse');
  assert.deepEqual(await ids('?q=bab%20ezzouar'), ['Appartement F3'], 'commune');
  assert.deepEqual(await ids('?q=tipaza'), ['Terrain agricole'], 'wilaya');
  assert.deepEqual(await ids('?q=' + encodeURIComponent('électricité')), ['Terrain agricole'], 'description, accents');
  assert.deepEqual(await ids('?q=' + encodeURIComponent('ÉLECTRICITÉ')), ['Terrain agricole'], 'majuscules accentuées');
  assert.deepEqual(await ids('?q=' + encodeURIComponent('béjaïa')), ['Local']);
  assert.deepEqual(await ids('?q=' + encodeURIComponent('  villa  ')), ['Belle villa avec piscine'], 'espaces autour ignorés');
  assert.deepEqual(await ids('?q=introuvable'), []);
  assert.equal((await list('?q=')).body.total, 4, 'recherche vide : pas de filtre');
  assert.equal((await list('?q=%20%20')).body.total, 4);
});

test('recherche texte : % et _ sont des caractères ordinaires, valeurs non textuelles ignorées', async () => {
  await q('DELETE FROM properties');
  await add('Remise 100% garantie');
  await add('Appartement calme');
  await add('Villa_neuve');
  assert.deepEqual(await ids('?q=' + encodeURIComponent('100%')), ['Remise 100% garantie']);
  assert.deepEqual(await ids('?q=%25'), ['Remise 100% garantie'], '« % » ne correspond plus à tout');
  assert.deepEqual(await ids('?q=_'), ['Villa_neuve'], '« _ » ne correspond plus à un caractère quelconque');
  assert.deepEqual(await ids('?q=' + encodeURIComponent('\\')), [], 'antislash littéral');
  // paramètre répété ou objet : ignoré (avant : erreur 500)
  assert.equal((await list('?q=villa&q=calme')).status, 200);
  assert.equal((await list('?q[a]=villa')).status, 200);
  assert.equal((await list('?q=' + encodeURIComponent("'; DROP TABLE properties; --"))).body.total, 0);
  assert.equal((await q('SELECT COUNT(*)::int n FROM properties')).rows[0].n, 3);
});

test('valeurs numériques invalides : ignorées ou bornées, jamais d\'erreur serveur', async () => {
  await q('DELETE FROM properties');
  await add('Un', { price: 1000000, surface: 50, rooms: 2 });
  await add('Deux', { price: 2000000, surface: 60, rooms: 5 });
  for (const bad of ['min_price=abc', 'max_price=', 'min_surface=NaN', 'max_surface=Infinity', 'rooms=abc', 'rooms=', 'min_price=1&min_price=2',
                     'min_price=1e999', 'page=abc', 'page=-3', 'limit=abc', 'limit=0', 'limit=-5', 'limit=99999', 'page=99999999999999999999']) {
    const r = await list('?' + bad);
    assert.equal(r.status, 200, bad);
  }
  assert.equal((await list('?min_price=abc&rooms=abc')).body.total, 2, 'filtres non numériques ignorés');
  assert.equal((await list('?rooms=2.5')).body.total, 1, 'pièces décimales arrondies au supérieur (3 pièces et plus)');
  assert.equal((await list('?rooms=1e30')).body.total, 0, 'pièces démesurées : plafonnées, aucune annonce');
  assert.equal((await list('?min_price=0')).body.total, 2);
  assert.equal((await list('?limit=99999')).body.limit, 200, 'limit plafonnée à 200');
  assert.equal((await list('?limit=0')).body.limit, 12, 'limit invalide : 12');
  assert.equal((await list('?page=-3')).body.page, 1);
});
