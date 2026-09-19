// Circuit de modération : visibilité selon le rôle, décisions admin, resoumission, contournements.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, owner, other, admin, trusted;
const listing = (title, extra = {}) => ({
  title, description: 'Annonce de test', mode: 'vente', type_bien: 'appartement',
  price: 12000000, wilaya: 'Oran', surface_m2: 80, rooms: 3, photos: [], features: [], ...extra,
});
const create = async (who, title) => (await s.request('POST', '/api/properties', { token: who.token, body: listing(title) }));

test.before(async () => {
  s = await startServer();
  owner = await s.register('owner');
  other = await s.register('other');
  admin = await s.makeAdmin(await s.register('admin'));
  // Propriétaire d'une agence vérifiée : publie sans validation
  trusted = await s.register('agence');
  await s.db.pool.query('INSERT INTO agencies (owner_id, name, verified) VALUES ($1, $2, true)', [trusted.id, 'Agence de test']);
});
test.after(async () => { await s.stop(); });

test('une annonce d\'un utilisateur ordinaire est créée « pending »', async () => {
  const r = await create(owner, 'Annonce en attente');
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'pending');
});

test('pending : invisible du public et des autres utilisateurs, visible du propriétaire et des admins', async () => {
  const { body: { id } } = await create(owner, 'Visibilité pending');
  assert.equal((await s.request('GET', `/api/properties/${id}`)).status, 404);
  assert.equal((await s.request('GET', `/api/properties/${id}`, { token: other.token })).status, 404);
  assert.equal((await s.request('GET', `/api/properties/${id}`, { token: owner.token })).status, 200);
  assert.equal((await s.request('GET', `/api/properties/${id}`, { token: admin.token })).status, 200);

  const pub = await s.request('GET', '/api/properties?limit=200');
  assert.ok(!pub.body.data.some(p => p.id === id), 'absente de la liste publique');
  assert.equal((await s.request('GET', '/api/properties?status=pending')).status, 403, 'statut non public interdit aux anonymes');
  assert.equal((await s.request('GET', '/api/properties?status=pending', { token: owner.token })).status, 403);
  assert.ok((await s.request('GET', '/api/properties?status=pending', { token: admin.token })).body.data.some(p => p.id === id));

  const mine = await s.request('GET', `/api/properties/user/${owner.id}`, { token: owner.token });
  assert.ok(mine.body.some(p => p.id === id), 'le propriétaire voit son annonce');
  const theirs = await s.request('GET', `/api/properties/user/${owner.id}`);
  assert.ok(!theirs.body.some(p => p.id === id), 'le public ne la voit pas');

  assert.equal((await s.request('GET', `/api/properties/${id}/price-history`)).status, 404);
  assert.equal((await s.request('POST', '/api/contacts', { token: other.token, body: { property_id: id, type: 'info' } })).status, 404);
});

test('un propriétaire ne peut pas s\'auto-approuver', async () => {
  const { body: { id } } = await create(owner, 'Auto-approbation');
  const r = await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { status: 'active' } });
  assert.equal(r.status, 400);
  const admin404 = await s.request('PUT', `/api/admin/properties/${id}/moderate`, { token: owner.token, body: { decision: 'approve' } });
  assert.equal(admin404.status, 403);
  // archiver puis réactiver ne contourne pas non plus la validation
  assert.equal((await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { status: 'archived' } })).status, 200);
  assert.equal((await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { status: 'active' } })).status, 400);
});

test('refus : motif obligatoire, visible du propriétaire, annonce toujours invisible du public', async () => {
  const { body: { id } } = await create(owner, 'Annonce à refuser');
  const url = `/api/admin/properties/${id}/moderate`;
  assert.equal((await s.request('PUT', url, { token: admin.token, body: { decision: 'reject' } })).status, 400);
  assert.equal((await s.request('PUT', url, { token: admin.token, body: { decision: 'reject', reason: 'abcd' } })).status, 400, 'motif de 4 caractères refusé');
  assert.equal((await s.request('PUT', url, { token: admin.token, body: { decision: 'nimporte' } })).status, 400);
  const ok = await s.request('PUT', url, { token: admin.token, body: { decision: 'reject', reason: 'Photos non conformes' } });
  assert.equal(ok.body.status, 'rejected');

  const mine = (await s.request('GET', `/api/properties/user/${owner.id}`, { token: owner.token })).body.find(p => p.id === id);
  assert.equal(mine.status, 'rejected');
  assert.equal(mine.moderation_reason, 'Photos non conformes');
  assert.equal((await s.request('GET', `/api/properties/${id}`)).status, 404);
  assert.equal((await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { status: 'active' } })).status, 400);
});

