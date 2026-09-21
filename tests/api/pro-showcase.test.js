// Vitrine des agences et des promoteurs : profil validé, annuaire, fiche publique, rattachement des annonces, programmes neufs, SEO.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const { fullSitemap } = require('../helpers/sitemap');
const { AR } = require('../../server/i18n');

let s, admin;
const q = (sql, p) => s.db.pool.query(sql, p);
const post = (path, token, body, headers) => s.request('POST', path, { token, body, headers });
const put  = (path, token, body) => s.request('PUT', path, { token, body });
const get  = (path, token) => s.request('GET', path, { token });

const FULL = {
  name: 'Agence Horizon', kind: 'agence', wilaya: 'Alger', commune: 'Bab Ezzouar', address: '12 rue des Frères Bouadou',
  tagline: 'Votre partenaire immobilier depuis 2010', description: 'Vente, location et gestion locative à Alger et environs.',
  phone: '+213 555 12 34 56', website: 'agence-horizon.dz', facebook: '@horizon.immo', instagram: 'https://www.instagram.com/horizon.immo/',
  hours: 'Dim–Jeu 9h–17h', founded_year: 2010, services: ['vente', 'location', 'gestion'], coverage: ['Blida', 'Boumerdès'],
  logo: '/uploads/logo-1.webp', cover: '/uploads/cover-1.webp',
};

let n = 0;
async function member(label = 'pro') { return s.register(label + ++n); }
// Crée une vitrine pour un compte ; renvoie son identifiant
async function vitrine(user, over = {}) {
  const r = await post('/api/agencies', user.token, { ...FULL, name: 'Agence ' + ++n, ...over });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}
const verify = id => q('UPDATE agencies SET verified = true WHERE id = $1', [id]);
async function listing(owner, agencyId, over = {}) {
  const o = { title: 'Bien ' + ++n, mode: 'vente', type_bien: 'appartement', price: 1000000, wilaya: 'Alger', status: 'active', project_id: null, ...over };
  return (await q(`INSERT INTO properties (owner_id, agency_id, project_id, title, description, mode, type_bien, price, wilaya, status, published_at)
                   VALUES ($1, $2, $3, $4, 'D', $5, $6, $7, $8, $9, NOW()) RETURNING id`,
    [owner.id, agencyId, o.project_id, o.title, o.mode, o.type_bien, o.price, o.wilaya, o.status])).rows[0].id;
}

test.before(async () => { s = await startServer(); admin = await s.makeAdmin(await s.register('admin')); });
test.after(async () => { await s.stop(); });

// ── Création et validation du profil ────────────────────────────────────────────────────────────────────────────────
test('création : profil complet enregistré et normalisé ; identifiant du compte jamais exposé', async () => {
  const u = await member();
  const r = await post('/api/agencies', u.token, FULL);
  assert.equal(r.status, 201);
  const mine = (await get('/api/agencies/mine/info', u.token)).body;
  assert.equal(mine.website, 'https://agence-horizon.dz/', 'domaine nu complété en https');
  assert.equal(mine.facebook, 'https://www.facebook.com/horizon.immo', 'identifiant transformé en adresse');
  assert.equal(mine.instagram, 'https://www.instagram.com/horizon.immo/');
  assert.deepEqual([mine.kind, mine.founded_year, mine.services, mine.coverage], ['agence', 2010, ['vente', 'location', 'gestion'], ['Blida', 'Boumerdès']]);
  assert.equal(mine.verified, false);
  const pub = (await get(`/api/agencies/${r.body.id}`)).body;
  assert.equal(pub.name, 'Agence Horizon');
  assert.ok(!('owner_id' in pub), 'pas d\'identifiant de compte dans la fiche publique');
  assert.equal(pub.is_mine, false);
  assert.equal((await get(`/api/agencies/${r.body.id}`, u.token)).body.is_mine, true);
  assert.equal((await q('SELECT is_agent FROM users WHERE id = $1', [u.id])).rows[0].is_agent, true);
});

test('création : compte connecté requis, une seule vitrine par compte, nom et wilaya obligatoires', async () => {
  assert.equal((await post('/api/agencies', null, FULL)).status, 401);
  const u = await member();
  assert.equal((await post('/api/agencies', u.token, { name: 'Sans wilaya' })).status, 400);
  assert.equal((await post('/api/agencies', u.token, { wilaya: 'Oran' })).status, 400);
  assert.equal((await post('/api/agencies', u.token, { name: 'Ok', wilaya: 'Oran' })).status, 201);
  const again = await post('/api/agencies', u.token, { name: 'Deuxième', wilaya: 'Oran' });
  assert.equal(again.status, 409);
  assert.equal((await get('/api/agencies/mine/info', (await member()).token)).status, 404);
});

test('la vérification « professionnel » du compte se transmet à la vitrine créée ensuite ; le corps ne peut pas la forcer', async () => {
  const u = await member();
  const forged = await post('/api/agencies', u.token, { name: 'Agence Faux Vérifiée', wilaya: 'Oran', verified: true, owner_id: admin.id, rating: 5 });
  assert.equal(forged.status, 201);
  const row = (await q('SELECT owner_id, verified, rating FROM agencies WHERE id = $1', [forged.body.id])).rows[0];
  assert.deepEqual([row.owner_id, row.verified, Number(row.rating)], [u.id, false, 0]);
  const b = await member();
  await q(`UPDATE users SET verified_kind = 'business' WHERE id = $1`, [b.id]);
  const ok = await post('/api/agencies', b.token, { name: 'Agence Vérifiée', wilaya: 'Oran' });
  assert.equal((await q('SELECT verified FROM agencies WHERE id = $1', [ok.body.id])).rows[0].verified, true);
});

