// Routes de données (messages, favoris, agences, avis, demandes de contact, statistiques, comptes, admin) :
// tests de non-régression écrits AVANT le remplacement des requêtes qui chargeaient des tables entières.
// Ils fixent le comportement observable (réponses, codes HTTP, effets en base) ; les horodatages sont
// posés explicitement en SQL pour que les tris soient déterministes.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, admin;
const q = (sql, params) => s.db.pool.query(sql, params);
const at = (table, id, iso) => q(`UPDATE ${table} SET created_at = $1 WHERE id = $2`, [iso, id]);

test.before(async () => {
  s = await startServer();
  admin = await s.makeAdmin(await s.register('admin'));
});
test.after(async () => { await s.stop(); });

// Annonce publiée (créée par un admin : publication directe)
async function listing(title = 'Annonce de test', extra = {}) {
  const r = await s.request('POST', '/api/properties', { token: admin.token, body: {
    title, mode: 'vente', type_bien: 'appartement', price: 10000000, wilaya: 'Oran', photos: [], ...extra } });
  assert.equal(r.status, 201);
  return r.body.id;
}

// ── Messagerie ───────────────────────────────────────────────────────────────
test('messagerie : envoi, conversations, fil de discussion, lu / non lu', async () => {
  // A est l'annonceur : B et C lui écrivent, A répond à B
  const [a, b, c] = [await s.register('a'), await s.register('b'), await s.register('c')];
  const p = await listing('Bien de la messagerie');
  await q('UPDATE properties SET owner_id = $1 WHERE id = $2', [a.id, p]);
  const send = (from, to, body) => s.request('POST', '/api/messages', { token: from.token, body: { to_id: to.id, property_id: p, body } });
  const m1 = await send(b, a, 'Bonjour A');
  const m2 = await send(b, a, 'Toujours disponible ?');
  const m3 = await send(a, b, 'Oui, disponible');
  const m4 = await send(c, a, 'Salut A, je suis C');
  for (const m of [m1, m2, m3, m4]) assert.equal(m.status, 201);
  await at('messages', m1.body.id, '2026-05-01T10:00:00Z'); await at('messages', m2.body.id, '2026-05-01T10:05:00Z');
  await at('messages', m3.body.id, '2026-05-01T10:10:00Z'); await at('messages', m4.body.id, '2026-05-01T11:00:00Z');

  const convs = (await s.request('GET', '/api/messages', { token: a.token })).body;
  assert.equal(convs.length, 2, 'une conversation par interlocuteur et par annonce');
  assert.equal(convs[0].other_id, c.id, 'la plus récente d\'abord');
  assert.equal(convs[0].last_msg, 'Salut A, je suis C');
  assert.equal(convs[0].unread, 1);
  assert.equal(convs[1].other_id, b.id);
  assert.equal(convs[1].last_msg, 'Oui, disponible');
  assert.equal(convs[1].unread, 2, 'les deux messages de B à A sont non lus');
  assert.equal(convs[1].property_id, p);
  assert.equal(convs[1].property_title, 'Bien de la messagerie');
  assert.equal(convs[1].other_name, 'Test b');
  assert.equal(convs[1].key, `${p}-${b.id}`);
  assert.ok(convs[1].last_at, 'date du dernier message');

  const bConvs = (await s.request('GET', '/api/messages', { token: b.token })).body;
  assert.equal(bConvs.length, 1);
  assert.equal(bConvs[0].unread, 1, 'B a un message non lu de A');
  assert.equal((await s.request('GET', '/api/messages/unread-count', { token: b.token })).body.count, 1);
  assert.equal((await s.request('GET', '/api/messages/unread-count', { token: a.token })).body.count, 3);

  const thread = await s.request('GET', `/api/messages/${p}/${b.id}`, { token: a.token });
  assert.deepEqual(thread.body.thread.map(m => m.body), ['Bonjour A', 'Toujours disponible ?', 'Oui, disponible'], 'ordre chronologique');
  assert.deepEqual(thread.body.other, { id: b.id, name: 'Test b' });
  assert.equal(thread.body.property.id, p);
  assert.equal(thread.body.property.title, 'Bien de la messagerie');
  assert.equal((await s.request('GET', '/api/messages/unread-count', { token: a.token })).body.count, 1, 'le fil est marqué lu (C reste non lu)');
  assert.equal((await s.request('GET', '/api/messages/unread-count', { token: b.token })).body.count, 1, 'le message de A à B reste non lu');
  const stranger = await s.request('GET', `/api/messages/${p}/${a.id}`, { token: c.token });
  assert.deepEqual(stranger.body.thread.map(m => m.body), ['Salut A, je suis C'], 'C ne voit que ses propres échanges avec A');
});

