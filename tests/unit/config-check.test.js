// Contrôle de la configuration de production (server/config-check.js) : aucune base ni serveur nécessaire.
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkConfig, reportConfig } = require('../../server/config-check');

const SECRET = 'b7f3a91c0d5e48269f1a3c7e8d2b46059a1f3e7c9b2d4860'; // 48 caractères, sans mot d'exemple
const OK = {
  NODE_ENV: 'production', JWT_SECRET: SECRET, DATABASE_URL: 'postgresql://u:p@db:5432/dzimmo',
  APP_URL: 'https://dzimmo.dz', CORS_ORIGINS: 'https://dzimmo.dz', TRUST_PROXY: '1', EMAIL_HOST: 'smtp.exemple.net', MODERATION: 'on',
};
const check = over => checkConfig({ ...OK, ...over });

test('configuration de production complète : ni erreur ni avertissement', () => {
  assert.deepEqual(checkConfig(OK), { errors: [], warnings: [] });
});

test('hors production : aucun contrôle (développement et tests)', () => {
  assert.deepEqual(checkConfig({ NODE_ENV: 'development' }), { errors: [], warnings: [] });
  assert.deepEqual(checkConfig({}), { errors: [], warnings: [] });
  assert.deepEqual(checkConfig({ NODE_ENV: 'test', JWT_SECRET: 'secret-de-test' }), { errors: [], warnings: [] });
});

test('secret JWT : absent, valeur d\'exemple ou trop court → erreur bloquante', () => {
  assert.match(check({ JWT_SECRET: '' }).errors[0], /JWT_SECRET est absent/);
  assert.match(check({ JWT_SECRET: undefined }).errors[0], /JWT_SECRET est absent/);
  for (const exemple of ['changez_ce_secret_par_une_valeur_aleatoire_longue', 'CHANGEZ-MOI-' + 'x'.repeat(40), 'change_me_' + 'x'.repeat(40), 'secret-de-test'])
    assert.match(check({ JWT_SECRET: exemple }).errors[0], /valeur d'exemple/, exemple);
  assert.match(check({ JWT_SECRET: 'court' }).errors[0], /trop court \(5 caractères, 32 minimum\)/);
  assert.equal(check({ JWT_SECRET: 'a'.repeat(31) }).errors.length, 1);
  assert.equal(check({ JWT_SECRET: 'a1'.repeat(16) }).errors.length, 0, '32 caractères : accepté');
});

test('APP_URL : absente ou locale → erreur ; http → avertissement', () => {
  assert.match(check({ APP_URL: '' }).errors[0], /APP_URL est absent/);
  for (const local of ['http://localhost:3001', 'http://127.0.0.1:3001/', 'https://localhost', 'http://[::1]:3001'])
    assert.match(check({ APP_URL: local }).errors[0], /adresse locale/, local);
  const http = check({ APP_URL: 'http://dzimmo.dz' });
  assert.deepEqual(http.errors, []);
  assert.match(http.warnings[0], /n'est pas en https/);
  assert.deepEqual(check({ APP_URL: 'https://localhost.dzimmo.dz' }).errors, [], 'un domaine qui commence par « localhost » n\'est pas local');
});

test('base de données absente → erreur', () => {
  assert.match(check({ DATABASE_URL: '' }).errors[0], /DATABASE_URL est absent/);
});

test('réglages dégradés → avertissements sans bloquer', () => {
  assert.match(check({ CORS_ORIGINS: '' }).warnings.join(), /CORS_ORIGINS/);
  assert.match(check({ CORS_ORIGINS: 'http://localhost:3001, http://127.0.0.1:3001' }).warnings.join(), /CORS_ORIGINS/);
  assert.deepEqual(check({ CORS_ORIGINS: 'https://dzimmo.dz, http://localhost:3001' }).warnings, [], 'une origine publique suffit');
  for (const t of [undefined, '', '0', 'false']) assert.match(check({ TRUST_PROXY: t }).warnings.join(), /TRUST_PROXY/, String(t));
  assert.match(check({ EMAIL_HOST: '' }).warnings.join(), /EMAIL_HOST/);
  assert.match(check({ MODERATION: 'OFF' }).warnings.join(), /MODERATION=off/);
  assert.deepEqual(check({ TRUST_PROXY: '0', EMAIL_HOST: '' }).errors, [], 'aucun de ces réglages n\'est bloquant');
});

test('erreurs et avertissements s\'accumulent, chacun expliqué en français', () => {
  const { errors, warnings } = checkConfig({ NODE_ENV: 'production' });
  assert.equal(errors.length, 3, 'secret, base, APP_URL');
  assert.ok(warnings.length >= 3);
  for (const m of [...errors, ...warnings]) assert.match(m, /[a-zé]{4,}/i);
});

test('reportConfig : affiche le bilan et renvoie false uniquement en présence d\'erreur', () => {
  const lines = { warn: [], error: [] };
  const log = { warn: m => lines.warn.push(m), error: m => lines.error.push(m) };
  assert.equal(reportConfig({ ...OK, TRUST_PROXY: '' }, log), true);
  assert.equal(lines.warn.length, 1);
  assert.equal(lines.error.length, 0);
  assert.equal(reportConfig({ ...OK, JWT_SECRET: 'changez_ce_secret' }, log), false);
  assert.equal(lines.error.length, 1);
  assert.match(lines.error[0], /^❌ Configuration : JWT_SECRET/);
});

test('le serveur refuse de démarrer en production avec le secret d\'exemple (processus réel)', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'server', 'index.js')], {
    env: { ...process.env, ...OK, JWT_SECRET: 'changez_ce_secret_par_une_valeur_aleatoire_longue', PORT: '0' },
    encoding: 'utf8', timeout: 20000,
  });
  assert.equal(r.status, 1, 'code de sortie 1');
  assert.match(r.stderr, /❌ Configuration : JWT_SECRET est encore la valeur d'exemple/);
  assert.doesNotMatch(r.stdout, /DzImmo démarré/, 'le serveur n\'a pas démarré');
});