test('corriger une annonce refusée la renvoie en validation, puis l\'admin l\'approuve', async () => {
  const { body: { id } } = await create(owner, 'Annonce à corriger');
  const mod = `/api/admin/properties/${id}/moderate`;
  await s.request('PUT', mod, { token: admin.token, body: { decision: 'reject', reason: 'Description insuffisante' } });

  const fix = await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { description: 'Description complète et détaillée' } });
  assert.equal(fix.body.status, 'pending');
  assert.ok((await s.request('GET', '/api/admin/moderation', { token: admin.token })).body.items.some(p => p.id === id));

  const approved = await s.request('PUT', mod, { token: admin.token, body: { decision: 'approve' } });
  assert.equal(approved.body.status, 'active');
  const pub = await s.request('GET', `/api/properties/${id}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.moderation_reason, null, 'le motif de refus est effacé');
  assert.ok((await s.request('GET', '/api/properties?limit=200')).body.data.some(p => p.id === id));
});

test('annonce active : modifier le contenu la remet en attente, pas le prix', async () => {
  const { body: { id } } = await create(owner, 'Annonce active');
  await s.request('PUT', `/api/admin/properties/${id}/moderate`, { token: admin.token, body: { decision: 'approve' } });

  const price = await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { price: 11000000 } });
  assert.equal(price.body.status, 'active');
  const title = await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { title: 'Nouveau titre' } });
  assert.equal(title.body.status, 'pending');
  assert.equal((await s.request('GET', `/api/properties/${id}`)).status, 404, 'plus visible tant que non revalidée');
});

test('admin et agence vérifiée publient directement, sans se remettre en attente', async () => {
  const a = await create(trusted, 'Annonce agence');
  assert.equal(a.body.status, 'active');
  const edit = await s.request('PUT', `/api/properties/${a.body.id}`, { token: trusted.token, body: { title: 'Titre modifié par l\'agence' } });
  assert.equal(edit.body.status, 'active');
  assert.equal((await create(admin, 'Annonce admin')).body.status, 'active');
});

test('la file de modération est réservée aux admins et remonte les compteurs', async () => {
  assert.equal((await s.request('GET', '/api/admin/moderation', { token: owner.token })).status, 403);
  const r = await s.request('GET', '/api/admin/moderation', { token: admin.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.ok(r.body.counts.pending >= 1);
  assert.ok(r.body.items.every(p => p.status === 'pending'));
  assert.equal((await s.request('PUT', '/api/admin/properties/999999/moderate', { token: admin.token, body: { decision: 'approve' } })).status, 404);
});

test('MODERATION=off : publication directe pour tous', async () => {
  process.env.MODERATION = 'off';
  try {
    assert.equal((await create(owner, 'Sans modération')).body.status, 'active');
  } finally { process.env.MODERATION = 'on'; }
});

test('l\'approbation date la publication (alertes email)', async () => {
  const { body: { id } } = await create(owner, 'Date de publication');
  const before = (await s.db.pool.query('SELECT published_at FROM properties WHERE id = $1', [id])).rows[0];
  assert.equal(before.published_at, null);
  await s.request('PUT', `/api/admin/properties/${id}/moderate`, { token: admin.token, body: { decision: 'approve' } });
  const after = (await s.db.pool.query('SELECT published_at, moderated_by FROM properties WHERE id = $1', [id])).rows[0];
  assert.ok(after.published_at);
  assert.equal(after.moderated_by, admin.id);
});