test('validation : logo et couverture ne viennent que de nos envois ; aucune adresse arbitraire dans un src ou un href', async () => {
  const u = await member();
  const attacks = {
    logo:      ['https://evil.example/x.png', 'javascript:alert(1)', '"><img src=x onerror=alert(1)>', '/uploads/../../etc/passwd', '/uploads/a.svg', '//evil.example/a.png', 'data:image/png;base64,AAAA', 42, ['/uploads/a.webp']],
    cover:     ['http://evil.example/c.jpg', '/uploads/x y.webp'],
    website:   ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://exemple.dz', 'https://user:pass@exemple.dz', 'sans-point', 'https://' + 'a'.repeat(210) + '.dz', 5],
    facebook:  ['https://evil.example/horizon', 'https://facebook.com.evil.example/x', 'javascript:alert(1)', 'a b', 'https://twitter.com/x'],
    instagram: ['https://www.facebook.com/x', 'javascript:alert(1)'],
  };
  for (const [field, list] of Object.entries(attacks)) for (const bad of list) {
    const r = await post('/api/agencies', u.token, { name: 'X', wilaya: 'Oran', [field]: bad });
    assert.equal(r.status, 400, `${field} = ${JSON.stringify(bad)}`);
  }
  assert.equal((await q('SELECT COUNT(*)::int c FROM agencies WHERE owner_id = $1', [u.id])).rows[0].c, 0, 'rien n\'est créé');
  const good = await post('/api/agencies', u.token, { name: 'Ok', wilaya: 'Oran', logo: '/uploads/1700000000000-abc123.webp', facebook: 'https://m.facebook.com/horizon', website: 'http://exemple.dz/agence?x=1' });
  assert.equal(good.status, 201);
});

test('validation : champs invalides refusés avec un message traduit', async () => {
  const u = await member();
  const cases = [
    [{ name: 'A' }, 'Nom invalide (2 à 80 caractères).'], [{ name: 'x'.repeat(81) }, 'Nom invalide (2 à 80 caractères).'], [{ name: 42 }, 'Nom invalide (2 à 80 caractères).'],
    [{ kind: 'notaire' }, 'Type de professionnel invalide.'], [{ wilaya: 'Atlantide' }, 'Wilaya invalide.'],
    [{ description: 'x'.repeat(3001) }, 'Texte trop long.'], [{ tagline: 'x'.repeat(121) }, 'Texte trop long.'], [{ hours: {} }, 'Texte trop long.'],
    [{ phone: 'appelez-moi' }, 'Numéro de téléphone invalide.'], [{ phone: '123' }, 'Numéro de téléphone invalide.'], [{ phone: '1'.repeat(20) }, 'Numéro de téléphone invalide.'],
    [{ founded_year: 1850 }, 'Année de création invalide.'], [{ founded_year: 3000 }, 'Année de création invalide.'], [{ founded_year: '20x0' }, 'Année de création invalide.'], [{ founded_year: 2010.5 }, 'Année de création invalide.'],
    [{ services: ['vente', 'magie'] }, 'Services ou zones invalides.'], [{ services: 'vente' }, 'Services ou zones invalides.'], [{ coverage: ['Atlantide'] }, 'Services ou zones invalides.'],
    [{ coverage: Array(21).fill('Alger') }, 'Services ou zones invalides.'],
  ];
  for (const [over, msg] of cases) {
    const r = await post('/api/agencies', u.token, { name: 'Valide', wilaya: 'Oran', ...over });
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.body.error, msg, JSON.stringify(over));
    assert.ok(AR[msg], 'traduction arabe : ' + msg);
    const ar = await post('/api/agencies', u.token, { name: 'Valide', wilaya: 'Oran', ...over }, { 'X-Lang': 'ar' });
    assert.equal(ar.body.error, AR[msg]);
  }
  // Doublons de listes retirés, année en texte de 4 chiffres acceptée, champs vides = effacés
  const ok = await post('/api/agencies', u.token, { name: 'Valide', wilaya: 'Oran', services: ['vente', 'vente'], founded_year: '1999', tagline: '   ', phone: '' });
  assert.equal(ok.status, 201);
  const mine = (await get('/api/agencies/mine/info', u.token)).body;
  assert.deepEqual([mine.services, mine.founded_year, mine.tagline, mine.phone], [['vente'], 1999, null, null]);
});

