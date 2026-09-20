// Connexion avec Google : création de compte, rattachement à un compte existant (y compris le piège de la pré-inscription),
// refus des jetons invalides, révocation des sessions. Les certificats de Google sont remplacés par une paire de clés de test.
const test   = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt    = require('jsonwebtoken');

const CLIENT = '1234567890-abcdefg.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_ID = CLIENT;      // avant le chargement de l'application (CSP et bouton dépendent de cette variable)
const { startServer } = require('../helpers/server');
const google = require('../../server/google-auth');
const { AR } = require('../../server/i18n');

const KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
let s, mails;
const q = (sql, p) => s.db.pool.query(sql, p);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const untilNextSecond = () => sleep(1000 - (Date.now() % 1000) + 30);   // les jetons datent de la seconde : évite les égalités

test.before(async () => {
  google.setCertFetcher(async () => ({ certs: { kid1: KEYS.publicKey.export({ type: 'spki', format: 'pem' }) }, ttl: 3600 * 1000 }));
  s = await startServer();
  mails = [];
  require('nodemailer').createTransport = () => ({ sendMail: async o => { mails.push(o); } });
  process.env.EMAIL_HOST = 'smtp.test'; process.env.EMAIL_USER = 'noreply@test.dz';
});
test.after(async () => { google.setCertFetcher(null); await s.stop(); });

let seq = 0;
// Jeton d'identité tel que Google le délivre
const idToken = (claims = {}, opts = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: 'https://accounts.google.com', aud: CLIENT, sub: 'sub-' + (++seq) + '-' + crypto.randomBytes(3).toString('hex'),
    email: `g${seq}-${crypto.randomBytes(2).toString('hex')}@gmail.com`, email_verified: true, name: 'Karim Google', iat: now, exp: now + 3600, ...claims },
    KEYS.privateKey, { algorithm: 'RS256', keyid: 'kid1', ...opts });
};
const login = (credential, headers = {}) => s.request('POST', '/api/auth/google', { body: { credential }, headers });
const userRow = async email => (await q('SELECT * FROM users WHERE email = $1', [email])).rows[0];

test('réglages publics : identifiant client Google, ou rien s\'il n\'est pas configuré', async () => {
  assert.deepEqual((await s.request('GET', '/api/auth/config')).body, { google_client_id: CLIENT });
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    assert.deepEqual((await s.request('GET', '/api/auth/config')).body, { google_client_id: null });
    const off = await login(idToken());
    assert.equal(off.status, 503);
    assert.equal(off.body.error, 'Connexion Google indisponible.');
  } finally { process.env.GOOGLE_CLIENT_ID = CLIENT; }
});

test('première connexion : le compte est créé (adresse confirmée, mot de passe aléatoire) et le jeton de session fonctionne', async () => {
  const claims = { sub: 'sub-nouveau-1', email: 'Nouveau.Membre@Gmail.com', name: '  Nouveau Membre  ', picture: 'https://lh3.googleusercontent.com/a/photo' };
  const r = await login(idToken(claims), { 'X-Lang': 'ar' });
  assert.equal(r.status, 200);
  assert.equal(r.body.created, true);
  assert.equal(r.body.user.email, 'nouveau.membre@gmail.com', 'adresse en minuscules');
  assert.equal(r.body.user.name, 'Nouveau Membre');
  assert.equal(r.body.user.email_verified, true);
  assert.equal(r.body.user.avatar, 'https://lh3.googleusercontent.com/a/photo');
  assert.doesNotMatch(r.text, /password|google_id|sub-nouveau/, 'ni mot de passe ni identifiant Google dans la réponse');
  const row = await userRow('nouveau.membre@gmail.com');
  assert.equal(row.google_id, 'sub-nouveau-1');
  assert.equal(row.lang, 'ar');
  assert.equal(row.verification_token, null);
  assert.match(row.password, /^\$2[aby]\$/, 'un mot de passe existe, mais personne ne le connaît');
  assert.equal((await s.request('GET', '/api/auth/me', { token: r.body.token })).body.email, 'nouveau.membre@gmail.com');
  // Email de bienvenue dans la langue choisie, pas d'email de confirmation d'adresse
  // L'email part après la réponse : on l'attend (3 s au plus) au lieu de supposer un délai fixe
  for (const end = Date.now() + 3000; Date.now() < end && !mails.some(m => m.to === 'nouveau.membre@gmail.com');) await sleep(20);
  const sent = mails.filter(m => m.to === 'nouveau.membre@gmail.com');
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /dir="rtl"/);
});

