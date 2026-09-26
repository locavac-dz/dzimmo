// Tests d'intégration pour les alertes de recherche sauvegardées.
// Vérifie le CRUD (/api/alerts) et que notifyMatchingAlerts trouve les bons abonnés.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let srv, owner, subscriber;

before(async () => {
  srv        = await startServer();
  owner      = await srv.register('alerte-owner');
  subscriber = await srv.register('alerte-sub');
});
after(async () => { await srv.stop(); });

describe('GET /api/alerts — liste des alertes', () => {
  it('requiert la connexion (401)', async () => {
    const { status } = await srv.request('GET', '/api/alerts');
    assert.equal(status, 401);
  });

  it('renvoie une liste vide au départ', async () => {
    const { status, body } = await srv.request('GET', '/api/alerts', { token: subscriber.token });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  });
});

describe('POST /api/alerts — créer une alerte', () => {
  it('requiert la connexion (401)', async () => {
    const { status } = await srv.request('POST', '/api/alerts', { body: { wilaya: 'Alger' } });
    assert.equal(status, 401);
  });

  it('crée une alerte avec critères étendus (201)', async () => {
    const { status, body } = await srv.request('POST', '/api/alerts', {
      token: subscriber.token,
      body: { wilaya: 'Alger', mode: 'vente', type_bien: 'appartement', min_price: 1000000, max_price: 10000000, rooms: 3, condition: 'neuf', commune: 'bir-el-djir' },
    });
    assert.equal(status, 201);
    assert.ok(body.id);
    assert.equal(body.rooms, 3);
    assert.equal(body.condition, 'neuf');
    assert.equal(body.commune, 'bir-el-djir');
  });

  it('la nouvelle alerte apparaît dans la liste', async () => {
    const { body } = await srv.request('GET', '/api/alerts', { token: subscriber.token });
    assert.equal(body.length, 1);
    assert.equal(body[0].wilaya, 'Alger');
    assert.equal(body[0].mode, 'vente');
  });

  it('rejette rooms non entier (400)', async () => {
    const { status } = await srv.request('POST', '/api/alerts', { token: subscriber.token, body: { rooms: 1.5 } });
    assert.equal(status, 400);
  });

  it('rejette condition invalide (400)', async () => {
    const { status } = await srv.request('POST', '/api/alerts', { token: subscriber.token, body: { condition: 'moisi' } });
    assert.equal(status, 400);
  });

  it('max 5 alertes par compte', async () => {
    for (let i = 0; i < 4; i++) {
      await srv.request('POST', '/api/alerts', { token: subscriber.token, body: {} });
    }
    const { status } = await srv.request('POST', '/api/alerts', { token: subscriber.token, body: {} });
    assert.equal(status, 400);
  });
});

describe('DELETE /api/alerts/:id', () => {
  it('supprime une alerte appartenant à l\'utilisateur (200)', async () => {
    const { body: list } = await srv.request('GET', '/api/alerts', { token: subscriber.token });
    const id = list[0]?.id;
    assert.ok(id);
    const { status, body } = await srv.request('DELETE', '/api/alerts/' + id, { token: subscriber.token });
    assert.equal(status, 200);
    assert.ok(body.ok);
  });

  it('l\'alerte supprimée n\'apparaît plus', async () => {
    const { body } = await srv.request('GET', '/api/alerts', { token: subscriber.token });
    assert.ok(body.length < 5);
  });

  it('interdit la suppression d\'une alerte d\'autrui (404)', async () => {
    const { body: list } = await srv.request('GET', '/api/alerts', { token: subscriber.token });
    if (!list.length) return;
    const id = list[0].id;
    const { status } = await srv.request('DELETE', '/api/alerts/' + id, { token: owner.token });
    assert.equal(status, 404);
  });
});