test('modification : propriétaire ou admin seulement ; seuls les champs envoyés changent ; statut et propriétaire intouchables', async () => {
  const u = await member(), other = await member();
  const id = await vitrine(u);
  assert.equal((await put(`/api/agencies/${id}`, null, { name: 'X' })).status, 401);
  assert.equal((await put(`/api/agencies/${id}`, other.token, { name: 'Pirate' })).status, 403);
  assert.equal((await put(`/api/agencies/99999999`, u.token, { name: 'X' })).status, 404);
  assert.equal((await put(`/api/agencies/abc`, u.token, { name: 'X' })).status, 404);
  const before = (await get('/api/agencies/mine/info', u.token)).body;
  assert.equal((await put(`/api/agencies/${id}`, u.token, { tagline: 'Nouveau slogan', kind: 'promoteur', wilaya: 'Oran', verified: true, owner_id: other.id, rating: 5 })).status, 200);
  const after = (await get('/api/agencies/mine/info', u.token)).body;
  assert.deepEqual([after.tagline, after.kind, after.wilaya, after.verified, after.owner_id], ['Nouveau slogan', 'promoteur', 'Oran', false, u.id]);
  assert.equal(after.name, before.name, 'champ non envoyé : inchangé');
  assert.equal(after.website, before.website);
  assert.equal((await put(`/api/agencies/${id}`, u.token, { logo: 'https://evil.example/x.png' })).status, 400);
  assert.equal((await put(`/api/agencies/${id}`, u.token, {})).status, 200, 'corps vide : rien à faire');
  assert.equal((await put(`/api/agencies/${id}`, admin.token, { tagline: 'Modéré' })).status, 200);
  assert.equal((await put(`/api/agencies/${id}`, u.token, { logo: '' })).status, 200);
  assert.equal((await get('/api/agencies/mine/info', u.token)).body.logo, null, 'chaîne vide = retrait du logo');
});

test('suppression : ses annonces restent en ligne sans agence ; ses programmes disparaissent ; les autres ne peuvent pas', async () => {
  const u = await member(), other = await member();
  const id = await vitrine(u, { kind: 'promoteur' });
  await verify(id);
  const pj = (await post('/api/projects', u.token, { name: 'Résidence Test', wilaya: 'Alger' })).body.id;
  const l = await listing(u, id, { project_id: pj });
  assert.equal((await s.request('DELETE', `/api/agencies/${id}`, { token: other.token })).status, 403);
  assert.equal((await s.request('DELETE', `/api/agencies/${id}`)).status, 401);
  assert.equal((await s.request('DELETE', `/api/agencies/${id}`, { token: u.token })).status, 200);
  assert.equal((await get(`/api/agencies/${id}`)).status, 404);
  const row = (await q('SELECT agency_id, project_id, status FROM properties WHERE id = $1', [l])).rows[0];
  assert.deepEqual([row.agency_id, row.project_id, row.status], [null, null, 'active']);
  assert.equal((await q('SELECT COUNT(*)::int c FROM projects WHERE id = $1', [pj])).rows[0].c, 0);
  assert.equal((await s.request('DELETE', `/api/agencies/${id}`, { token: u.token })).status, 404);
});

// ── Annuaire ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('annuaire : pagination, filtres (type, wilaya y compris zones couvertes, service, texte, vérifiées), tris', async () => {
  const dir = await startFresh();
  const { a, b, c, d } = dir;
  const list = async qs => (await get('/api/agencies' + qs)).body;
  const names = r => r.items.map(x => x.name);

  const all = await list('?per_page=100');
  assert.deepEqual(Object.keys(all).sort(), ['items', 'kinds', 'page', 'pages', 'per_page', 'total']);
  assert.deepEqual(all.kinds, { agence: 3, promoteur: 1 });
  assert.equal(all.total, 4);
  // Défaut : vérifiées d'abord, puis nombre d'annonces
  assert.deepEqual(names(all), ['Bâtisseurs', 'Alger Immo', 'Oran Conseil', 'Constantine Habitat']);
  assert.deepEqual(names(await list('?kind=promoteur')), ['Bâtisseurs']);
  assert.deepEqual(names(await list('?kind=agence&sort=name')), ['Alger Immo', 'Constantine Habitat', 'Oran Conseil']);
  assert.deepEqual(names(await list('?wilaya=Oran&sort=name')), ['Alger Immo', 'Oran Conseil'], 'Alger Immo couvre aussi Oran');
  assert.deepEqual(names(await list('?service=gestion&sort=name')), ['Alger Immo']);
  assert.deepEqual(names(await list('?verified=1')), ['Bâtisseurs', 'Alger Immo']);
  assert.deepEqual(names(await list('?q=oran')), ['Oran Conseil']);
  assert.deepEqual(names(await list('?q=%25')), [], 'le joker % est cherché tel quel');
  assert.deepEqual(names(await list('?q=zzz')), []);
  assert.deepEqual(names(await list('?sort=recent')), ['Constantine Habitat', 'Oran Conseil', 'Bâtisseurs', 'Alger Immo']);
  assert.deepEqual(names(await list('?sort=listings')).slice(0, 2), ['Bâtisseurs', 'Alger Immo']);
  assert.equal(names(await list('?sort=rating'))[0], 'Alger Immo', 'la mieux notée en tête');
  // Filtres invalides ignorés (jamais d'erreur SQL) ; pagination bornée
  assert.equal((await list('?kind=notaire&wilaya=Atlantide&service=magie&sort=DROP')).total, 4);
  const p1 = await list('?per_page=2&page=1&sort=name'), p2 = await list('?per_page=2&page=2&sort=name'), p9 = await list('?per_page=2&page=99&sort=name');
  assert.deepEqual([p1.pages, p1.items.length, p2.items.length, p9.page], [2, 2, 2, 2]);
  assert.equal(new Set([...names(p1), ...names(p2)]).size, 4, 'aucune agence sur deux pages');
  assert.equal((await list('?per_page=100000')).per_page, 100);
  void a; void b; void c; void d;
});

