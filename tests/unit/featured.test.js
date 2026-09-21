// Mise à la une : formules, ouverture, fournisseur de paiement et règles de configuration de production (sans base ni serveur).
const test   = require('node:test');
const assert = require('node:assert/strict');
const featured = require('../../server/featured');
const payments = require('../../server/payments');
const { checkConfig } = require('../../server/config-check');

const SECRET = 'b7f3a91c0d5e48269f1a3c7e8d2b46059a1f3e7c9b2d4860';
const OK = {
  NODE_ENV: 'production', JWT_SECRET: SECRET, DATABASE_URL: 'postgresql://u:p@db:5432/dzimmo',
  APP_URL: 'https://dzimmo.dz', CORS_ORIGINS: 'https://dzimmo.dz', TRUST_PROXY: '1', EMAIL_HOST: 'smtp.exemple.net', EMAIL_USER: 'noreply@dzimmo.dz', MODERATION: 'on',
};
const check = over => checkConfig({ ...OK, ...over });

test('formules : valeurs par défaut, triées par durée', () => {
  assert.deepEqual(featured.plans({}), [{ days: 7, price: 1500 }, { days: 15, price: 2500 }, { days: 30, price: 4000 }]);
});

test('formules : FEATURED_PRICES remplace les défauts, les entrées illisibles ou en double sont ignorées', () => {
  assert.deepEqual(featured.plans({ FEATURED_PRICES: '30:5000, 3:500' }), [{ days: 3, price: 500 }, { days: 30, price: 5000 }]);
  assert.deepEqual(featured.plans({ FEATURED_PRICES: '7:1000,7:9999,x:2,0:10,400:10,10:-5,10:1.5,12' }), [{ days: 7, price: 1000 }]);
  assert.deepEqual(featured.plans({ FEATURED_PRICES: 'n\'importe quoi' }), featured.plans({}), 'aucune formule valide : les défauts');
  assert.equal(featured.plans({ FEATURED_PRICES: '1:1,2:1,3:1,4:1,5:1,6:1,7:1,8:1' }).length, 6, 'six formules au plus');
});

test('ouverture : ouvert hors production, fermé en production sauf FEATURED_ENABLED=true', () => {
  assert.equal(featured.enabled({}), true);
  assert.equal(featured.enabled({ NODE_ENV: 'test' }), true);
  assert.equal(featured.enabled({ NODE_ENV: 'production' }), false);
  assert.equal(featured.enabled({ NODE_ENV: 'production', FEATURED_ENABLED: 'true' }), true);
  assert.equal(featured.enabled({ NODE_ENV: 'development', FEATURED_ENABLED: 'false' }), false);
});

test('paiement : simulé hors production, SATIM en production, et jamais de simulation en production', async () => {
  assert.equal(payments.provider({}), 'simulated');
  assert.equal(payments.provider({ NODE_ENV: 'production' }), 'satim');
  assert.equal(payments.provider({ PAYMENT_PROVIDER: 'SATIM' }), 'satim');
  assert.equal(payments.simulated({}), true);
  assert.equal(payments.simulated({ PAYMENT_PROVIDER: 'satim' }), false);
  assert.equal(payments.simulated({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'simulated' }), false);
  assert.deepEqual(await payments.checkout({}, {}), { simulated: true });
  await assert.rejects(payments.checkout({}, { NODE_ENV: 'production' }), /non raccordé/);
});

test('config-check : la configuration de production complète reste sans erreur ni avertissement', () => {
  assert.deepEqual(checkConfig(OK), { errors: [], warnings: [] });
  assert.deepEqual(check({ FEATURED_ENABLED: 'false', FEATURED_PRICES: '7:1500,30:4000' }), { errors: [], warnings: [] });
});

test('config-check : paiement simulé ou mises à la une ouvertes en production → erreur (SATIM non raccordé)', () => {
  assert.match(check({ PAYMENT_PROVIDER: 'simulated' }).errors.join('\n'), /PAYMENT_PROVIDER=simulated/);
  assert.match(check({ FEATURED_ENABLED: 'true' }).errors.join('\n'), /FEATURED_ENABLED=true/);
});

test('config-check : FEATURED_PRICES illisible → avertissement seulement', () => {
  const r = check({ FEATURED_PRICES: '7:1500,abc,400:10' });
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join('\n'), /FEATURED_PRICES.*abc, 400:10/);
});
