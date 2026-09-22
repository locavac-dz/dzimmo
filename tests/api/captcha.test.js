// Tests d'intégration pour l'endpoint /api/captcha et la vérification Turnstile sur les routes publiques.
// Quand TURNSTILE_SECRET est absent (mode dev/test), la vérification est ignorée : les routes fonctionnent normalement.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

describe('GET /api/captcha', () => {
  it('renvoie { key: "", enabled: false } quand TURNSTILE_SITE_KEY est absent', async () => {
    const { status, body } = await srv.request('GET', '/api/captcha');
    assert.equal(status, 200);
    // En mode test, TURNSTILE_SITE_KEY n'est pas défini
    assert.equal(body.enabled, false);
    assert.equal(typeof body.key, 'string');
  });
});

describe('Contact sans TURNSTILE_SECRET', () => {
  it('accepte le formulaire même sans cf_turnstile_response (SMTP absent → 503, pas 400)', async () => {
    // Sans SMTP configuré, la route contact renvoie 503 (service indisponible).
    // Le point important : elle ne renvoie pas 400 « vérification anti-spam » (pas de secret = skip).
    const { status } = await srv.request('POST', '/api/contact', {
      body: { name: 'Test', email: 'test@example.com', subject: 'info', message: 'Bonjour monde' },
    });
    assert.notEqual(status, 400, 'Erreur CAPTCHA inattendue (400) : le secret n\'est pas défini en test, la vérification doit être ignorée');
  });
});

describe('Newsletter sans TURNSTILE_SECRET', () => {
  it('accepte la souscription même sans cf_turnstile_response (SMTP absent → 503, pas 400)', async () => {
    const { status } = await srv.request('POST', '/api/newsletter/subscribe', {
      body: { email: 'test@example.com', lang: 'fr' },
    });
    assert.notEqual(status, 400, 'Erreur CAPTCHA inattendue (400) : le secret n\'est pas défini en test, la vérification doit être ignorée');
  });
});