test('annuaire : compteurs (annonces actives, biens vendus ou loués), note = moyenne des avis des annonces, propriétaire suspendu masqué', async () => {
  const u = await member(), reader = await member(), reader2 = await member();
  const id = await vitrine(u, { name: 'Zeta Compteurs' });
  const [l1] = [await listing(u, id), await listing(u, id), await listing(u, id, { status: 'sold' }), await listing(u, id, { status: 'rented' }), await listing(u, id, { status: 'pending' }), await listing(u, id, { status: 'archived' })];
  await q(`INSERT INTO reviews (property_id, author_id, rating, comment) VALUES ($1, $2, 5, 'Excellent'), ($1, $3, 4, 'Bien')`, [l1, reader.id, reader2.id]);
  const row = (await get('/api/agencies?q=Zeta')).body.items[0];
  assert.deepEqual([row.property_count, row.done_count, row.review_count, row.rating], [2, 2, 2, 4.5]);
  const fresh = await member();
  await vitrine(fresh, { name: 'Zeta Sans Avis' });
  const none = (await get('/api/agencies?q=Zeta+Sans')).body.items[0];
  assert.deepEqual([none.property_count, none.review_count, none.rating], [0, 0, null]);
  await q('UPDATE users SET banned = true WHERE id = $1', [u.id]);
  assert.equal((await get('/api/agencies?q=Zeta+Compteurs')).body.total, 0, 'suspendu : masqué de l\'annuaire');
  assert.equal((await get(`/api/agencies/${id}`)).status, 404, 'et sa fiche est introuvable');
  await q('UPDATE users SET banned = false WHERE id = $1', [u.id]);
});

// ── Fiche publique ──────────────────────────────────────────────────────────────────────────────────────────────────
test('fiche publique : profil, chiffres, répartition des annonces, derniers avis (prénom seulement) ; programmes des seuls promoteurs vérifiés', async () => {
  const u = await member(), r1 = await member('sophie'), other = await member();
  await q(`UPDATE users SET name = 'Sophie Martin' WHERE id = $1`, [r1.id]);
  const id = await vitrine(u, { name: 'Fiche Complète', kind: 'promoteur' });
  const l1 = await listing(u, id, { type_bien: 'villa' });
  await listing(u, id, { type_bien: 'villa' });
  await listing(u, id, { type_bien: 'appartement', mode: 'location_longue' });
  await q(`INSERT INTO reviews (property_id, author_id, rating, comment) VALUES ($1, $2, 5, 'Très professionnels')`, [l1, r1.id]);
  const pj = (await q(`INSERT INTO projects (agency_id, name, wilaya) VALUES ($1, 'Résidence Visible', 'Alger') RETURNING id`, [id])).rows[0].id;
  void pj;
  const a = (await get(`/api/agencies/${id}`)).body;
  assert.deepEqual([a.property_count, a.review_count, a.rating], [3, 1, 5]);
  assert.deepEqual(a.types, [{ key: 'villa', n: 2 }, { key: 'appartement', n: 1 }]);
  assert.deepEqual(a.modes, [{ key: 'vente', n: 2 }, { key: 'location_longue', n: 1 }]);
  assert.equal(a.reviews.length, 1);
  assert.deepEqual([a.reviews[0].author_name, a.reviews[0].comment, a.reviews[0].property_id], ['Sophie', 'Très professionnels', l1], 'prénom seulement');
  assert.ok(!JSON.stringify(a).includes('Martin') && !JSON.stringify(a).includes(r1.email));
  assert.deepEqual(a.programmes, [], 'promoteur non vérifié : aucun programme public');
  await verify(id);
  const v = (await get(`/api/agencies/${id}`, other.token)).body;
  assert.equal(v.verified, true);
  assert.deepEqual(v.programmes.map(p => p.name), ['Résidence Visible']);
  assert.equal(v.project_count, 1);
  for (const bad of ['0', '-1', 'abc', '1.5', '99999999999', '1e3']) assert.equal((await get(`/api/agencies/${bad}`)).status, 404, bad);
});

// ── Annonces rattachées ─────────────────────────────────────────────────────────────────────────────────────────────
const NEW = over => ({ title: 'Appartement F3 lumineux', description: 'Un bel appartement au centre ville avec balcon.', mode: 'vente', type_bien: 'appartement', price: 15000000, wilaya: 'Alger', ...over });

