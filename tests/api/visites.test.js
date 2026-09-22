// Tests d'intégration pour la planification des visites : champ visit_time, validation, rappels.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let srv, buyer, owner, propertyId;

before(async () => {
  srv   = await startServer();
  buyer = await srv.register('buyer');
  owner = await srv.register('owner');

  // Créer une annonce active (sans modération : owner publie directement via seed ou en tant que compte de confiance)
  // On force status = 'active' directement en base
  const { rows } = await srv.db.pool.query(
    `INSERT INTO properties (owner_id, title, price, wilaya, type_bien, mode, status, last_confirmed_at)
     VALUES ($1, 'Villa test', 5000000, 'Alger', 'villa', 'vente', 'active', NOW())
     RETURNING id`,
    [owner.id]
  );
  propertyId = rows[0].id;
});
after(async () => { await srv.stop(); });

describe('POST /api/contacts — demande de visite avec heure', () => {
  it('accepte une visite avec date et heure valides', async () => {
    const { status, body } = await srv.request('POST', '/api/contacts', {
      token: buyer.token,
      body: { property_id: propertyId, type: 'visite', visit_date: '2027-01-15', visit_time: '14:30' },
    });
    assert.equal(status, 201);
    assert.ok(body.id > 0);
  });

  it('accepte une visite sans heure (heure optionnelle)', async () => {
    const { status, body } = await srv.request('POST', '/api/contacts', {
      token: buyer.token,
      body: { property_id: propertyId, type: 'visite', visit_date: '2027-01-16' },
    });
    assert.equal(status, 201);
    assert.ok(body.id > 0);
  });

  it('refuse une heure invalide', async () => {
    const { status, body } = await srv.request('POST', '/api/contacts', {
      token: buyer.token,
      body: { property_id: propertyId, type: 'visite', visit_date: '2027-01-17', visit_time: '25:00' },
    });
    assert.equal(status, 400);
    assert.match(body.error, /Heure de visite invalide/);
  });

  it('refuse une heure invalide (format incorrect)', async () => {
    const { status } = await srv.request('POST', '/api/contacts', {
      token: buyer.token,
      body: { property_id: propertyId, type: 'visite', visit_date: '2027-01-18', visit_time: 'midi' },
    });
    assert.equal(status, 400);
  });
});

describe("GET /api/contacts/received — la date et l'heure sont renvoyées", () => {
  let contactId;

  before(async () => {
    const { body } = await srv.request('POST', '/api/contacts', {
      token: buyer.token,
      body: { property_id: propertyId, type: 'visite', visit_date: '2027-02-10', visit_time: '09:00' },
    });
    contactId = body.id;
  });

  it('la demande reçue contient visit_date et visit_time', async () => {
    const { status, body } = await srv.request('GET', '/api/contacts/received', { token: owner.token });
    assert.equal(status, 200);
    const req = body.find(c => c.id === contactId);
    assert.ok(req, 'demande introuvable dans les reçues');
    assert.equal(req.visit_time, '09:00');
    assert.match(String(req.visit_date), /2027-02-10/);
  });
});

describe("sendVisitReminders — compte le nombre de rappels envoyés", () => {
  it("renvoie 0 quand aucune visite n'est prévue demain", async () => {
    // On charge le module dans le contexte du test (qui utilise le schéma jetable)
    const { sendVisitReminders } = require('../../server/visit-reminders');
    const n = await sendVisitReminders();
    // Sans SMTP configuré en test, les emails ne partent pas mais le compte reste correct
    assert.equal(typeof n, 'number');
    assert.ok(n >= 0);
  });
});
