// Export des données personnelles (GET /api/auth/export) — loi 18-07 / RGPD (droit d'accès).
// Vérifie la structure complète du fichier téléchargeable, l'absence de champs sensibles,
// et l'isolation entre utilisateurs.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, admin, owner, requester;
const q = (sql, p) => s.db.pool.query(sql, p);

test.before(async () => {
  s = await startServer();
  admin     = await s.makeAdmin(await s.register('admin'));
  owner     = await s.register('owner');
  requester = await s.register('requester');
});
test.after(async () => { await s.stop(); });

async function publish(token, extra = {}) {
  const r = await s.request('POST', '/api/properties', { token, body: {
    title: 'Villa export test', mode: 'vente', type_bien: 'villa',
    price: 25000000, wilaya: 'Alger', photos: [], ...extra } });
  assert.equal(r.status, 201, 'publication ' + JSON.stringify(r.body));
  return r.body.id;
}

test('non authentifié : 401', async () => {
  const r = await s.request('GET', '/api/auth/export');
  assert.equal(r.status, 401);
});

test('export complet : structure, sections et en-têtes', async () => {
  // Annonce publiée par owner (admin publie directement sans modération)
  const adminProp = await publish(admin.token, { title: 'Annonce pour favoris' });
  const ownerProp = await publish(admin.token, { title: 'Villa de owner' });
  // On réassigne la propriété à owner
  await q('UPDATE properties SET owner_id = $1 WHERE id = $2', [owner.id, ownerProp]);

  // Favori ajouté par owner
  const fav = await s.request('POST', '/api/favorites', { token: owner.token, body: { property_id: adminProp } });
  assert.equal(fav.status, 201);

  // Demande de contact de requester vers ownerProp
  const contact = await s.request('POST', '/api/contacts', { token: requester.token, body: {
    property_id: ownerProp, type: 'info', message: 'Toujours disponible ?' } });
  assert.equal(contact.status, 201);

  // Message de requester à owner
  const msg = await s.request('POST', '/api/messages', { token: requester.token, body: {
    to_id: owner.id, property_id: ownerProp, body: 'Bonjour, je suis intéressé.' } });
  assert.equal(msg.status, 201);

  // Alerte de recherche pour owner
  const alert = await s.request('POST', '/api/alerts', { token: owner.token, body: { wilaya: 'Alger', mode: 'vente' } });
  assert.equal(alert.status, 201);

  // Export de owner
  const r = await s.request('GET', '/api/auth/export', { token: owner.token });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/, 'Content-Type JSON');
  assert.match(r.headers.get('content-disposition'), /attachment.*dzimmo-.*\.json/, 'fichier téléchargeable');

  const d = r.body;
  assert.ok(d.exported_at, 'exported_at présent');
  assert.ok(new Date(d.exported_at).getFullYear() >= 2026, 'horodatage valide');

  // Profil
  assert.equal(d.profile.id, owner.id);
  assert.equal(d.profile.email, owner.email);
  assert.ok(!('password'          in d.profile), 'mot de passe absent');
  assert.ok(!('google_id'         in d.profile), 'google_id absent');
  assert.ok(!('sessions_valid_after' in d.profile), 'sessions_valid_after absent');
  assert.ok(!('verification_token'   in d.profile), 'verification_token absent');

  // Annonces
  assert.ok(Array.isArray(d.properties), 'properties est un tableau');
  assert.equal(d.properties.length, 1, 'une seule annonce appartient à owner');
  assert.equal(d.properties[0].title, 'Villa de owner');
  assert.equal(d.properties[0].type_bien, 'villa');
  assert.ok(!('owner_id' in d.properties[0]), 'owner_id redondant absent');

  // Messages
  assert.ok(Array.isArray(d.messages));
  assert.equal(d.messages.length, 1, 'un message reçu de requester');
  assert.equal(d.messages[0].body, 'Bonjour, je suis intéressé.');
  assert.equal(d.messages[0].from_id, requester.id);
  assert.equal(d.messages[0].to_id, owner.id);
  assert.ok(d.messages[0].from_name, 'nom de l\'expéditeur présent');

  // Demandes reçues
  assert.ok(Array.isArray(d.contact_requests_received));
  assert.equal(d.contact_requests_received.length, 1);
  assert.equal(d.contact_requests_received[0].type, 'info');
  assert.equal(d.contact_requests_received[0].requester_id, requester.id);
  assert.ok(d.contact_requests_received[0].requester_name, 'nom du demandeur présent');
  assert.equal(d.contact_requests_received[0].property_title, 'Villa de owner');

  // Demandes envoyées (aucune pour owner)
  assert.ok(Array.isArray(d.contact_requests_sent));
  assert.equal(d.contact_requests_sent.length, 0);

  // Favoris
  assert.ok(Array.isArray(d.favorites));
  assert.equal(d.favorites.length, 1);
  assert.equal(d.favorites[0].property_id, adminProp);
  assert.ok(d.favorites[0].property_title, 'titre de l\'annonce favorite présent');

  // Avis (aucun pour owner)
  assert.ok(Array.isArray(d.reviews));
  assert.equal(d.reviews.length, 0);

  // Alertes
  assert.ok(Array.isArray(d.search_alerts));
  assert.equal(d.search_alerts.length, 1);
  assert.equal(d.search_alerts[0].wilaya, 'Alger');
  assert.equal(d.search_alerts[0].mode, 'vente');
});

test('export de requester : demande envoyée visible, rien de owner', async () => {
  const r = await s.request('GET', '/api/auth/export', { token: requester.token });
  assert.equal(r.status, 200);
  const d = r.body;

  assert.equal(d.profile.id, requester.id);
  assert.equal(d.properties.length, 0, 'requester n\'a pas d\'annonce');
  assert.equal(d.contact_requests_sent.length, 1, 'une demande envoyée');
  assert.equal(d.contact_requests_sent[0].type, 'info');
  assert.ok(d.contact_requests_sent[0].property_title, 'titre présent');
  assert.equal(d.contact_requests_received.length, 0, 'aucune demande reçue');
  assert.equal(d.messages.length, 1, 'le message envoyé est inclus');
  assert.equal(d.favorites.length, 0);
  assert.equal(d.search_alerts.length, 0);
});

test('isolation : les données de owner ne figurent pas dans l\'export de requester', async () => {
  const [r1, r2] = await Promise.all([
    s.request('GET', '/api/auth/export', { token: owner.token }),
    s.request('GET', '/api/auth/export', { token: requester.token }),
  ]);
  // Les emails sont différents
  assert.notEqual(r1.body.profile.email, r2.body.profile.email);
  // Les annonces de owner ne sont pas dans l'export de requester
  const ownerPropIds = r1.body.properties.map(p => p.id);
  for (const p of r2.body.properties) assert.ok(!ownerPropIds.includes(p.id));
});