test('connexions suivantes : même compte, pas de doublon, adresse modifiée chez Google sans effet', async () => {
  const claims = { sub: 'sub-fidele', email: 'fidele@gmail.com' };
  const first = await login(idToken(claims));
  const second = await login(idToken({ ...claims, email: 'nouvelle-adresse@gmail.com', name: 'Autre nom' }));
  assert.equal(second.status, 200);
  assert.equal(second.body.created, false);
  assert.equal(second.body.user.id, first.body.user.id);
  assert.equal(second.body.user.email, 'fidele@gmail.com', 'l\'adresse du compte ne change pas');
  assert.equal((await q('SELECT COUNT(*)::int n FROM users WHERE google_id = $1', ['sub-fidele'])).rows[0].n, 1);
  assert.equal((await q('SELECT COUNT(*)::int n FROM users WHERE email = $1', ['nouvelle-adresse@gmail.com'])).rows[0].n, 0);
});

test('deux premières connexions simultanées : un seul compte créé', async () => {
  const t = idToken({ sub: 'sub-course', email: 'course@gmail.com' });
  const rs = await Promise.all([1, 2, 3, 4].map(() => login(t)));
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200, 200]);
  assert.equal(new Set(rs.map(r => r.body.user.id)).size, 1);
  assert.equal((await q('SELECT COUNT(*)::int n FROM users WHERE email = $1', ['course@gmail.com'])).rows[0].n, 1);
  assert.equal(rs.filter(r => r.body.created).length, 1, 'un seul « créé »');
});

test('adresse déjà inscrite ET confirmée : Google est rattaché, mot de passe et sessions conservés', async () => {
  const u = await s.register('confirme');
  await q('UPDATE users SET email_verified = true, verification_token = NULL WHERE id = $1', [u.id]);
  const r = await login(idToken({ sub: 'sub-confirme', email: u.email.toUpperCase() }));
  assert.equal(r.status, 200);
  assert.equal(r.body.created, false);
  assert.equal(r.body.user.id, u.id);
  assert.equal((await userRow(u.email)).google_id, 'sub-confirme');
  assert.equal((await s.request('POST', '/api/auth/login', { body: { email: u.email, password: 'motdepasse1' } })).status, 200, 'le mot de passe fonctionne toujours');
  assert.equal((await s.request('GET', '/api/auth/me', { token: u.token })).status, 200, 'la session ouverte reste valable');
});