test('publier au nom d\'une agence : la sienne seulement ; pas d\'usurpation du nom, du logo ni du numéro d\'une autre', async () => {
  const u = await member(), thief = await member();
  const id = await vitrine(u, { name: 'Agence Publiante' });
  const ok = await post('/api/properties', u.token, NEW({ agency_id: id }));
  assert.equal(ok.status, 201);
  assert.equal((await q('SELECT agency_id FROM properties WHERE id = $1', [ok.body.id])).rows[0].agency_id, id);
  const stolen = await post('/api/properties', thief.token, NEW({ title: 'Usurpation', agency_id: id }));
  assert.equal(stolen.status, 403);
  assert.equal(stolen.body.error, "Vous ne pouvez publier qu'au nom de votre propre agence.");
  assert.equal((await post('/api/properties', thief.token, NEW({ agency_id: id }), { 'X-Lang': 'ar' })).body.error, AR["Vous ne pouvez publier qu'au nom de votre propre agence."]);
  assert.equal((await q(`SELECT COUNT(*)::int c FROM properties WHERE title = 'Usurpation'`)).rows[0].c, 0);
  assert.equal((await post('/api/properties', thief.token, NEW({ agency_id: 99999999 }))).status, 404);
  assert.equal((await post('/api/properties', thief.token, NEW({ agency_id: 'abc' }))).status, 404);
  // Sans agency_id : annonce de particulier ; agency_id null : idem
  const solo = await post('/api/properties', u.token, NEW({ title: 'Annonce de particulier' }));
  assert.equal((await q('SELECT agency_id FROM properties WHERE id = $1', [solo.body.id])).rows[0].agency_id, null);
  // Modification : même règle, et l'annonceur peut détacher son annonce
  assert.equal((await put(`/api/properties/${ok.body.id}`, u.token, { agency_id: null })).status, 200);
  assert.equal((await q('SELECT agency_id FROM properties WHERE id = $1', [ok.body.id])).rows[0].agency_id, null);
  assert.equal((await put(`/api/properties/${solo.body.id}`, u.token, { agency_id: id })).status, 200);
  const other = await member(); const oid = await vitrine(other);
  assert.equal((await put(`/api/properties/${solo.body.id}`, u.token, { agency_id: oid })).status, 403);
  assert.equal((await q('SELECT agency_id FROM properties WHERE id = $1', [solo.body.id])).rows[0].agency_id, id, 'refus : rien ne change');
});

test('liste et fiche d\'annonce : filtres agency_id et project_id, type de professionnel, programme visible seulement si vérifié', async () => {
  const u = await member(), v = await member();
  const a1 = await vitrine(u, { kind: 'promoteur' }), a2 = await vitrine(v);
  await verify(a1);
  const pj = (await post('/api/projects', u.token, { name: 'Les Jasmins', wilaya: 'Alger' })).body.id;
  const inPj = await listing(u, a1, { project_id: pj }), plain = await listing(u, a1), theirs = await listing(v, a2);
  const ids = async qs => (await get('/api/properties' + qs)).body.data.map(p => p.id).sort();
  assert.deepEqual(await ids(`?agency_id=${a1}&limit=50`), [inPj, plain].sort());
  assert.deepEqual(await ids(`?agency_id=${a2}`), [theirs]);
  assert.deepEqual(await ids(`?project_id=${pj}`), [inPj]);
  assert.ok((await ids('?agency_id=abc&limit=200')).length > 3, 'valeur invalide : filtre ignoré');
  const row = (await get(`/api/properties?project_id=${pj}`)).body.data[0];
  assert.equal(row.agency_kind, 'promoteur');
  const detail = (await get(`/api/properties/${inPj}`)).body;
  assert.deepEqual([detail.agency_kind, detail.project && detail.project.name], ['promoteur', 'Les Jasmins']);
  await q('UPDATE agencies SET verified = false WHERE id = $1', [a1]);
  assert.equal((await get(`/api/properties/${inPj}`)).body.project, null, 'promoteur non vérifié : le programme n\'est plus affiché');
  await verify(a1);
});

// ── Programmes neufs ────────────────────────────────────────────────────────────────────────────────────────────────
const PROG = { name: 'Résidence Les Jasmins', wilaya: 'Alger', commune: 'Hydra', status: 'en_construction', delivery_year: new Date().getFullYear() + 1, delivery_quarter: 2,
  total_units: 48, description: 'Résidence de standing de 48 logements.', features: ['ascenseur', 'parking'], photos: ['/uploads/p1.webp', '/uploads/p2.webp'] };

test('programmes : réservés aux promoteurs dont le registre est vérifié', async () => {
  const noAgency = await member(), agence = await member(), promo = await member();
  assert.equal((await post('/api/projects', null, PROG)).status, 401);
  assert.equal((await post('/api/projects', noAgency.token, PROG)).status, 404);
  const a = await vitrine(agence); await verify(a);
  const denied = await post('/api/projects', agence.token, PROG);
  assert.equal(denied.status, 403, 'une agence ne publie pas de programme');
  assert.equal(denied.body.error, 'Seuls les promoteurs vérifiés peuvent publier un programme.');
  assert.equal((await post('/api/projects', agence.token, PROG, { 'X-Lang': 'ar' })).body.error, AR[denied.body.error]);
  const p = await vitrine(promo, { kind: 'promoteur' });
  assert.equal((await post('/api/projects', promo.token, PROG)).status, 403, 'promoteur non vérifié');
  await verify(p);
  const ok = await post('/api/projects', promo.token, PROG);
  assert.equal(ok.status, 201);
  const row = (await q('SELECT * FROM projects WHERE id = $1', [ok.body.id])).rows[0];
  assert.deepEqual([row.agency_id, row.name, row.image, row.photos, row.features], [p, PROG.name, '/uploads/p1.webp', PROG.photos, ['ascenseur', 'parking']]);
});

