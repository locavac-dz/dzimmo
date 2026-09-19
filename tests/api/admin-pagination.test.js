// Pagination des listes d'administration (comptes, annonces, agences, signalements, newsletter, modération).
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const { pageParams, likePattern } = require('../../server/pagination');

let s, admin;
const q   = (sql, params) => s.db.pool.query(sql, params);
const get = (path) => s.request('GET', '/api/admin' + path, { token: admin.token });

test.before(async () => {
  s = await startServer();
  admin = await s.makeAdmin(await s.register('admin'));
  const hash = '$2a$10$abcdefghijklmnopqrstuuFj2fQ0y1x0i7uWyq3m0T0aA0GzE6y0K';
  // Le jeu de démonstration (6 annonces) est retiré pour que les totaux ne dépendent pas du seed ;
  // il reste le compte et l'agence de démonstration, comptés ci-dessous.
  await q('DELETE FROM properties');
  // 60 comptes (+ l'admin et le compte de démonstration), 45 annonces (dont 12 en attente et 4 refusées), 30 agences, 33 signalements, 27 abonnés
  await q(`INSERT INTO users (name, email, password, email_verified)
           SELECT 'Membre ' || g, 'membre' || g || '@test.dz', $1, true FROM generate_series(1, 60) g`, [hash]);
  await q(`INSERT INTO properties (owner_id, title, mode, type_bien, price, wilaya, status)
           SELECT $1, 'Bien ' || g, 'vente', 'appartement', 1000000 + g, (ARRAY['Oran','Alger','Blida'])[1 + g % 3],
                  CASE WHEN g <= 12 THEN 'pending' WHEN g <= 16 THEN 'rejected' ELSE 'active' END
             FROM generate_series(1, 45) g`, [admin.id]);
  await q(`INSERT INTO agencies (owner_id, name, wilaya)
           SELECT $1, 'Agence ' || g, 'Oran' FROM generate_series(1, 30) g`, [admin.id]);
  await q(`INSERT INTO signalements (property_id, user_id, motif, status)
           SELECT (SELECT MIN(id) FROM properties), $1, 'faux', CASE WHEN g % 3 = 0 THEN 'resolved' ELSE 'pending' END FROM generate_series(1, 33) g`, [admin.id]);
  await q(`INSERT INTO newsletter_subscribers (email) SELECT 'abonne' || g || '@test.dz' FROM generate_series(1, 27) g`);
});
test.after(async () => { await s.stop(); });

test('pagination : paramètres bornés et motifs de recherche neutralisés', () => {
  assert.deepEqual(pageParams({}), { page: 1, perPage: 25 });
  assert.deepEqual(pageParams({ page: '3', per_page: '10' }), { page: 3, perPage: 10 });
  assert.equal(pageParams({ per_page: '5000' }).perPage, 100, '100 par page au maximum');
  assert.equal(pageParams({ per_page: '0' }).perPage, 25);
  assert.equal(pageParams({ per_page: '-4', page: '-2' }).page, 1);
  assert.equal(pageParams({ page: 'abc', per_page: 'x' }).page, 1);
  assert.equal(pageParams({ page: '99999999999999999999' }).page, 1000000);
  assert.equal(pageParams({ page: ['2', '3'] }).page, 2, 'paramètre répété : la première valeur');
  assert.equal(pageParams({}, 10).perPage, 10, 'taille par défaut propre à la liste');
  assert.equal(likePattern('  oran '), '%oran%');
  assert.equal(likePattern('100%_\\'), '%100\\%\\_\\\\%', 'jokers LIKE échappés');
  assert.equal(likePattern('   '), null);
  assert.equal(likePattern(['a', 'b']), null);
  assert.equal(likePattern('x'.repeat(500)).length, 102, 'recherche tronquée à 100 caractères');
});

test('comptes : 25 par page, total, pages, plus récents d\'abord, aucune ligne en double', async () => {
  const p1 = (await get('/users')).body;
  assert.equal(p1.total, 62, '60 + admin + compte de démonstration');
  assert.equal(p1.pages, 3);
  assert.equal(p1.page, 1);
  assert.equal(p1.per_page, 25);
  assert.equal(p1.items.length, 25);
  const p2 = (await get('/users?page=2')).body, p3 = (await get('/users?page=3')).body;
  assert.equal(p2.items.length, 25);
  assert.equal(p3.items.length, 12);
  const ids = [...p1.items, ...p2.items, ...p3.items].map(u => u.id);
  assert.equal(new Set(ids).size, 62, 'chaque compte apparaît une seule fois');
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'ordre décroissant des identifiants');
  assert.doesNotMatch(JSON.stringify(p1), /password|\$2[aby]\$/);
});

test('taille de page : per_page respecté, plafonné à 100, valeurs absurdes ramenées aux défauts', async () => {
  assert.equal((await get('/users?per_page=10')).body.items.length, 10);
  assert.equal((await get('/users?per_page=10')).body.pages, 7);
  const grand = (await get('/users?per_page=100000')).body;
  assert.equal(grand.per_page, 100);
  assert.equal(grand.items.length, 62);
  for (const bad of ['page=abc', 'page=-1', 'page=0', 'per_page=abc', 'per_page=0', 'page=1.5', 'page[x]=1', 'page=1&page=2'])
    assert.equal((await get('/users?' + bad)).status, 200, bad);
});

test('page hors limites : renvoie la dernière page (dernier élément supprimé, lien périmé)', async () => {
  const r = (await get('/users?page=999999')).body;
  assert.equal(r.page, 3);
  assert.equal(r.items.length, 12);
  assert.equal((await get('/users?page=99999999999999999999')).status, 200);
  const vide = (await get('/users?q=introuvable-nulle-part')).body;
  assert.deepEqual([vide.items, vide.total, vide.page, vide.pages], [[], 0, 1, 1]);
});