test('pré-inscription par un tiers (adresse jamais confirmée) : le compte est repris, mot de passe et sessions du tiers révoqués', async () => {
  // Le « pirate » inscrit l'adresse de sa victime, garde son mot de passe et son jeton de session
  const pirate = await s.register('victime');
  const row0 = await userRow(pirate.email);
  assert.equal(row0.email_verified, false);
  await s.request('POST', '/api/properties', { token: pirate.token, body: { title: 'Annonce du pirate', mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Oran', photos: [] } });
  await untilNextSecond();
  // La vraie propriétaire de l'adresse se connecte avec Google
  const r = await login(idToken({ sub: 'sub-victime', email: pirate.email, name: 'Vraie Victime' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.user.id, pirate.id, 'même compte (elle retrouve ses éventuelles annonces)');
  const row = await userRow(pirate.email);
  assert.equal(row.google_id, 'sub-victime');
  assert.equal(row.email_verified, true);
  assert.notEqual(row.password, row0.password, 'mot de passe remplacé');
  assert.ok(row.sessions_valid_after, 'sessions révoquées');
  // Le pirate n'a plus aucune prise : ni mot de passe, ni jeton déjà émis, ni via l'administration ou les fiches masquées
  assert.equal((await s.request('POST', '/api/auth/login', { body: { email: pirate.email, password: 'motdepasse1' } })).status, 401);
  assert.equal((await s.request('GET', '/api/auth/me', { token: pirate.token })).status, 401, 'ancien jeton refusé');
  assert.equal((await s.request('POST', '/api/messages', { token: pirate.token, body: { to_id: 1, property_id: 1, body: 'x' } })).status, 401);
  // La propriétaire, elle, est connectée normalement (jeton émis dans la seconde de la révocation ou après)
  assert.equal((await s.request('GET', '/api/auth/me', { token: r.body.token })).status, 200);
});

test('un autre compte Google déjà lié à cette adresse : refus (409), rien n\'est modifié', async () => {
  const first = await login(idToken({ sub: 'sub-premier', email: 'partage@gmail.com' }));
  assert.equal(first.status, 200);
  const other = await login(idToken({ sub: 'sub-second', email: 'partage@gmail.com' }));
  assert.equal(other.status, 409);
  assert.equal(other.body.error, 'Un autre compte Google est déjà associé à cette adresse.');
  assert.equal((await userRow('partage@gmail.com')).google_id, 'sub-premier');
  const ar = await login(idToken({ sub: 'sub-troisieme', email: 'partage@gmail.com' }), { 'X-Lang': 'ar' });
  assert.equal(ar.body.error, AR['Un autre compte Google est déjà associé à cette adresse.']);
});

test('jetons refusés : adresse non confirmée par Google, faux jeton, autre application, expiré', async () => {
  const before = (await q('SELECT COUNT(*)::int n FROM users')).rows[0].n;
  const nv = await login(idToken({ email_verified: false, email: 'pasverifie@gmail.com' }));
  assert.equal(nv.status, 401);
  assert.equal(nv.body.error, 'Adresse Google non vérifiée.');
  assert.equal((await login(idToken({ email_verified: 'true', email: 'texte@gmail.com' }))).status, 401, '« true » textuel refusé : booléen exigé');
  assert.equal((await login(idToken({ email_verified: undefined, email: 'absent@gmail.com' }))).status, 401);
  for (const bad of [idToken({ aud: '999.apps.googleusercontent.com' }), idToken({ iss: 'https://evil.example' }), idToken({ exp: Math.floor(Date.now() / 1000) - 5 }),
                     idToken({}, { keyid: 'kid-inconnu' }), 'abc.def.ghi', jwt.sign({ sub: '1', email: 'x@gmail.com', email_verified: true }, 'secret'), ]) {
    const r = await login(bad);
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'Jeton Google invalide.');
  }
  assert.equal((await q('SELECT COUNT(*)::int n FROM users')).rows[0].n, before, 'aucun compte créé par un jeton refusé');
  const ar = await login('abc.def.ghi', { 'X-Lang': 'ar' });
  assert.equal(ar.body.error, AR['Jeton Google invalide.']);
  assert.equal((await login(idToken({ email_verified: false, email: 'ar@gmail.com' }), { 'X-Lang': 'ar' })).body.error, AR['Adresse Google non vérifiée.']);
});

test('requêtes mal formées : 400', async () => {
  for (const body of [{}, { credential: '' }, { credential: 42 }, { credential: { a: 1 } }, { credential: ['a', 'b'] }, { credential: null }, { credential: 'x'.repeat(4097) }, { credentials: 'x' }])
    assert.equal((await s.request('POST', '/api/auth/google', { body })).status, 400, JSON.stringify(body).slice(0, 40));
  assert.equal((await s.request('POST', '/api/auth/google')).status, 400, 'sans corps');
});

test('compte suspendu : refus (403), pas de jeton', async () => {
  const first = await login(idToken({ sub: 'sub-suspendu', email: 'suspendu@gmail.com' }));
  await q('UPDATE users SET banned = true WHERE id = $1', [first.body.user.id]);
  const r = await login(idToken({ sub: 'sub-suspendu', email: 'suspendu@gmail.com' }));
  assert.equal(r.status, 403);
  assert.ok(!r.body.token);
});

test('nom : repli sur la partie locale de l\'adresse, borné à 100 caractères ; photo seulement en https', async () => {
  const a = await login(idToken({ name: undefined, email: 'sans.nom@gmail.com', picture: 'http://exemple.com/p.jpg' }));
  assert.equal(a.body.user.name, 'sans.nom');
  assert.equal(a.body.user.avatar, '', 'photo en http refusée');
  const b = await login(idToken({ name: 'N'.repeat(300), picture: 'javascript:alert(1)' }));
  assert.equal(b.body.user.name.length, 100);
  assert.equal(b.body.user.avatar, '');
  // https ne suffit pas : seule une photo servie par Google est gardée (l'avatar finit dans un attribut src)
  const pieges = ['https://exemple.com/p.jpg', 'https://lh3.googleusercontent.com@exemple.com/p', 'https://lh3.googleusercontent.com.exemple.com/p',
    'https://lh3.googleusercontent.com/a"onerror="alert(1)', 'https://lh3.googleusercontent.com/' + 'a'.repeat(600)];
  for (const [i, picture] of pieges.entries()) {
    const c = await login(idToken({ sub: `sub-photo-${i}`, email: `photo${i}@gmail.com`, picture }));
    assert.equal(c.status, 200);
    assert.equal(c.body.user.avatar, '', picture.slice(0, 60));
  }
});

test('compte Google : « mot de passe oublié » permet d\'en définir un, et révoque les sessions précédentes', async () => {
  const g = await login(idToken({ sub: 'sub-mdp', email: 'mdp@gmail.com' }));
  await untilNextSecond();
  await s.request('POST', '/api/auth/forgot-password', { body: { email: 'mdp@gmail.com' } });
  const token = (await q('SELECT token FROM password_reset_tokens WHERE user_id = $1', [g.body.user.id])).rows[0].token;
  assert.equal((await s.request('POST', '/api/auth/reset-password', { body: { token, password: 'nouveaumdp1' } })).status, 200);
  assert.equal((await s.request('GET', '/api/auth/me', { token: g.body.token })).status, 401, 'session ouverte avant la réinitialisation : révoquée');
  const pw = await s.request('POST', '/api/auth/login', { body: { email: 'mdp@gmail.com', password: 'nouveaumdp1' } });
  assert.equal(pw.status, 200);
  assert.equal((await s.request('GET', '/api/auth/me', { token: pw.body.token })).status, 200);
  assert.equal((await login(idToken({ sub: 'sub-mdp', email: 'mdp@gmail.com' }))).status, 200, 'Google fonctionne toujours');
});

test('langue : la dernière langue choisie est mémorisée à la reconnexion', async () => {
  const claims = { sub: 'sub-langue', email: 'langue@gmail.com' };
  assert.equal((await userRow((await login(idToken(claims))).body.user.email)).lang, 'fr');
  await login(idToken(claims), { 'X-Lang': 'ar' });
  assert.equal((await userRow('langue@gmail.com')).lang, 'ar');
});

test('politique de sécurité : le script, le cadre et les appels de Google sont autorisés, et la fenêtre d\'ouverture tolère les popups', async () => {
  const r = await s.request('GET', '/');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src [^;]*https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(csp, /frame-src [^;]*https:\/\/accounts\.google\.com\/gsi\//);
  assert.match(csp, /connect-src [^;]*https:\/\/accounts\.google\.com\/gsi\//);
  assert.match(csp, /style-src [^;]*https:\/\/accounts\.google\.com\/gsi\/style/);
  assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  assert.doesNotMatch(csp, /script-src [^;]*\*/, 'aucun joker');
  assert.doesNotMatch(csp, /https:\/\/accounts\.google\.com(?!\/gsi)/, 'seul le chemin /gsi/ est ouvert, pas tout accounts.google.com');
});