test('messagerie : un premier message ne va qu\'à l\'annonceur ; on répond ensuite dans le fil', async () => {
  const [owner, visitor, third, banned] = [await s.register('m-owner'), await s.register('m-visitor'), await s.register('m-third'), await s.register('m-banned')];
  const p = await listing('Bien contactable');
  await q('UPDATE properties SET owner_id = $1 WHERE id = $2', [owner.id, p]);
  await q('UPDATE users SET banned = true WHERE id = $1', [banned.id]);
  const send = (from, to_id, property_id, body = 'Bonjour') => s.request('POST', '/api/messages', { token: from.token, body: { to_id, property_id, body } });
  const REFUS = 'Vous ne pouvez écrire qu\'à l\'annonceur, ou répondre à une personne qui vous a écrit.';

  // Un visiteur ne peut pas écrire à un autre membre à propos d'une annonce qui n'est pas la sienne
  const toThird = await send(visitor, third.id, p);
  assert.equal(toThird.status, 403);
  assert.equal(toThird.body.error, REFUS);
  const ar = await s.request('POST', '/api/messages', { token: visitor.token, headers: { 'X-Lang': 'ar' }, body: { to_id: third.id, property_id: p, body: 'x' } });
  assert.match(ar.body.error, /[؀-ۿ]/, 'refus traduit');
  // L'annonceur ne peut pas non plus écrire à quelqu'un qui ne l'a jamais contacté
  assert.equal((await send(owner, third.id, p)).status, 403);
  // Destinataire inexistant ou suspendu : introuvable (aucun email envoyé)
  assert.equal((await send(visitor, 999999, p)).status, 404);
  assert.equal((await send(visitor, 'abc', p)).status, 404);
  assert.equal((await send(visitor, banned.id, p)).status, 404);
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM messages WHERE property_id = $1', [p])).rows[0].n, 0, 'rien n\'a été enregistré');

  // Visiteur → annonceur : premier contact autorisé ; l'annonceur répond ; le visiteur relance
  assert.equal((await send(visitor, owner.id, p, 'Toujours disponible ?')).status, 201);
  assert.equal((await send(owner, visitor.id, p, 'Oui')).status, 201);
  assert.equal((await send(visitor, owner.id, p, 'Je passe demain')).status, 201);
  // Le fil ne vaut que pour cette annonce : sur une autre annonce, le visiteur reste un inconnu pour un tiers
  const p2 = await listing('Autre bien');
  assert.equal((await send(visitor, third.id, p2)).status, 403);

  // Une demande de contact permet à l'annonceur d'écrire le premier
  assert.equal((await s.request('POST', '/api/contacts', { token: third.token, body: { property_id: p, type: 'info' } })).status, 201);
  assert.equal((await send(owner, third.id, p, 'Merci pour votre demande')).status, 201);
  assert.equal((await send(third, owner.id, p, 'Avec plaisir')).status, 201);

  // Annonce en attente de modération : l'annonceur n'est pas encore joignable par un inconnu
  const pending = await s.request('POST', '/api/properties', { token: owner.token, body: {
    title: 'Bien en attente', mode: 'vente', type_bien: 'appartement', price: 10000000, wilaya: 'Oran', photos: [] } });
  assert.equal(pending.body.status, 'pending');
  assert.equal((await send(visitor, owner.id, pending.body.id)).status, 403);
  // Annonce archivée : plus de premier contact, mais un fil existant continue
  await q(`UPDATE properties SET status = 'archived' WHERE id = $1`, [p]);
  assert.equal((await send(third, owner.id, p, 'Encore dispo ?')).status, 201, 'fil existant');
  const newcomer = await s.register('m-newcomer');
  assert.equal((await send(newcomer, owner.id, p)).status, 403, 'premier contact sur une annonce archivée');
});

test('messagerie : validations', async () => {
  const [a, b] = [await s.register('v1'), await s.register('v2')];
  const p = await listing();
  const post = body => s.request('POST', '/api/messages', { token: a.token, body });
  assert.equal((await post({ to_id: b.id, property_id: p, body: '   ' })).status, 400);
  assert.equal((await post({ property_id: p, body: 'x' })).status, 400);
  assert.equal((await post({ to_id: a.id, property_id: p, body: 'x' })).status, 400, 'pas de message à soi-même');
  assert.equal((await post({ to_id: b.id, property_id: 999999, body: 'x' })).status, 404);
  assert.equal((await post({ to_id: b.id, property_id: p, body: 'x'.repeat(2001) })).status, 400);
  assert.equal((await s.request('GET', '/api/messages')).status, 401);
});

// ── Favoris ──────────────────────────────────────────────────────────────────
test('favoris : ajout, doublon, liste, vérification, suppression', async () => {
  const u = await s.register('fav');
  const p1 = await listing('Favori 1'), p2 = await listing('Favori 2');
  const add = id => s.request('POST', '/api/favorites', { token: u.token, body: { property_id: id } });
  assert.equal((await add(p1)).status, 201);
  assert.equal((await add(p2)).status, 201);
  assert.equal((await add(p1)).status, 409);
  assert.equal((await s.request('POST', '/api/favorites', { token: u.token, body: {} })).status, 400);
  assert.equal((await add(999999)).status, 404);

  const list = (await s.request('GET', '/api/favorites', { token: u.token })).body;
  assert.deepEqual(list.map(f => f.title), ['Favori 1', 'Favori 2'], 'ordre d\'ajout');
  assert.ok(list.every(f => f.fav_id && f.id && f.price), 'champs de l\'annonce + fav_id');
  assert.equal((await s.request('GET', `/api/favorites/check/${p1}`, { token: u.token })).body.is_favorite, true);
  await s.request('DELETE', `/api/favorites/${p1}`, { token: u.token });
  assert.equal((await s.request('GET', `/api/favorites/check/${p1}`, { token: u.token })).body.is_favorite, false);
  assert.equal((await s.request('GET', '/api/favorites', { token: u.token })).body.length, 1);
  const other = await s.register('fav2');
  assert.equal((await s.request('GET', '/api/favorites', { token: other.token })).body.length, 0, 'favoris privés');
});