test('comptes : recherche par nom, email, numéro, sans joker SQL', async () => {
  assert.equal((await get('/users?q=membre7@')).body.total, 1);
  assert.equal((await get('/users?q=Membre 4')).body.total, 11, 'Membre 4 et Membre 40 à 49 (nom, sans casse)');
  assert.equal((await get('/users?q=MEMBRE4')).body.total, 11);
  const id = (await q(`SELECT id FROM users WHERE email = 'membre12@test.dz'`)).rows[0].id;
  assert.deepEqual((await get('/users?q=%23' + id)).body.items.map(u => u.id).includes(id), true, '« #id »');
  assert.equal((await get('/users?q=%25')).body.total, 0, '« % » cherche un vrai pourcentage');
  assert.equal((await get('/users?q=_')).body.total, 0, '« _ » cherche un vrai tiret bas');
  assert.equal((await get(`/users?q=${encodeURIComponent("'; DROP TABLE users; --")}`)).body.total, 0);
  assert.equal((await get('/users?q=membre&q=autre')).status, 200, 'paramètre répété ignoré');
  assert.equal((await get('/users?q=membre&per_page=10&page=2')).body.items.length, 10, 'recherche + pagination');
  assert.equal((await get('/users?q=membre')).body.total, 60);
});

test('annonces : filtre de statut + recherche + pagination, colonnes allégées', async () => {
  const tout = (await get('/properties')).body;
  assert.equal(tout.total, 45);
  assert.equal(tout.items.length, 25);
  assert.deepEqual(Object.keys(tout.items[0]).sort(),
    ['created_at', 'id', 'mode', 'owner_id', 'price', 'status', 'title', 'type_bien', 'verified', 'wilaya'],
    'ni description ni photos dans la liste');
  assert.equal((await get('/properties?status=pending')).body.total, 12);
  assert.equal((await get('/properties?status=rejected')).body.total, 4);
  const actives = (await get('/properties?status=active&per_page=10&page=3')).body;
  assert.equal(actives.total, 29);
  assert.equal(actives.items.length, 9);
  assert.ok(actives.items.every(p => p.status === 'active'));
  assert.equal((await get('/properties?status=pending&q=Bien 1')).body.total, 4, 'Bien 1, 10, 11, 12 parmi les annonces en attente');
  assert.ok((await get('/properties?q=Blida')).body.total > 0, 'recherche aussi par wilaya');
  const un = (await get('/properties?q=' + tout.items[0].id)).body.items;
  assert.ok(un.some(p => p.id === tout.items[0].id), 'recherche par numéro');
});

test('agences : pagination et recherche', async () => {
  const r = (await get('/agencies?per_page=20')).body;
  assert.equal(r.total, 31, '30 créées + l\'agence de démonstration');
  assert.equal(r.items.length, 20);
  assert.equal((await get('/agencies?per_page=20&page=2')).body.items.length, 11);
  assert.equal((await get('/agencies?q=Agence 2')).body.total, 11, 'Agence 2, 20 à 29');
});

test('signalements : pagination, filtre de statut, compteur des en attente indépendant du filtre', async () => {
  const tous = (await get('/signalements')).body;
  assert.equal(tous.total, 33);
  assert.equal(tous.items.length, 25);
  assert.equal(tous.pending, 22);
  assert.equal(tous.items[0].property_title, 'Bien 1', 'jointure sur l\'annonce conservée');
  const resolus = (await get('/signalements?status=resolved')).body;
  assert.equal(resolus.total, 11);
  assert.equal(resolus.pending, 22, 'le compteur ne dépend pas du filtre');
  assert.ok(resolus.items.every(x => x.status === 'resolved'));
  assert.equal((await get('/signalements?status=nimporte')).body.total, 33, 'statut inconnu : pas de filtre');
  assert.equal((await get('/signalements?page=2')).body.items.length, 8);
});

test('newsletter : pagination', async () => {
  const r = (await get('/newsletter?per_page=10&page=3')).body;
  assert.equal(r.total, 27);
  assert.equal(r.items.length, 7);
  assert.equal(r.pages, 3);
});

test('modération : 10 fiches par page, compteurs globaux, propriétaire et agence joints', async () => {
  const pending = (await get('/moderation')).body;
  assert.equal(pending.total, 12);
  assert.equal(pending.per_page, 10);
  assert.equal(pending.pages, 2);
  assert.equal(pending.items.length, 10);
  assert.deepEqual(pending.counts, { pending: 12, rejected: 4 });
  assert.equal(pending.items[0].owner_email, admin.email);
  const dates = pending.items.map(p => new Date(p.created_at).getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => a - b), 'les plus anciennes d\'abord');
  const page2 = (await get('/moderation?page=2')).body;
  assert.equal(page2.items.length, 2);
  assert.equal(new Set([...pending.items, ...page2.items].map(p => p.id)).size, 12);
  const refus = (await get('/moderation?status=rejected')).body;
  assert.equal(refus.total, 4);
  assert.equal(refus.items.length, 4);
  assert.equal((await get('/moderation?per_page=500')).body.items.length, 12, 'plafond de 100, toute la file tient');
});

test('les listes restent réservées aux administrateurs', async () => {
  const u = await s.register('simple');
  for (const url of ['/users', '/properties', '/agencies', '/signalements', '/newsletter', '/moderation'])
    assert.equal((await s.request('GET', '/api/admin' + url + '?page=2', { token: u.token })).status, 403, url);
  assert.equal((await s.request('GET', '/api/admin/users')).status, 401);
});
