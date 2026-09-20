// Formulaires publics sans compte : page Contact (POST /api/contact) et newsletter
// (POST /api/newsletter/subscribe, DELETE /api/newsletter/unsubscribe, GET /api/admin/newsletter).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { startServer, ROOT } = require('../helpers/server');
const { readFront } = require('../helpers/front');

let s, admin;
const mails = [];
let smtpDown = false;
const q = (sql, p) => s.db.pool.query(sql, p);
const post = (url, body, headers) => s.request('POST', url, { body, headers });
const MSG = { name: 'Amina Visiteuse', email: 'Amina@Exemple.dz', subject: 'partenariat', message: 'Bonjour, je souhaite référencer mon agence.' };

test.before(async () => {
  s = await startServer();
  // Faux serveur SMTP : les emails sont gardés en mémoire (smtpDown simule une panne)
  Object.assign(process.env, { EMAIL_HOST: 'smtp.test', EMAIL_USER: 'noreply@dzimmo.test' });
  require('nodemailer').createTransport = () => ({ sendMail: async o => { if (smtpDown) throw new Error('550 refusé pour chef@test.dz'); mails.push(o); } });
  admin = await s.makeAdmin(await s.register('chef'));
  await q("UPDATE users SET lang = 'ar' WHERE id = $1", [admin.id]);
});
test.after(() => s.stop());
test.beforeEach(() => { mails.length = 0; smtpDown = false; delete process.env.CONTACT_EMAIL; });

test('contact : le message arrive aux administrateurs, dans leur langue, avec l\'adresse du visiteur en réponse', async () => {
  const r = await post('/api/contact', MSG);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  const mine = mails.filter(m => m.to === admin.email);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].replyTo, 'amina@exemple.dz');
  assert.notEqual(mine[0].from, mine[0].replyTo, 'le visiteur n\'est jamais l\'expéditeur');
  assert.match(mine[0].subject, /شراكة/);
  assert.match(mine[0].html, /dir="rtl"/);
  assert.match(mine[0].html, /Amina Visiteuse/);
  assert.match(mine[0].html, /référencer mon agence/);
});

test('contact : CONTACT_EMAIL, s\'il est valide, reçoit seul le message ; invalide, il est ignoré', async () => {
  process.env.CONTACT_EMAIL = 'equipe@dzimmo.test';
  assert.equal((await post('/api/contact', MSG)).status, 200);
  assert.deepEqual(mails.map(m => m.to), ['equipe@dzimmo.test']);
  assert.match(mails[0].subject, /Partenariat/);
  mails.length = 0;
  process.env.CONTACT_EMAIL = 'a@b.dz, pirate@c.dz';
  assert.equal((await post('/api/contact', MSG)).status, 200);
  assert.ok(mails.length >= 1 && mails.every(m => !/pirate/.test(m.to)));
});

test('contact : le contenu du visiteur est échappé, un sujet inconnu devient « Autre »', async () => {
  process.env.CONTACT_EMAIL = 'equipe@dzimmo.test';
  const r = await post('/api/contact', { ...MSG, name: '<img src=x onerror=alert(1)>', subject: '__proto__', message: '<script>alert(1)</script> bonjour à tous' });
  assert.equal(r.status, 200);
  assert.doesNotMatch(mails[0].html, /<script>|<img src=x/);
  assert.match(mails[0].html, /&lt;script&gt;/);
  assert.match(mails[0].subject, /Autre/);
});

test('contact : saisies refusées (400), message traduit en arabe, jamais d\'erreur 500', async () => {
  const bad = [
    [{ ...MSG, name: '' }, 'Nom et message requis.'],
    [{ ...MSG, message: undefined }, 'Nom et message requis.'],
    [{ ...MSG, name: ['a'] }, 'Nom et message requis.'],
    [{ ...MSG, name: 'x'.repeat(101) }, 'Nom trop long (100 caractères maximum).'],
    [{ ...MSG, email: 'pas-une-adresse' }, 'Adresse email invalide.'],
    [{ ...MSG, email: 'a@b.dz\r\nBcc: victime@c.dz' }, 'Adresse email invalide.'],
    [{ ...MSG, email: 'a@b.dz, autre@c.dz' }, 'Adresse email invalide.'],
    [{ ...MSG, email: { $ne: 1 } }, 'Adresse email invalide.'],
    [{ ...MSG, email: 'a'.repeat(250) + '@b.dz' }, 'Adresse email invalide.'],
    [{ ...MSG, message: 'court' }, 'Message trop court (10 caractères minimum).'],
    [{ ...MSG, message: 'x'.repeat(5001) }, 'Message trop long (5000 caractères maximum).'],
  ];
  for (const [body, error] of bad) {
    const r = await post('/api/contact', body);
    assert.equal(r.status, 400, error);
    assert.equal(r.body.error, error);
    const ar = await post('/api/contact', body, { 'X-Lang': 'ar' });
    assert.notEqual(ar.body.error, error, 'traduit : ' + error);
    assert.match(ar.body.error, /[؀-ۿ]/);
  }
  assert.equal(mails.length, 0);
  assert.equal((await s.request('POST', '/api/contact')).status, 400, 'corps absent');
});