test('programmes : validation des champs, messages traduits, rien d\'enregistré en cas d\'erreur', async () => {
  const u = await member(); const id = await vitrine(u, { kind: 'promoteur' }); await verify(id);
  const year = new Date().getFullYear();
  const cases = [
    [{ name: 'A' }, 'Nom du programme invalide (2 à 120 caractères).'], [{ name: 'x'.repeat(121) }, 'Nom du programme invalide (2 à 120 caractères).'],
    [{ wilaya: 'Atlantide' }, 'Wilaya invalide.'], [{ status: 'rêvé' }, 'Avancement du programme invalide.'],
    [{ delivery_year: 1999 }, 'Date de livraison invalide.'], [{ delivery_year: year + 16 }, 'Date de livraison invalide.'], [{ delivery_quarter: 5 }, 'Date de livraison invalide.'], [{ delivery_quarter: 0 }, 'Date de livraison invalide.'],
    [{ total_units: 0 }, 'Nombre de lots invalide.'], [{ total_units: 5001 }, 'Nombre de lots invalide.'], [{ total_units: 'beaucoup' }, 'Nombre de lots invalide.'],
    [{ image: 'https://evil.example/a.png' }, 'Image invalide : envoyez-la depuis le formulaire.'], [{ photos: ['/uploads/a.webp', 'javascript:alert(1)'] }, 'Image invalide : envoyez-la depuis le formulaire.'],
    [{ photos: Array(13).fill('/uploads/a.webp') }, 'Image invalide : envoyez-la depuis le formulaire.'],
    [{ features: ['piscine-olympique'] }, 'Équipements invalides.'], [{ description: 'x'.repeat(3001) }, 'Texte trop long.'],
  ];
  for (const [over, msg] of cases) {
    const r = await post('/api/projects', u.token, { ...PROG, ...over });
    assert.equal(r.status, 400, JSON.stringify(over).slice(0, 80));
    assert.equal(r.body.error, msg);
    assert.ok(AR[msg], msg);
  }
  assert.equal((await post('/api/projects', u.token, { wilaya: 'Alger' })).body.error, 'Nom et wilaya requis.');
  assert.equal((await q('SELECT COUNT(*)::int c FROM projects WHERE agency_id = $1', [id])).rows[0].c, 0);
});

test('programmes : liste et fiche publiques (promoteur vérifié seulement), chiffres calculés depuis les lots', async () => {
  const u = await member(), other = await member();
  const id = await vitrine(u, { kind: 'promoteur', name: 'Promoteur Chiffres' }); await verify(id);
  const pid = (await post('/api/projects', u.token, { ...PROG, name: 'Programme Chiffres' })).body.id;
  await listing(u, id, { project_id: pid, price: 12000000 });
  await listing(u, id, { project_id: pid, price: 9500000 });
  await listing(u, id, { project_id: pid, price: 8000000, status: 'sold' });
  await listing(u, id, { project_id: pid, price: 1000, status: 'pending' });
  const pj = (await get(`/api/projects/${pid}`)).body;
  assert.deepEqual([pj.available_count, pj.sold_count, Number(pj.price_from)], [2, 1, 9500000], 'à partir de : lots actifs seulement');
  assert.deepEqual([pj.agency_name, pj.agency_kind, pj.agency_verified, pj.is_mine, pj.visible], ['Promoteur Chiffres', 'promoteur', true, false, true]);
  assert.equal((await get(`/api/projects/${pid}`, u.token)).body.is_mine, true);
  const list = (await get('/api/projects?q=Chiffres')).body;
  assert.deepEqual([list.total, list.items[0].name], [1, 'Programme Chiffres']);
  assert.equal((await get('/api/projects?wilaya=Alger')).body.items.some(p => p.id === pid), true);
  assert.equal((await get('/api/projects?wilaya=Oran')).body.items.some(p => p.id === pid), false);
  assert.equal((await get(`/api/projects?agency_id=${id}`)).body.total, 1);
  assert.equal((await get('/api/projects?status=livre')).body.items.some(p => p.id === pid), false);
  for (const bad of ['0', 'abc', '99999999999']) assert.equal((await get(`/api/projects/${bad}`)).status, 404, bad);
  // Vérification retirée : le programme disparaît pour le public, pas pour son propriétaire
  await q('UPDATE agencies SET verified = false WHERE id = $1', [id]);
  assert.equal((await get(`/api/projects/${pid}`)).status, 404);
  assert.equal((await get(`/api/projects/${pid}`, other.token)).status, 404);
  assert.equal((await get('/api/projects?q=Chiffres')).body.total, 0);
  const mine = (await get(`/api/projects/${pid}`, u.token)).body;
  assert.deepEqual([mine.visible, mine.is_mine], [false, true]);
  assert.deepEqual((await get('/api/projects/mine', u.token)).body.map(p => [p.id, p.visible]), [[pid, false]]);
  assert.equal((await get('/api/projects/mine')).status, 401);
  await verify(id);
  await q('UPDATE users SET banned = true WHERE id = $1', [u.id]);
  assert.equal((await get(`/api/projects/${pid}`)).status, 404, 'propriétaire suspendu : programme masqué');
  await q('UPDATE users SET banned = false WHERE id = $1', [u.id]);
});

