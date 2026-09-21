// Supervision (server/monitor.js) : alertes email en cas de panne, une seule par nature de panne et par heure (tous workers confondus),
// destinataires, langue, expurgation des données personnelles, tâches planifiées entourées de guard(), erreurs 500 et plantage du processus.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { startServer, ROOT } = require('../helpers/server');

const ARABIC = /[؀-ۿ]/;
let s, monitor, admin, mails;
const q = (sql, params) => s.db.pool.query(sql, params);

test.before(async () => {
  s = await startServer();
  monitor = require('../../server/monitor');
  admin = await s.makeAdmin(await s.register('admin'));
  mails = [];
  require('nodemailer').createTransport = () => ({ sendMail: async o => { mails.push(o); } });
});
test.after(async () => { await s.stop(); });

const setMail = on => Object.assign(process.env, on
  ? { EMAIL_HOST: 'smtp.test', EMAIL_USER: 'noreply@test.dz' } : { EMAIL_HOST: '', EMAIL_USER: '' });
const reset = async () => { mails.length = 0; await q('DELETE FROM alert_throttle'); delete process.env.ALERT_EMAIL; delete process.env.CONTACT_EMAIL; };

test('expurgation : ni adresse email, ni numéro, ni adresse de connexion dans le message d\'alerte', () => {
  const m = monitor.sanitize(new Error('échec pour karim@exemple.dz au 0555 12 34 56 via postgresql://dzimmo:secret@db:5432/dzimmo'));
  assert.doesNotMatch(m, /karim|exemple\.dz|0555|secret|postgresql/);
  assert.match(m, /<adresse>/);
  assert.match(m, /<numéro>/);
  assert.match(m, /<url>/);
  assert.equal(monitor.sanitize(new Error('x'.repeat(2000))).length, 300, 'tronqué');
  assert.equal(monitor.sanitize(undefined), 'erreur inconnue');
  assert.equal(monitor.sanitize('chaîne simple'), 'chaîne simple');
});

test('SMTP absent : aucune alerte, aucune ligne écrite en base (l\'alerte ne doit jamais aggraver la panne)', async () => {
  await reset(); setMail(false);
  assert.equal(await monitor.alert('crash', new Error('boum')), false);
  assert.equal((await q('SELECT count(*)::int AS n FROM alert_throttle')).rows[0].n, 0);
  assert.equal(mails.length, 0);
});

test('une seule alerte par nature de panne et par heure, même lancées ensemble ; une autre nature part ; l\'heure écoulée rouvre', async () => {
  await reset(); setMail(true); process.env.ALERT_EMAIL = 'technique@test.dz';
  await Promise.all(Array.from({ length: 10 }, () => monitor.alert('crash', new Error('boum'))));
  assert.equal(mails.length, 1, '10 alertes simultanées → un seul email');
  assert.equal(await monitor.alert('crash', new Error('encore')), false);
  assert.equal(mails.length, 1);
  assert.equal(await monitor.alert('http', new Error('500'), 'GET /api/x'), true);
  assert.equal(mails.length, 2, 'nature différente : nouvelle alerte');
  await q(`UPDATE alert_throttle SET last_sent_at = NOW() - INTERVAL '61 minutes' WHERE kind = 'crash'`);
  assert.equal(await monitor.alert('crash', new Error('après une heure')), true);
  assert.equal(mails.length, 3);
});

test('destinataires : ALERT_EMAIL, sinon CONTACT_EMAIL, sinon les administrateurs dans leur langue', async () => {
  await reset(); setMail(true);
  process.env.ALERT_EMAIL = 'technique@test.dz'; process.env.CONTACT_EMAIL = 'contact@test.dz';
  await monitor.alert('crash', new Error('a'));
  assert.deepEqual(mails.map(m => m.to), ['technique@test.dz']);

  await reset(); process.env.ALERT_EMAIL = 'pas une adresse'; process.env.CONTACT_EMAIL = 'contact@test.dz';
  await monitor.alert('crash', new Error('b'));
  assert.deepEqual(mails.map(m => m.to), ['contact@test.dz'], 'ALERT_EMAIL invalide ignoré');

  await reset();
  await q(`UPDATE users SET lang = 'ar' WHERE id = $1`, [admin.id]);
  await monitor.alert('crash', new Error('c'));
  assert.deepEqual(mails.map(m => m.to), [admin.email]);
  assert.match(mails[0].subject, ARABIC, 'administrateur arabophone : email en arabe');
  assert.match(mails[0].html, /dir="rtl"/);

  await reset();
  await q(`UPDATE users SET lang = 'fr' WHERE id = $1`, [admin.id]);
  await monitor.alert('crash', new Error('d'));
  assert.doesNotMatch(mails[0].subject, ARABIC);
  await q(`UPDATE users SET banned = true WHERE id = $1`, [admin.id]);
  await reset();
  assert.equal(await monitor.alert('crash', new Error('e')), false, 'administrateur suspendu : personne à prévenir');
  await q(`UPDATE users SET banned = false WHERE id = $1`, [admin.id]);
});