// ── Agences ──────────────────────────────────────────────────────────────────
test('agences : création, unicité, fiche avec annonces actives, modification, agence du compte', async () => {
  const o = await s.register('ag'), other = await s.register('ag2');
  assert.equal((await s.request('POST', '/api/agencies', { token: o.token, body: { name: 'Sans wilaya' } })).status, 400);
  const created = await s.request('POST', '/api/agencies', { token: o.token, body: { name: '  Agence Test  ', wilaya: 'Oran', phone: '0550123456', description: 'Desc' } });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await s.request('POST', '/api/agencies', { token: o.token, body: { name: 'Bis', wilaya: 'Alger' } })).status, 409);
  assert.equal((await q('SELECT is_agent FROM users WHERE id = $1', [o.id])).rows[0].is_agent, true);

  // 14 annonces actives + 1 archivée rattachées à l'agence
  const ids = [];
  for (let i = 0; i < 15; i++) ids.push(await listing(`Agence bien ${i}`));
  await q('UPDATE properties SET agency_id = $1 WHERE id = ANY($2)', [id, ids]);
  await q(`UPDATE properties SET status = 'archived' WHERE id = $1`, [ids[0]]);
  const fiche = (await s.request('GET', `/api/agencies/${id}`)).body;
  assert.equal(fiche.name, 'Agence Test', 'nom nettoyé');
  assert.equal(fiche.property_count, 14, 'seules les annonces actives sont comptées');
  // Les annonces de l'agence se lisent par la liste des annonces (filtre agency_id), paginée
  const lots = (await s.request('GET', `/api/properties?agency_id=${id}&limit=12`)).body;
  assert.equal(lots.total, 14); assert.equal(lots.data.length, 12, 'douze annonces par page');
  assert.ok(lots.data.every(p => p.status === 'active'));
  assert.equal((await s.request('GET', '/api/agencies/999999')).status, 404);
  const listed = (await s.request('GET', '/api/agencies')).body.items.find(a => a.id === id);
  assert.equal(listed.property_count, 14);

  assert.equal((await s.request('PUT', `/api/agencies/${id}`, { token: other.token, body: { phone: '0661234567' } })).status, 403);
  assert.equal((await s.request('PUT', `/api/agencies/${id}`, { token: o.token, body: { phone: '0661234567', website: '' } })).status, 200);
  assert.equal((await s.request('PUT', `/api/agencies/${id}`, { token: admin.token, body: { description: 'Par admin' } })).status, 200);
  const after = (await s.request('GET', `/api/agencies/${id}`)).body;
  assert.equal(after.phone, '0661234567'); assert.equal(after.website, null); assert.equal(after.description, 'Par admin');

  assert.equal((await s.request('GET', '/api/agencies/mine/info', { token: o.token })).body.id, id);
  assert.equal((await s.request('GET', '/api/agencies/mine/info', { token: other.token })).status, 404);
});