test('contact : envoi impossible (SMTP en panne ou non configuré) → 503, jamais un faux « envoyé », aucune adresse dans les journaux', async () => {
  smtpDown = true;
  const logged = [];
  const original = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  let r;
  try { r = await post('/api/contact', MSG); } finally { console.error = original; }
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "Votre message n'a pas pu être envoyé. Réessayez plus tard.");
  assert.doesNotMatch(logged.join('\n'), /@/, 'pas d\'adresse email dans les journaux');
  assert.match((await post('/api/contact', MSG, { 'X-Lang': 'ar' })).body.error, /[؀-ۿ]/);
});

test('contact : rien n\'est stocké, /api/contacts (demandes sur une annonce) n\'est pas concerné, le front appelle la bonne route', async () => {
  assert.equal((await s.request('GET', '/api/contact')).status, 404);
  assert.equal((await s.request('GET', '/api/contacts/mine')).status, 401, 'la route des demandes reste protégée');
  assert.equal((await post('/api/contacts', MSG)).status, 401, 'et ne reçoit pas les messages de la page Contact');
  const front = readFront();
  assert.doesNotMatch(front, /newsletter\/contact/, 'ancienne route inexistante');
  assert.match(front, /api\('\/contact', 'POST'/);
  const fn = front.slice(front.indexOf('async function submitContactPage'), front.indexOf('function openChat'));
  assert.doesNotMatch(fn, /catch\s*\{[^}]*Message envoy/, 'un échec ne doit plus afficher « Message envoyé »');
  for (const key of ['ct_sent', 'ct_failed']) assert.equal(front.split(key + ':').length - 1, 2, key + ' en français et en arabe');
  // Le limiteur de ces formulaires publics compte dans PostgreSQL comme les autres
  const app = fs.readFileSync(path.join(ROOT, 'server', 'app.js'), 'utf8');
  assert.match(app, /\.\.\.shared\('contact'\)/);
  for (const route of ['/api/contact', '/api/newsletter']) assert.ok(app.includes(`app.use('${route}', contactLimiter)`), route);
});

test('newsletter : inscription (adresse normalisée, doublon silencieux), désinscription par jeton', async () => {
  const r = await post('/api/newsletter/subscribe', { email: '  Lecteur@Exemple.DZ ' });
  assert.equal(r.status, 200);
  assert.match(r.body.unsubToken, /^[0-9a-f]{32}$/);
  assert.equal((await post('/api/newsletter/subscribe', { email: 'lecteur@exemple.dz' })).status, 200, 'déjà inscrit : silencieux');
  const rows = (await q("SELECT email FROM newsletter_subscribers WHERE email ILIKE 'lecteur@%'")).rows;
  assert.deepEqual(rows, [{ email: 'lecteur@exemple.dz' }]);

  const del = body => s.request('DELETE', '/api/newsletter/unsubscribe', { body });
  assert.equal((await del({ email: 'lecteur@exemple.dz' })).status, 400);
  assert.equal((await del({ email: 'lecteur@exemple.dz', token: 'f'.repeat(32) })).status, 403);
  assert.equal((await del({ email: 'lecteur@exemple.dz', token: 'court' })).status, 403);
  assert.equal((await del({ email: 'autre@exemple.dz', token: r.body.unsubToken })).status, 403, 'le jeton ne vaut que pour son adresse');
  assert.equal((await q("SELECT count(*)::int AS n FROM newsletter_subscribers WHERE email = 'lecteur@exemple.dz'")).rows[0].n, 1);
  assert.equal((await del({ email: 'Lecteur@exemple.dz', token: r.body.unsubToken })).status, 200);
  assert.equal((await q("SELECT count(*)::int AS n FROM newsletter_subscribers WHERE email = 'lecteur@exemple.dz'")).rows[0].n, 0);
});

test('newsletter : une adresse qui n\'est pas une chaîne valide est refusée proprement (400 / 403, jamais 500)', async () => {
  for (const email of [undefined, '', 'sans-arobase', ['a@b.dz'], { a: 1 }, 42, 'a'.repeat(250) + '@b.dz']) {
    const r = await post('/api/newsletter/subscribe', { email });
    assert.equal(r.status, 400, JSON.stringify(email));
    assert.equal(r.body.error, 'Adresse email invalide.');
  }
  for (const body of [{ email: ['a@b.dz'], token: 'x' }, { email: 'a@b.dz', token: ['x'] }, { email: { a: 1 }, token: { b: 2 } }])
    assert.equal((await s.request('DELETE', '/api/newsletter/unsubscribe', { body })).status, 403, JSON.stringify(body));
});

test('newsletter : la liste des abonnés est réservée aux administrateurs et paginée', async () => {
  await q("INSERT INTO newsletter_subscribers (email) SELECT 'abonne' || g || '@exemple.dz' FROM generate_series(1, 30) g");
  const user = await s.register('curieux');
  assert.equal((await s.request('GET', '/api/admin/newsletter')).status, 401);
  assert.equal((await s.request('GET', '/api/admin/newsletter', { token: user.token })).status, 403);
  const p1 = (await s.request('GET', '/api/admin/newsletter?per_page=10', { token: admin.token })).body;
  assert.equal(p1.items.length, 10);
  assert.ok(p1.total >= 30 && p1.pages >= 3);
  const p2 = (await s.request('GET', '/api/admin/newsletter?per_page=10&page=2', { token: admin.token })).body;
  assert.equal(new Set([...p1.items, ...p2.items].map(i => i.id)).size, 20, 'deux pages sans recouvrement');
  const huge = (await s.request('GET', '/api/admin/newsletter?per_page=100000', { token: admin.token })).body;
  assert.ok(huge.items.length <= 200, 'liste bornée');
});
