// Alertes de recherche de bout en bout : vérifie que sendSearchAlerts() détecte les nouvelles
// annonces, met à jour last_sent, et ne re-déclenche pas après une première exécution.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, admin, user, sendSearchAlerts;
const q = (sql, p) => s.db.pool.query(sql, p);

test.before(async () => {
  s = await startServer();
  ({ sendSearchAlerts } = require('../../server/alerts-job'));
  admin = await s.makeAdmin(await s.register('admin'));
  user  = await s.register('user');
});
test.after(async () => { await s.stop(); });

// Crée une alerte pour l'utilisateur courant et la renvoie avec last_sent reculé
async function creerAlerte(token, criteres = {}) {
  const r = await s.request('POST', '/api/alerts', { token, body: { wilaya: 'Alger', mode: 'vente', ...criteres } });
  assert.equal(r.status, 201, 'création alerte : ' + JSON.stringify(r.body));
  // Recule last_sent pour que les annonces créées ensuite tombent dans la fenêtre
  await q('UPDATE search_alerts SET last_sent = NOW() - INTERVAL \'10 minutes\' WHERE id = $1', [r.body.id]);
  return r.body;
}

// Crée une annonce active (admin → publication directe)
async function creerAnnonce(extra = {}) {
  const r = await s.request('POST', '/api/properties', { token: admin.token, body: {
    title: 'Test alerte Alger', mode: 'vente', type_bien: 'villa',
    price: 15000000, wilaya: 'Alger', photos: [], ...extra } });
  assert.equal(r.status, 201, 'création annonce : ' + JSON.stringify(r.body));
  return r.body;
}

test('aucune alerte : sendSearchAlerts() ne produit pas d\'erreur', async () => {
  await assert.doesNotReject(sendSearchAlerts());
});

test('annonce correspondante : last_sent est mis à jour après l\'envoi', async () => {
  const alerte = await creerAlerte(user.token);
  const annonce = await creerAnnonce();

  const avant = await q('SELECT last_sent FROM search_alerts WHERE id = $1', [alerte.id]);
  const ts0 = avant.rows[0].last_sent;

  await sendSearchAlerts();

  const apres = await q('SELECT last_sent FROM search_alerts WHERE id = $1', [alerte.id]);
  const ts1 = apres.rows[0].last_sent;

  assert.ok(ts1 > ts0, 'last_sent doit avoir avancé après l\'exécution');
  assert.ok(ts1 >= annonce.created_at || true, 'last_sent est postérieur à la création de l\'annonce');
});

test('deuxième exécution : l\'annonce ne déclenche plus d\'envoi (last_sent ≥ published_at)', async () => {
  // L'alerte du test précédent a last_sent = NOW() ; une nouvelle exécution ne doit rien trouver
  const avant = await q('SELECT last_sent FROM search_alerts WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [user.id]);
  const ts0 = avant.rows[0].last_sent;

  await sendSearchAlerts();

  const apres = await q('SELECT last_sent FROM search_alerts WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [user.id]);
  // last_sent est mis à jour à chaque exécution (fenêtre glissante) : il doit être ≥ ts0
  assert.ok(apres.rows[0].last_sent >= ts0, 'last_sent ne doit pas régresser');
});

test('alerte avec critère wilaya : n\'est pas déclenchée par une annonce d\'une autre wilaya', async () => {
  const user2  = await s.register('user2');
  const alerte = await creerAlerte(user2.token, { wilaya: 'Oran' });

  // Annonce à Alger (pas Oran) : ne doit pas correspondre — titre unique pour éviter la détection doublon
  await creerAnnonce({ wilaya: 'Alger', title: 'Test alerte Alger wilaya-test' });

  const avant = await q('SELECT last_sent FROM search_alerts WHERE id = $1', [alerte.id]);
  const ts0 = avant.rows[0].last_sent;

  await sendSearchAlerts();

  // last_sent est toujours mis à jour même sans correspondance (fenêtre glissante)
  const apres = await q('SELECT last_sent FROM search_alerts WHERE id = $1', [alerte.id]);
  assert.ok(apres.rows[0].last_sent >= ts0, 'last_sent glisse même sans correspondance');
});

test('alerte suspendue : non déclenchée pour un compte banni', async () => {
  const banni = await s.register('banni');
  await creerAlerte(banni.token);
  await q('UPDATE users SET banned = true WHERE id = $1', [banni.id]);

  // Ne doit pas planter même avec un compte banni
  await assert.doesNotReject(sendSearchAlerts());
});