test('programmes : modification et suppression par le propriétaire ou un admin ; les lots restent en ligne', async () => {
  const u = await member(), other = await member();
  const id = await vitrine(u, { kind: 'promoteur' }); await verify(id);
  const pid = (await post('/api/projects', u.token, PROG)).body.id;
  const lot = await listing(u, id, { project_id: pid });
  assert.equal((await put(`/api/projects/${pid}`, null, { name: 'X' })).status, 401);
  assert.equal((await put(`/api/projects/${pid}`, other.token, { name: 'Pirate' })).status, 403);
  assert.equal((await put('/api/projects/99999999', u.token, { name: 'X' })).status, 404);
  assert.equal((await put(`/api/projects/${pid}`, u.token, { status: 'livre', delivery_year: 2024, name: 'Résidence Livrée', agency_id: 1 })).status, 200);
  const row = (await q('SELECT name, status, delivery_year, agency_id, total_units FROM projects WHERE id = $1', [pid])).rows[0];
  assert.deepEqual([row.name, row.status, row.delivery_year, row.agency_id, row.total_units], ['Résidence Livrée', 'livre', 2024, id, 48], 'seuls les champs envoyés changent, l\'agence jamais');
  assert.equal((await put(`/api/projects/${pid}`, u.token, { photos: ['https://evil.example/a.png'] })).status, 400);
  assert.equal((await put(`/api/projects/${pid}`, admin.token, { description: 'Modéré' })).status, 200);
  assert.equal((await s.request('DELETE', `/api/projects/${pid}`, { token: other.token })).status, 403);
  assert.equal((await s.request('DELETE', `/api/projects/${pid}`, { token: u.token })).status, 200);
  assert.deepEqual((await q('SELECT project_id, agency_id, status FROM properties WHERE id = $1', [lot])).rows[0], { project_id: null, agency_id: id, status: 'active' });
  assert.equal((await s.request('DELETE', `/api/projects/${pid}`, { token: u.token })).status, 404);
});

test('rattacher une annonce à un programme : le sien seulement, et au nom du même promoteur', async () => {
  const u = await member(), v = await member();
  const a1 = await vitrine(u, { kind: 'promoteur' }), a2 = await vitrine(v, { kind: 'promoteur' });
  await verify(a1); await verify(a2);
  const p1 = (await post('/api/projects', u.token, PROG)).body.id, p2 = (await post('/api/projects', v.token, PROG)).body.id;
  const ok = await post('/api/properties', u.token, NEW({ project_id: p1 }));
  assert.equal(ok.status, 201);
  assert.deepEqual((await q('SELECT agency_id, project_id FROM properties WHERE id = $1', [ok.body.id])).rows[0], { agency_id: a1, project_id: p1 }, 'l\'agence se déduit du programme');
  const foreign = await post('/api/properties', u.token, NEW({ title: 'Lot volé', project_id: p2 }));
  assert.equal(foreign.status, 403);
  assert.equal((await post('/api/properties', u.token, NEW({ project_id: 99999999 }))).status, 404);
  const mismatch = await post('/api/properties', u.token, NEW({ project_id: p1, agency_id: a2 }));
  assert.equal(mismatch.status, 403, 'agence d\'un autre : refusé avant tout');
  const b = await post('/api/properties', u.token, NEW({ title: 'Sans programme' }));
  assert.equal((await put(`/api/properties/${b.body.id}`, u.token, { project_id: p1 })).status, 200);
  assert.deepEqual((await q('SELECT agency_id, project_id FROM properties WHERE id = $1', [b.body.id])).rows[0], { agency_id: a1, project_id: p1 });
  assert.equal((await put(`/api/properties/${b.body.id}`, u.token, { agency_id: null })).status, 200);
  assert.deepEqual((await q('SELECT agency_id, project_id FROM properties WHERE id = $1', [b.body.id])).rows[0], { agency_id: null, project_id: null }, 'retirer l\'agence détache le programme');
  assert.equal((await put(`/api/properties/${b.body.id}`, u.token, { project_id: p2 })).status, 403);
});

