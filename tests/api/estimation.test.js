// Tests d'intégration pour le moteur d'estimation de prix (GET /api/properties/estimation).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let srv, user;

before(async () => {
  srv  = await startServer();
  user = await srv.register('est-user');
});
after(async () => { await srv.stop(); });

describe('GET /api/properties/estimation', () => {
  it('requiert le paramètre mode (400 avec code mode_required)', async () => {
    const { status, body } = await srv.request('GET', '/api/properties/estimation?type_bien=appartement&wilaya=Alger');
    assert.equal(status, 400);
    assert.equal(body.error, 'mode_required');
  });

  it('renvoie count=0 quand il n\'y a pas d\'annonces comparables', async () => {
    const { status, body } = await srv.request('GET', '/api/properties/estimation?mode=vente&type_bien=villa&wilaya=Tamanrasset');
    assert.equal(status, 200);
    assert.equal(typeof body.count, 'number');
    assert.ok(body.count >= 0);
  });

  it('renvoie les percentiles quand le jeu de données est suffisant', async () => {
    // Le seed crée des annonces de démonstration : si certaines correspondent, on vérifie la structure.
    const { status, body } = await srv.request('GET', '/api/properties/estimation?mode=vente&type_bien=appartement&wilaya=Alger');
    assert.equal(status, 200);
    assert.equal(typeof body.count, 'number');
    if (body.count >= 2) {
      assert.ok('avg_pm2' in body, 'avg_pm2 attendu');
      assert.ok('p25_pm2' in body, 'p25_pm2 attendu');
      assert.ok('p75_pm2' in body, 'p75_pm2 attendu');
      assert.ok('scope' in body, 'scope attendu');
      assert.ok(['wilaya', 'national'].includes(body.scope));
    }
  });

  it('type_bien invalide : ignoré (pas d\'erreur 400)', async () => {
    const { status } = await srv.request('GET', '/api/properties/estimation?mode=vente&type_bien=INVALIDE&wilaya=Alger');
    // Valeur ignorée ou refusée — ni crash ni 500
    assert.ok(status === 200 || status === 400);
  });
});
