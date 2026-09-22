// Tests d'intégration pour les notifications push navigateur (GET /api/push/key, POST/DELETE /api/push/subscribe).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let srv, user;

before(async () => {
  srv  = await startServer();
  user = await srv.register('push-user');
});
after(async () => { await srv.stop(); });

describe('GET /api/push/key', () => {
  it('renvoie une clé (chaîne vide si VAPID absent)', async () => {
    const { status, body } = await srv.request('GET', '/api/push/key');
    assert.equal(status, 200);
    assert.ok('key' in body);
    assert.equal(typeof body.key, 'string');
  });
});

describe('POST /api/push/subscribe', () => {
  it('rejette un corps invalide (400)', async () => {
    const { status } = await srv.request('POST', '/api/push/subscribe', {
      token: user.token,
      body: { endpoint: 'https://push.example.com/123' },   // p256dh et auth manquants
    });
    assert.equal(status, 400);
  });

  it('enregistre un abonnement valide (200)', async () => {
    const { status, body } = await srv.request('POST', '/api/push/subscribe', {
      token: user.token,
      body: { endpoint: 'https://push.example.com/abc', p256dh: 'dGVzdA==', auth: 'dGVzdA==' },
    });
    assert.equal(status, 200);
    assert.ok(body.ok);
  });

  it('met à jour un abonnement existant (upsert, 200)', async () => {
    const { status } = await srv.request('POST', '/api/push/subscribe', {
      token: user.token,
      body: { endpoint: 'https://push.example.com/abc', p256dh: 'bm91dmVhdQ==', auth: 'bm91dmVhdQ==' },
    });
    assert.equal(status, 200);
  });

  it('requiert la connexion (401)', async () => {
    const { status } = await srv.request('POST', '/api/push/subscribe', {
      body: { endpoint: 'https://push.example.com/xyz', p256dh: 'dGVzdA==', auth: 'dGVzdA==' },
    });
    assert.equal(status, 401);
  });
});

describe('DELETE /api/push/subscribe', () => {
  it('supprime un abonnement (200)', async () => {
    const { status, body } = await srv.request('DELETE', '/api/push/subscribe', {
      token: user.token,
      body: { endpoint: 'https://push.example.com/abc' },
    });
    assert.equal(status, 200);
    assert.ok(body.ok);
  });

  it('tolère un endpoint inconnu (200)', async () => {
    const { status } = await srv.request('DELETE', '/api/push/subscribe', {
      token: user.token,
      body: { endpoint: 'https://push.example.com/inexistant' },
    });
    assert.equal(status, 200);
  });
});