// ── SEO ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('SEO : pages /agence et /promoteur (titre, données structurées, canonique), redirections, 404, annuaires, sitemap', async () => {
  const u = await member(), v = await member();
  const id = await vitrine(u, { name: 'Agence <Test> & Fils', kind: 'agence', tagline: 'Slogan "cité"' });
  const pid = await vitrine(v, { name: 'Promoteur Étoile', kind: 'promoteur' }); await verify(pid);
  await listing(u, id);
  const page = await s.request('GET', `/agence/${id}-agence-test-fils`);
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>Agence &lt;Test&gt; &amp; Fils — Agence immobilière à Alger \| DzImmo<\/title>/);
  assert.match(page.text, /<link rel="canonical" href="https:\/\/dzimmo\.test\/agence\/\d+-agence-test-fils">/);
  assert.doesNotMatch(page.text, /<Test>/, 'le nom est échappé dans le HTML');
  const ld = JSON.parse(page.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual([ld['@type'], ld.name, ld.address.addressRegion, ld.telephone], ['RealEstateAgent', 'Agence <Test> & Fils', 'Alger', '+213 555 12 34 56']);
  assert.ok(ld.sameAs.includes('https://agence-horizon.dz/') && ld.areaServed.includes('Blida'));
  assert.equal(ld.aggregateRating, undefined, 'pas d\'avis : pas de note annoncée aux moteurs');
  assert.equal(ld.image, 'https://dzimmo.test/uploads/cover-1.webp');
  // Promoteur : type et préfixe propres ; mauvais préfixe ou mauvais slug : redirection canonique
  const promo = await s.request('GET', `/promoteur/${pid}-promoteur-etoile`);
  assert.equal(promo.status, 200);
  assert.match(promo.text, /Promoteur immobilier à Alger/);
  assert.equal(JSON.parse(promo.text.match(/ld\+json">([\s\S]*?)<\/script>/)[1])['@type'], 'Organization');
  const wrongKind = await s.request('GET', `/agence/${pid}-promoteur-etoile`);
  assert.deepEqual([wrongKind.status, wrongKind.headers.get('location')], [301, `/promoteur/${pid}-promoteur-etoile`]);
  const wrongSlug = await s.request('GET', `/agence/${id}-ancien-nom`);
  assert.deepEqual([wrongSlug.status, wrongSlug.headers.get('location')], [301, `/agence/${id}-agence-test-fils`]);
  const bare = await s.request('GET', `/agence/${id}`);
  assert.equal(bare.status, 301);
  // Inconnu, mal formé ou suspendu : vraie 404 non indexable
  for (const path of ['/agence/999999', '/agence/abc', '/promoteur/0-x', '/programme/999999']) {
    const r = await s.request('GET', path);
    assert.equal(r.status, 404, path);
    assert.match(r.text, /noindex/);
  }
  await q('UPDATE users SET banned = true WHERE id = $1', [u.id]);
  assert.equal((await s.request('GET', `/agence/${id}-agence-test-fils`)).status, 404);
  await q('UPDATE users SET banned = false WHERE id = $1', [u.id]);
  // Annuaires
  for (const [path, title] of [['/agences', /Agences immobilières en Algérie/], ['/promoteurs', /Promoteurs immobiliers en Algérie/], ['/programmes', /Programmes immobiliers neufs/]]) {
    const r = await s.request('GET', path);
    assert.equal(r.status, 200, path);
    assert.match(r.text, title);
  }
  // Sitemap : annuaires, vitrines et programmes visibles
  await post('/api/projects', v.token, { ...PROG, name: 'Programme Sitemap' });
  const map = await fullSitemap(s);
  for (const frag of ['/agences<', '/promoteurs<', '/programmes<', `/agence/${id}-agence-test-fils<`, `/promoteur/${pid}-promoteur-etoile<`, '-programme-sitemap<'])
    assert.ok(map.includes(frag), frag);
});

test('SEO : page d\'un programme (Apartment complex), masquée tant que le promoteur n\'est pas vérifié', async () => {
  const u = await member();
  const id = await vitrine(u, { kind: 'promoteur', name: 'Promoteur Programme' }); await verify(id);
  const pid = (await post('/api/projects', u.token, PROG)).body.id;
  await listing(u, id, { project_id: pid, price: 14000000 });
  const path = `/programme/${pid}-residence-les-jasmins`;
  const r = await s.request('GET', path);
  assert.equal(r.status, 200);
  assert.match(r.text, /<title>Résidence Les Jasmins — Programme neuf à Alger \| DzImmo<\/title>/);
  assert.match(r.text, /à partir de 14 000 000 DZD/);
  const ld = JSON.parse(r.text.match(/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual([ld['@type'], ld.numberOfAccommodationUnits, ld.numberOfAvailableAccommodationUnits], ['ApartmentComplex', 48, 1]);
  assert.equal((await s.request('GET', `/programme/${pid}-mauvais`)).status, 301);
  await q('UPDATE agencies SET verified = false WHERE id = $1', [id]);
  assert.equal((await s.request('GET', path)).status, 404);
});

// ── Jeu de données de l'annuaire ────────────────────────────────────────────────────────────────────────────────────
// Quatre professionnels aux caractéristiques distinctes (créés dans une base propre : on supprime ceux des tests précédents)
async function startFresh() {
  await q('DELETE FROM agencies');
  const mk = async (name, over, listings = 0) => {
    const u = await member('dir');
    const id = await vitrine(u, { name, services: ['vente'], coverage: [], ...over });
    for (let i = 0; i < listings; i++) await listing(u, id);
    return { u, id };
  };
  const a = await mk('Alger Immo', { wilaya: 'Alger', coverage: ['Oran'], services: ['vente', 'gestion'], tagline: 'Alger et environs' }, 3);
  const b = await mk('Bâtisseurs', { wilaya: 'Blida', kind: 'promoteur', services: ['neuf'] }, 5);
  const c = await mk('Oran Conseil', { wilaya: 'Oran' }, 1);
  const d = await mk('Constantine Habitat', { wilaya: 'Constantine' }, 0);
  await verify(a.id); await verify(b.id);
  // Ancienneté croissante (Alger Immo la plus ancienne) et un avis pour départager la note
  for (const [i, x] of [a, b, c, d].entries()) await q(`UPDATE agencies SET created_at = NOW() - make_interval(days => $2) WHERE id = $1`, [x.id, 30 - i * 5]);
  const l = (await q('SELECT id FROM properties WHERE agency_id = $1 LIMIT 1', [a.id])).rows[0].id;
  const reader = await member('lecteur');
  await q(`INSERT INTO reviews (property_id, author_id, rating, comment) VALUES ($1, $2, 5, 'Top')`, [l, reader.id]);
  return { a, b, c, d };
}