// ── Demandes de contact et avis ──────────────────────────────────────────────
test('demandes de contact : listes envoyées / reçues, changement de statut, annulation', async () => {
  const owner = await s.makeAdmin(await s.register('proprio'));
  const r1 = await s.register('dem1'), r2 = await s.register('dem2');
  const p1 = await s.request('POST', '/api/properties', { token: owner.token, body: { title: 'Bien contacté 1', mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Oran', image: '/uploads/x.jpg', photos: ['/uploads/x.jpg'] } });
  const p2 = await s.request('POST', '/api/properties', { token: owner.token, body: { title: 'Bien contacté 2', mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Oran', photos: [] } });
  const c1 = await s.request('POST', '/api/contacts', { token: r1.token, body: { property_id: p1.body.id, type: 'info', message: 'Un' } });
  const c2 = await s.request('POST', '/api/contacts', { token: r2.token, body: { property_id: p2.body.id, type: 'visite', visit_date: '2026-12-01' } });
  await at('contact_requests', c1.body.id, '2026-05-01T10:00:00Z'); await at('contact_requests', c2.body.id, '2026-05-02T10:00:00Z');

  const received = (await s.request('GET', '/api/contacts/received', { token: owner.token })).body.filter(c => [c1.body.id, c2.body.id].includes(c.id));
  assert.deepEqual(received.map(c => c.id), [c2.body.id, c1.body.id], 'plus récente d\'abord');
  assert.equal(received[0].requester_name, 'Test dem2');
  assert.equal(received[0].property_title, 'Bien contacté 2');
  assert.equal(received[1].property_image, '/uploads/x.jpg');
  assert.equal(received[1].message, 'Un');
  assert.ok('requester_phone' in received[0]);
  const mine = (await s.request('GET', '/api/contacts/mine', { token: r1.token })).body;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].property_title, 'Bien contacté 1');
  assert.equal((await s.request('GET', '/api/contacts/received', { token: r1.token })).body.length, 0, 'un demandeur ne reçoit rien');

  const status = (who, id, st) => s.request('PUT', `/api/contacts/${id}/status`, { token: who.token, body: { status: st } });
  assert.equal((await status(r1, c1.body.id, 'confirmed')).status, 403, 'seul le propriétaire décide');
  assert.equal((await status(owner, 999999, 'confirmed')).status, 404);
  assert.equal((await status(owner, c1.body.id, 'nimporte')).status, 400);
  assert.equal((await status(owner, c1.body.id, 'confirmed')).status, 200);
  assert.equal((await s.request('GET', '/api/contacts/mine', { token: r1.token })).body[0].status, 'confirmed');

  assert.equal((await s.request('DELETE', `/api/contacts/${c1.body.id}`, { token: r2.token })).status, 403);
  assert.equal((await s.request('DELETE', `/api/contacts/${c1.body.id}`, { token: r1.token })).status, 200);
  assert.equal((await s.request('GET', '/api/contacts/mine', { token: r1.token })).body.length, 0);
});

test('avis : contact confirmé requis, moyenne, doublon, affichage avec auteurs', async () => {
  const owner = await s.makeAdmin(await s.register('proprio-avis'));
  const [r1, r2] = [await s.register('avis1'), await s.register('avis2')];
  const p = (await s.request('POST', '/api/properties', { token: owner.token, body: { title: 'Bien noté', mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Oran', photos: [] } })).body.id;
  const review = (who, rating, comment = 'ok') => s.request('POST', `/api/properties/${p}/reviews`, { token: who.token, body: { rating, comment } });

  assert.equal((await review(r1, 0)).status, 400);
  assert.equal((await review(r1, 6)).status, 400);
  assert.equal((await review(r1, 5)).status, 403, 'aucun contact');
  const c1 = await s.request('POST', '/api/contacts', { token: r1.token, body: { property_id: p, type: 'info' } });
  assert.equal((await review(r1, 5)).status, 403, 'contact seulement en attente');
  await s.request('PUT', `/api/contacts/${c1.body.id}/status`, { token: owner.token, body: { status: 'confirmed' } });
  assert.equal((await review(r1, 5, 'Excellent')).status, 201);
  assert.equal((await review(r1, 3)).status, 409, 'un seul avis par personne');
  const c2 = await s.request('POST', '/api/contacts', { token: r2.token, body: { property_id: p, type: 'info' } });
  await s.request('PUT', `/api/contacts/${c2.body.id}/status`, { token: owner.token, body: { status: 'done' } });
  assert.equal((await review(r2, 4, 'Bien')).status, 201);

  const rows = (await q('SELECT id, comment FROM reviews WHERE property_id = $1 ORDER BY id', [p])).rows;
  await at('reviews', rows[0].id, '2026-05-01T10:00:00Z'); await at('reviews', rows[1].id, '2026-05-02T10:00:00Z');
  const detail = (await s.request('GET', `/api/properties/${p}`)).body;
  assert.equal(Number(detail.rating), 4.5);
  assert.deepEqual(detail.reviews.map(r => r.comment), ['Bien', 'Excellent'], 'avis récents d\'abord');
  assert.equal(detail.reviews[0].author_name, 'Test avis2');
  assert.equal((await q('SELECT reviews FROM properties WHERE id = $1', [p])).rows[0].reviews, 2, 'compteur d\'avis en base');
});

// ── Statistiques et profils ──────────────────────────────────────────────────
test('statistiques du propriétaire (stats/me) et globales (stats)', async () => {
  const beforeAll = (await s.request('GET', '/api/stats', { token: admin.token })).body;
  const o = await s.register('stats'), req = await s.register('stats-req');
  const ids = [];
  for (const title of ['S1', 'S2', 'S3']) ids.push((await s.request('POST', '/api/properties', { token: o.token, body: { title, mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Oran', photos: [] } })).body.id);
  // S1, S2 publiées ; S3 reste en attente ; vues posées en base
  for (const id of ids.slice(0, 2)) await s.request('PUT', `/api/admin/properties/${id}/moderate`, { token: admin.token, body: { decision: 'approve' } });
  await q('UPDATE properties SET views = 10 WHERE id = $1', [ids[0]]); await q('UPDATE properties SET views = 5 WHERE id = $1', [ids[1]]);
  const c1 = await s.request('POST', '/api/contacts', { token: req.token, body: { property_id: ids[0], type: 'info' } });
  await s.request('POST', '/api/contacts', { token: req.token, body: { property_id: ids[1], type: 'info' } });
  await s.request('PUT', `/api/contacts/${c1.body.id}/status`, { token: o.token, body: { status: 'confirmed' } });

  assert.deepEqual((await s.request('GET', '/api/stats/me', { token: o.token })).body,
    { properties: 3, active: 2, contacts: 2, pending: 1, total_views: 15, calls: 0, whatsapps: 0, calls_30d: 0, whatsapps_30d: 0 });
  assert.deepEqual((await s.request('GET', '/api/stats/me', { token: req.token })).body,
    { properties: 0, active: 0, contacts: 0, pending: 0, total_views: 0, calls: 0, whatsapps: 0, calls_30d: 0, whatsapps_30d: 0 });

  const afterAll = (await s.request('GET', '/api/stats', { token: admin.token })).body;
  const delta = k => afterAll[k] - beforeAll[k];
  assert.equal(delta('users'), 2); assert.equal(delta('properties'), 3); assert.equal(delta('active'), 2);
  assert.equal(delta('pending_props'), 1); assert.equal(delta('contacts'), 2); assert.equal(delta('pending_contacts'), 1);
  assert.equal(delta('sold'), 0); assert.equal(delta('rented'), 0);
});

test('profil public : compteur d\'annonces actives seulement', async () => {
  const o = await s.register('public');
  const mk = title => s.request('POST', '/api/properties', { token: o.token, body: { title, mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Oran', photos: [] } });
  const a = (await mk('P1')).body.id; await mk('P2');
  await s.request('PUT', `/api/admin/properties/${a}/moderate`, { token: admin.token, body: { decision: 'approve' } });
  const p = (await s.request('GET', `/api/auth/users/${o.id}`)).body;
  assert.equal(p.property_count, 1);
  assert.deepEqual(Object.keys(p).sort(), ['avatar', 'bio', 'created_at', 'id', 'is_agent', 'name', 'property_count', 'verified_kind']);
  assert.equal((await s.request('GET', '/api/auth/users/999999')).status, 404);
});

// ── Comptes : vérification email, profil, mot de passe, suppression ─────────
test('vérification d\'email par lien', async () => {
  const u = await s.register('verif');
  const token = (await q('SELECT verification_token FROM users WHERE id = $1', [u.id])).rows[0].verification_token;
  assert.ok(token);
  const ok = await s.request('GET', `/api/auth/verify-email?token=${token}`);
  assert.equal(ok.status, 302); assert.equal(ok.headers.get('location'), '/?verify=ok');
  const row = (await q('SELECT email_verified, verification_token FROM users WHERE id = $1', [u.id])).rows[0];
  assert.equal(row.email_verified, true); assert.equal(row.verification_token, null);
  assert.equal((await s.request('GET', `/api/auth/verify-email?token=${token}`)).headers.get('location'), '/?verify=invalid', 'lien à usage unique');
  assert.equal((await s.request('GET', '/api/auth/verify-email')).headers.get('location'), '/?verify=invalid');
});

test('profil : modification, aucun champ, réinitialisation du mot de passe, suppression du compte', async () => {
  const u = await s.register('profil');
  assert.equal((await s.request('PUT', '/api/auth/profile', { token: u.token, body: {} })).status, 400);
  const up = await s.request('PUT', '/api/auth/profile', { token: u.token, body: { name: '  Nouveau Nom ', phone: ' 0550 ', bio: ' Ma bio ' } });
  assert.equal(up.status, 200);
  assert.equal(up.body.name, 'Nouveau Nom'); assert.equal(up.body.phone, '0550'); assert.equal(up.body.bio, 'Ma bio');
  assert.doesNotMatch(up.text, /password/);
  assert.equal((await s.request('GET', '/api/auth/me', { token: u.token })).body.name, 'Nouveau Nom');

  // mot de passe oublié : réponse identique pour un compte inconnu (anti-énumération)
  assert.deepEqual((await s.request('POST', '/api/auth/forgot-password', { body: { email: 'inconnu@test.dz' } })).body, { ok: true });
  await s.request('POST', '/api/auth/forgot-password', { body: { email: u.email } });
  const token = (await q('SELECT token FROM password_reset_tokens WHERE user_id = $1', [u.id])).rows[0].token;
  assert.equal((await s.request('POST', '/api/auth/reset-password', { body: { token, password: '123' } })).status, 400);
  assert.equal((await s.request('POST', '/api/auth/reset-password', { body: { token: 'faux', password: 'nouveaumdp1' } })).status, 400);
  assert.equal((await s.request('POST', '/api/auth/reset-password', { body: { token, password: 'nouveaumdp1' } })).status, 200);
  assert.equal((await s.request('POST', '/api/auth/reset-password', { body: { token, password: 'autremdp12' } })).status, 400, 'lien à usage unique');
  assert.equal((await s.request('POST', '/api/auth/login', { body: { email: u.email, password: 'motdepasse1' } })).status, 401);
  const relog = await s.request('POST', '/api/auth/login', { body: { email: u.email, password: 'nouveaumdp1' } });
  assert.equal(relog.status, 200);
  const fresh = relog.body.token;   // la réinitialisation révoque les sessions précédentes : on repart de la nouvelle connexion

  // suppression du compte : le compte et ses annonces disparaissent
  await s.request('POST', '/api/properties', { token: fresh, body: { title: 'À supprimer', mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Oran', photos: [] } });
  assert.equal((await s.request('DELETE', '/api/auth/me', { token: fresh })).status, 200);
  assert.equal((await q('SELECT COUNT(*)::int c FROM users WHERE id = $1', [u.id])).rows[0].c, 0);
  assert.equal((await q('SELECT COUNT(*)::int c FROM properties WHERE owner_id = $1', [u.id])).rows[0].c, 0);
  assert.equal((await s.request('POST', '/api/auth/login', { body: { email: u.email, password: 'nouveaumdp1' } })).status, 401);
});

// ── Administration ───────────────────────────────────────────────────────────
test('administration : comptes (liste sans mot de passe, suspension) et droits', async () => {
  const u = await s.register('adm-user');
  const list = await s.request('GET', '/api/admin/users', { token: admin.token });
  assert.equal(list.status, 200);
  const me = list.body.items.find(x => x.id === u.id);
  assert.equal(me.email, u.email);
  assert.doesNotMatch(list.text, /password|\$2[aby]\$/, 'aucun mot de passe dans la liste');
  assert.equal((await s.request('GET', '/api/admin/users', { token: u.token })).status, 403);

  assert.equal((await s.request('PUT', `/api/admin/users/${u.id}/ban`, { token: admin.token, body: { banned: true } })).status, 200);
  assert.equal((await s.request('POST', '/api/auth/login', { body: { email: u.email, password: 'motdepasse1' } })).status, 403);
  assert.equal((await s.request('GET', '/api/auth/me', { token: u.token })).status, 403);
  await s.request('PUT', `/api/admin/users/${u.id}/ban`, { token: admin.token, body: { banned: false } });
  assert.equal((await s.request('POST', '/api/auth/login', { body: { email: u.email, password: 'motdepasse1' } })).status, 200);
});

test('administration : annonces (filtre par statut, statut, vérification, suppression) et agences', async () => {
  const o = await s.register('adm-prop');
  const pending = (await s.request('POST', '/api/properties', { token: o.token, body: { title: 'Admin en attente', mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Oran', photos: [] } })).body.id;
  const active = await listing('Admin active');
  const byStatus = async st => (await s.request('GET', `/api/admin/properties?per_page=100&status=${st}`, { token: admin.token })).body.items.map(p => p.id);
  assert.ok((await byStatus('pending')).includes(pending) && !(await byStatus('pending')).includes(active));
  assert.ok((await byStatus('active')).includes(active) && !(await byStatus('active')).includes(pending));
  assert.ok((await s.request('GET', '/api/admin/properties?per_page=100', { token: admin.token })).body.items.some(p => p.id === pending), 'sans filtre : tout');

  assert.equal((await s.request('PUT', `/api/admin/properties/${active}/status`, { token: admin.token, body: { status: 'sold' } })).status, 200);
  assert.equal((await s.request('PUT', `/api/admin/properties/${active}/status`, { token: admin.token, body: { status: 'bizarre' } })).status, 400);
  assert.ok((await byStatus('sold')).includes(active));
  await s.request('PUT', `/api/admin/properties/${pending}/status`, { token: admin.token, body: { status: 'active' } });
  const row = (await q('SELECT status, published_at, moderation_reason FROM properties WHERE id = $1', [pending])).rows[0];
  assert.equal(row.status, 'active'); assert.ok(row.published_at, 'publication datée');
  await s.request('PUT', `/api/admin/properties/${pending}/verify`, { token: admin.token });
  assert.equal((await q('SELECT verified FROM properties WHERE id = $1', [pending])).rows[0].verified, true);
  assert.equal((await s.request('DELETE', `/api/admin/properties/${pending}`, { token: admin.token })).status, 200);
  assert.equal((await s.request('GET', `/api/properties/${pending}`)).status, 404);

  const ag = await s.request('POST', '/api/agencies', { token: o.token, body: { name: 'Agence admin', wilaya: 'Blida' } });
  const agencies = (await s.request('GET', '/api/admin/agencies?per_page=100', { token: admin.token })).body.items;
  assert.equal(agencies.find(a => a.id === ag.body.id).verified, false);
  await s.request('PUT', `/api/admin/agencies/${ag.body.id}/verify`, { token: admin.token });
  assert.equal((await q('SELECT verified FROM agencies WHERE id = $1', [ag.body.id])).rows[0].verified, true);
});

test('signalements : dépôt, liste admin, résolution', async () => {
  const u = await s.register('signal');
  const p = await listing('Bien signalé');
  assert.equal((await s.request('POST', `/api/properties/${p}/signaler`, { token: u.token, body: {} })).status, 400);
  assert.equal((await s.request('POST', `/api/properties/${p}/signaler`, { token: u.token, body: { motif: 'Arnaque', message: 'Prix trop bas' } })).status, 200);
  const list = (await s.request('GET', '/api/admin/signalements', { token: admin.token })).body.items;
  const sig = list.find(x => x.property_id === p);
  assert.equal(sig.property_title, 'Bien signalé'); assert.equal(sig.reporter_name, 'Test signal'); assert.equal(sig.status, 'pending');
  assert.equal((await s.request('PUT', `/api/admin/signalements/${sig.id}/resolve`, { token: admin.token, body: { status: 'nimporte' } })).status, 400);
  assert.equal((await s.request('PUT', `/api/admin/signalements/999999/resolve`, { token: admin.token, body: { status: 'resolved' } })).status, 404);
  assert.equal((await s.request('PUT', `/api/admin/signalements/${sig.id}/resolve`, { token: admin.token, body: { status: 'dismissed' } })).status, 200);
  assert.equal((await q('SELECT status FROM signalements WHERE id = $1', [sig.id])).rows[0].status, 'dismissed');
});

// ── Fiche d'annonce ──────────────────────────────────────────────────────────
test('fiche d\'annonce : compteur de vues, identifiants invalides, historique de prix, photos', async () => {
  const o = await s.register('fiche');
  const p = await listing('Fiche vues');
  const views = async () => (await q('SELECT views FROM properties WHERE id = $1', [p])).rows[0].views;
  const v0 = await views();
  await s.request('GET', `/api/properties/${p}`); await s.request('GET', `/api/properties/${p}`);
  assert.equal(await views(), v0 + 2, 'chaque consultation publique compte une vue');
  for (const bad of ['abc', '0', '-5', '1.5']) assert.equal((await s.request('GET', `/api/properties/${bad}`)).status, 404, `id ${bad}`);
  assert.equal((await s.request('GET', '/api/properties/999999')).status, 404);

  await s.request('PUT', `/api/properties/${p}`, { token: admin.token, body: { price: 12000000 } });
  const history = (await s.request('GET', `/api/properties/${p}/price-history`)).body;
  assert.deepEqual(history.map(h => Number(h.price)), [10000000, 12000000]);

  const mine = (await s.request('POST', '/api/properties', { token: o.token, body: { title: 'Photos', mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Oran', photos: ['/uploads/a.jpg'] } })).body.id;
  const own = await s.request('POST', `/api/properties/${mine}/photos`, { token: o.token, body: { url: '/uploads/b.jpg' } });
  assert.deepEqual(own.body.photos, ['/uploads/a.jpg', '/uploads/b.jpg']);
  assert.equal((await s.request('POST', `/api/properties/${mine}/photos`, { token: admin.token, body: { url: '/uploads/c.jpg' } })).status, 403, 'seul le propriétaire ajoute une photo');
  assert.equal((await s.request('POST', `/api/properties/${mine}/photos`, { token: o.token, body: {} })).status, 400);
  const del = await s.request('DELETE', `/api/properties/${mine}/photos`, { token: o.token, body: { url: '/uploads/a.jpg' } });
  assert.deepEqual(del.body.photos, ['/uploads/b.jpg']);
});

test('identifiants absurdes dans l\'URL : « introuvable », jamais une erreur 500', async () => {
  const u = await s.register('id-absurde');
  const before = (await q('SELECT COUNT(*)::int AS n FROM signalements')).rows[0].n;
  for (const bad of ['abc', '0', '-3', '1.5', '1e30', '99999999999', '%27', 'NaN']) {
    const routes = [
      ['GET',    `/api/properties/${bad}/price-history`],
      ['POST',   `/api/properties/${bad}/signaler`, { motif: 'Arnaque' }],
      ['GET',    `/api/properties/user/${bad}`],
      ['DELETE', `/api/alerts/${bad}`],
    ];
    for (const [method, url, body] of routes)
      assert.equal((await s.request(method, url, { token: u.token, body })).status, 404, `${method} ${url}`);
  }
  // Annonce inexistante : pas d'historique, pas de signalement orphelin dans la file des admins
  assert.equal((await s.request('GET', '/api/properties/999999/price-history')).status, 404);
  assert.equal((await s.request('POST', '/api/properties/999999/signaler', { token: u.token, body: { motif: 'Arnaque' } })).status, 404);
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM signalements')).rows[0].n, before);
  // Un compte sans annonce reste une liste vide
  assert.deepEqual((await s.request('GET', `/api/properties/user/${u.id}`)).body, []);

  // Signalement : annonce en attente invisible du signaleur, motif non textuel, texte borné
  const pending = (await s.request('POST', '/api/properties', { token: u.token, body: { title: 'À signaler', mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Oran', photos: [] } })).body.id;
  const other = await s.register('signaleur');
  assert.equal((await s.request('POST', `/api/properties/${pending}/signaler`, { token: other.token, body: { motif: 'Arnaque' } })).status, 404);
  const p = await listing('Annonce signalée');
  assert.equal((await s.request('POST', `/api/properties/${p}/signaler`, { token: other.token, body: { motif: { a: 1 } } })).status, 400);
  assert.equal((await s.request('POST', `/api/properties/${p}/signaler`, { token: other.token, body: { motif: 'm'.repeat(5000), message: 'x'.repeat(9000) } })).status, 200);
  const row = (await q('SELECT length(motif) AS m, length(message) AS t FROM signalements WHERE property_id = $1 AND user_id = $2', [p, other.id])).rows[0];
  assert.deepEqual(row, { m: 200, t: 2000 });
});

test('profil : l\'avatar n\'est qu\'un fichier envoyé sur le site ; un champ non textuel donne 400, pas 500', async () => {
  const u = await s.register('avatar');
  const put = body => s.request('PUT', '/api/auth/profile', { token: u.token, body });
  for (const avatar of ['https://exemple.com/a.jpg', 'javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', '/uploads/../secret.png',
    '/uploads/a.jpg" onerror="alert(1)', '//exemple.com/uploads/a.jpg', '/uploads/a.svg']) {
    const r = await put({ avatar });
    assert.equal(r.status, 400, avatar);
    assert.equal(r.body.error, 'Image invalide : envoyez-la depuis le formulaire.');
  }
  assert.equal((await put({ avatar: ' /uploads/moi-1.webp ' })).body.avatar, '/uploads/moi-1.webp');
  assert.equal((await s.request('GET', `/api/auth/users/${u.id}`)).body.avatar, '/uploads/moi-1.webp');
  assert.equal((await put({ avatar: '' })).body.avatar, '', 'vide : avatar retiré');
  for (const body of [{ name: 42 }, { phone: {} }, { bio: ['x'] }, { avatar: 7 }, { name: null }])
    assert.equal((await put(body)).status, 400, JSON.stringify(body));
  assert.equal((await put({ name: '  Nouveau nom ' })).body.name, 'Nouveau nom');

  // Migration 015 : même règle que server/images.js sur les avatars déjà enregistrés (rejouable, ne touche que le champ)
  const images = require('../../server/images');
  const samples = ['/uploads/ok.webp', '/uploads/OK_2.JPG', 'https://lh3.googleusercontent.com/a/AbC-d_e=s96-c', 'https://exemple.com/a.jpg',
    'javascript:alert(1)', 'https://lh3.googleusercontent.com@exemple.com/p', 'https://lh3.googleusercontent.com/a"x', '/uploads/a.svg',
    'https://lh3.googleusercontent.com/' + 'a'.repeat(600)];
  const ids = [];
  for (const avatar of samples) {
    const m = await s.register('avatar-mig');
    await q('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, m.id]);
    ids.push(m.id);
  }
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../server/migrations/015_clean_avatars.sql'), 'utf8');
  await q(sql); await q(sql);
  const kept = (await q('SELECT id, avatar FROM users WHERE id = ANY($1)', [ids])).rows;
  for (const [i, avatar] of samples.entries()) {
    const expected = images.isUpload(avatar) || images.isGoogleAvatar(avatar) ? avatar : null;
    assert.equal(kept.find(r => r.id === ids[i]).avatar, expected, avatar.slice(0, 60));
  }
  assert.equal(kept.filter(r => r.avatar).length, 3);
});

// ── Après le remplacement des requêtes « table entière » ─────────────────────
test('favoris : une annonce en attente ou refusée n\'est ni ajoutable ni listée', async () => {
  const u = await s.register('fav-cache');
  const visible = await listing('Favori visible');
  // Un simple utilisateur crée une annonce : en attente de modération, donc invisible du public
  const pending = (await s.request('POST', '/api/properties', { token: u.token, body: {
    title: 'Annonce en attente', mode: 'vente', type_bien: 'villa', price: 9000000, wilaya: 'Oran', photos: [] } })).body.id;
  const other = await s.register('fav-autre');
  assert.equal((await s.request('POST', '/api/favorites', { token: other.token, body: { property_id: pending } })).status, 404,
    'une annonce non publiée ne s\'ajoute pas aux favoris');

  // Favori posé alors que l'annonce était publiée, puis annonce repassée en attente / refusée
  assert.equal((await s.request('POST', '/api/favorites', { token: other.token, body: { property_id: visible } })).status, 201);
  await q(`INSERT INTO favorites (user_id, property_id) VALUES ($1, $2)`, [other.id, pending]);
  assert.deepEqual((await s.request('GET', '/api/favorites', { token: other.token })).body.map(f => f.id), [visible]);
  await q(`UPDATE properties SET status = 'rejected' WHERE id = $1`, [visible]);
  assert.deepEqual((await s.request('GET', '/api/favorites', { token: other.token })).body, []);
  await q(`UPDATE properties SET status = 'active' WHERE id = $1`, [visible]);
});

test('favoris : la liste contient fav_id, created_at et les champs de l\'annonce', async () => {
  const u = await s.register('fav-champs');
  const p = await listing('Favori détaillé');
  await s.request('POST', '/api/favorites', { token: u.token, body: { property_id: p } });
  const [f] = (await s.request('GET', '/api/favorites', { token: u.token })).body;
  assert.equal(f.id, p);
  assert.equal(f.title, 'Favori détaillé');
  assert.ok(f.fav_id && f.created_at);
});

test('identifiants absurdes dans l\'URL : « introuvable » ou réponse vide, jamais une erreur serveur', async () => {
  const u = await s.register('ids-absurdes');
  for (const id of ['abc', '1.5', '-3', '0', '99999999999999999999', 'NaN', '%20'])
    for (const url of [`/api/properties/${id}`, `/api/agencies/${id}`, `/api/auth/users/${id}`])
      assert.equal((await s.request('GET', url)).status, 404, `GET ${url}`);
  for (const id of ['abc', '1.5', '99999999999999999999']) {
    assert.equal((await s.request('PUT', `/api/contacts/${id}/status`, { token: u.token, body: { status: 'done' } })).status, 404);
    assert.equal((await s.request('DELETE', `/api/contacts/${id}`, { token: u.token })).status, 404);
    assert.equal((await s.request('GET', `/api/favorites/check/${id}`, { token: u.token })).body.is_favorite, false);
    assert.equal((await s.request('DELETE', `/api/favorites/${id}`, { token: u.token })).status, 200);
    const thread = await s.request('GET', `/api/messages/${id}/${id}`, { token: u.token });
    assert.equal(thread.status, 200);
    assert.deepEqual(thread.body.thread, []);
    assert.equal((await s.request('PUT', `/api/admin/properties/${id}/status`, { token: admin.token, body: { status: 'archived' } })).status, 200);
    assert.equal((await s.request('PUT', `/api/admin/properties/${id}/moderate`, { token: admin.token, body: { decision: 'approve' } })).status, 404);
    assert.equal((await s.request('POST', `/api/properties/${id}/reviews`, { token: u.token, body: { rating: 5 } })).status, 403);
  }
});

test('vérification d\'email : un paramètre token répété ne valide pas un autre compte', async () => {
  const u = await s.register('verif-double');
  const { rows: [{ verification_token: t }] } = await q('SELECT verification_token FROM users WHERE id = $1', [u.id]);
  const r = await fetch(`${s.base}/api/auth/verify-email?token=${t}&token=zzz`, { redirect: 'manual' });
  assert.match(r.headers.get('location'), /verify=invalid/);
  assert.equal((await q('SELECT email_verified FROM users WHERE id = $1', [u.id])).rows[0].email_verified, false);
});

test('compteur de vues : incrément atomique sous des visites simultanées', async () => {
  const p = await listing('Visites simultanées');
  await Promise.all(Array.from({ length: 20 }, () => s.request('GET', `/api/properties/${p}`)));
  assert.equal((await q('SELECT views FROM properties WHERE id = $1', [p])).rows[0].views, 20);
});

test('conversations : dernier message par annonce et interlocuteur, non-lus par conversation', async () => {
  const [a, b] = [await s.register('conv-a'), await s.register('conv-b')];
  const [p1, p2] = [await listing('Conv 1'), await listing('Conv 2')];
  await q('UPDATE properties SET owner_id = $1 WHERE id = ANY($2)', [b.id, [p1, p2]]);
  const send = (from, to, p, body) => s.request('POST', '/api/messages', { token: from.token, body: { to_id: to.id, property_id: p, body } });
  const ids = [];
  for (const [from, to, p, body] of [[a, b, p1, 'p1-a1'], [b, a, p1, 'p1-b1'], [a, b, p2, 'p2-a1'], [a, b, p2, 'p2-a2']])
    ids.push((await send(from, to, p, body)).body.id);
  for (const [i, id] of ids.entries()) await at('messages', id, `2026-06-01T10:0${i}:00Z`);
  const convs = (await s.request('GET', '/api/messages', { token: b.token })).body;
  assert.deepEqual(convs.map(c => [c.property_id, c.last_msg, c.unread]), [[p2, 'p2-a2', 2], [p1, 'p1-b1', 1]]);
  assert.equal(typeof convs[0].last_at, 'string');
  // Ouvrir la conversation de l'annonce 2 la marque comme lue, sans toucher à l'autre
  await s.request('GET', `/api/messages/${p2}/${a.id}`, { token: b.token });
  const after = (await s.request('GET', '/api/messages', { token: b.token })).body;
  assert.deepEqual(after.map(c => [c.property_id, c.unread]), [[p2, 0], [p1, 1]]);
});

// ── Collection : accès ciblé, garde-fous ─────────────────────────────────────
test('Collection : conditions { colonne: valeur } (égalité, NULL, liste), tri et limite', async () => {
  const { users } = s.db;
  const u = await s.register('coll');
  assert.equal((await users.findOne({ email: u.email })).id, u.id);
  assert.equal(await users.findOne({ email: 'inconnu@nulle.part' }), null);
  assert.equal((await users.find({ id: [u.id, 0] })).length, 1, 'liste = ANY');
  assert.ok(await users.count({ verification_token: null }) >= 0, 'NULL → IS NULL');
  assert.equal(await users.count({ id: u.id, email: u.email }), 1, 'conditions cumulées');
  const two = await users.find({}, { orderBy: 'id DESC', limit: 2 });
  assert.equal(two.length, 2);
  assert.ok(two[0].id > two[1].id);
  assert.equal(await users.findById('abc'), null);
  assert.equal(await users.findById(1.5), null);
  assert.equal(await users.findById(99999999999), null);
  assert.equal((await users.findById(String(u.id))).id, u.id);
});

test('Collection : prédicats, colonnes invalides, valeurs indéfinies et écritures sans condition refusés', async () => {
  const { users, properties } = s.db;
  await assert.rejects(() => users.find(u => u.id === 1), TypeError);
  await assert.rejects(() => users.findOne(() => true), TypeError);
  await assert.rejects(() => users.count({ 'id; DROP TABLE users; --': 1 }), /Colonne invalide/);
  await assert.rejects(() => users.find({}, { orderBy: 'id; DROP TABLE users' }), /Tri invalide/);
  await assert.rejects(() => users.findOne({ email: undefined }), /indéfinie/);
  await assert.rejects(() => users.update({}, { banned: true }), /exige une condition/);
  await assert.rejects(() => users.delete({}), /exige une condition/);
  await assert.rejects(() => users.update({ id: 1 }, { 'name = 1, is_admin': true }), /Colonne invalide/);
  assert.ok(await properties.count() >= 0, 'compter sans condition reste permis');
});

test('Collection : update renvoie le nombre de lignes modifiées, sans changement c\'est un no-op', async () => {
  const { users } = s.db;
  const u = await s.register('coll-maj');
  assert.equal(await users.update({ id: u.id }, {}), 0, 'aucun champ : rien à faire (avant : erreur SQL)');
  assert.equal(await users.update({ id: u.id }, { bio: 'Bonjour' }), 1);
  assert.equal(await users.update({ id: 0 }, { bio: 'x' }), 0);
  assert.equal((await users.findById(u.id)).bio, 'Bonjour');
  assert.equal(await users.delete({ id: u.id }), 1);
  assert.equal(await users.findById(u.id), null);
});