test('le message d\'erreur envoyé est expurgé', async () => {
  await reset(); process.env.ALERT_EMAIL = 'technique@test.dz';
  await monitor.alert('crash', new Error('SMTP refusé pour victime@exemple.dz, téléphone 0661 22 33 44'), 'test');
  assert.doesNotMatch(mails[0].html, /victime|exemple\.dz|0661/);
  assert.match(mails[0].html, /&lt;adresse&gt;/);
});

test('guard : la tâche en échec est signalée sans lever d\'exception ; une tâche réussie rend son résultat', async () => {
  await reset(); process.env.ALERT_EMAIL = 'technique@test.dz';
  const bad = monitor.guard('purge des compteurs', async () => { throw new Error('base injoignable'); });
  await assert.doesNotReject(bad());
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /tâche planifiée/);
  assert.match(mails[0].subject, /purge des compteurs/);
  assert.match(mails[0].html, /base injoignable/);
  assert.equal(await monitor.guard('ok', async x => x * 2)(21), 42);

  await reset(); process.env.ALERT_EMAIL = 'technique@test.dz';
  await monitor.guard('sauvegarde', async () => { throw new Error('pg_dump absent'); }, 'backup')();
  assert.match(mails[0].subject, /sauvegarde de la base/);
});

test('erreur 500 : l\'administrateur est prévenu, le visiteur ne voit qu\'un message générique', async () => {
  await reset(); process.env.ALERT_EMAIL = 'technique@test.dz';
  const original = s.db.pool.query;
  s.db.pool.query = function (sql, ...args) {   // seule la liste publique des annonces échoue : le reste (jeton d'alerte…) fonctionne
    if (typeof sql === 'string' && /FROM properties p/.test(sql)) return Promise.reject(new Error('index corrompu chez client@test.dz'));
    return original.call(this, sql, ...args);
  };
  try {
    const r = await s.request('GET', '/api/properties');
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'Erreur interne du serveur.');
  } finally { s.db.pool.query = original; }
  const end = Date.now() + 1500;
  while (!mails.length && Date.now() < end) await new Promise(r => setTimeout(r, 20));
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /500/);
  assert.doesNotMatch(mails[0].html, /client@test\.dz/);
  // Une erreur du client (4xx) ne déclenche rien
  await reset(); process.env.ALERT_EMAIL = 'technique@test.dz';
  assert.equal((await s.request('GET', '/api/introuvable')).status, 404);
  assert.equal((await s.request('POST', '/api/auth/login', { body: {} })).status, 400);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(mails.length, 0);
});

// Processus réel : un plantage journalise et sort en erreur (pm2 relance), une promesse oubliée journalise et continue.
// EMAIL_HOST vidé : jamais d'email réel, même si le .env de développement en renseigne un.
const child = code => spawnSync(process.execPath, ['-e', code], {
  cwd: ROOT, encoding: 'utf8', timeout: 20000,
  env: { ...process.env, EMAIL_HOST: '', EMAIL_USER: '', NODE_ENV: 'test' },
});

test('plantage du processus : journal expurgé puis arrêt (code 1)', () => {
  const r = child(`require('./server/monitor').installProcessHandlers(); setTimeout(() => { throw new Error('boum pour a@b.dz') }, 10)`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[crash\] exception non gérée/);
  assert.doesNotMatch(r.stderr, /a@b\.dz/);
});

test('promesse rejetée non gérée : journal, le processus continue', () => {
  const r = child(`require('./server/monitor').installProcessHandlers(); Promise.reject(new Error('oubli')); setTimeout(() => process.exit(0), 300)`);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /\[crash\] promesse rejetée non gérée : oubli/);
});

test('les gestionnaires ne s\'installent qu\'une fois', () => {
  const r = child(`const m = require('./server/monitor'); m.installProcessHandlers(); m.installProcessHandlers();
    console.log(process.listenerCount('uncaughtException'), process.listenerCount('unhandledRejection'))`);
  assert.equal(r.stdout.trim(), '1 1');
});
