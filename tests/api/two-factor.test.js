// Double authentification (TOTP) des administrateurs : configuration, connexion en deux étapes, verrou des essais (même en
// simultané), rejeu d'un code, codes de secours, jetons de défi et de session, mode obligatoire, désactivation, Google, arabe.
const test   = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt    = require('jsonwebtoken');

const CLIENT = '1234567890-abcdefg.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_ID = CLIENT;      // avant le chargement de l'application (comme tests/api/google-login.test.js)
const { startServer } = require('../helpers/server');
const google = require('../../server/google-auth');
const { AR } = require('../../server/i18n');

const ARABIC = /[؀-ۿ]/;
const KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
let s, totp, tf, tokens, mails;
const q = (sql, p) => s.db.pool.query(sql, p);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const untilNextSecond = () => sleep(1000 - (Date.now() % 1000) + 30);   // les jetons datent de la seconde (voir server/sessions.js)
const row = async id => (await q('SELECT * FROM users WHERE id = $1', [id])).rows[0];
const post = (path, token, body, headers) => s.request('POST', '/api/auth/2fa' + path, { token, body: body || {}, headers });
const clean = pretty => pretty.replace(/\s/g, '');

test.before(async () => {
  google.setCertFetcher(async () => ({ certs: { kid1: KEYS.publicKey.export({ type: 'spki', format: 'pem' }) }, ttl: 3600 * 1000 }));
  s = await startServer();
  totp = require('../../server/totp');
  tf = require('../../server/two-factor');
  tokens = require('../../server/tokens');
  mails = [];
  require('nodemailer').createTransport = () => ({ sendMail: async o => { mails.push(o); } });
  process.env.EMAIL_HOST = 'smtp.test'; process.env.EMAIL_USER = 'noreply@test.dz';
});
test.after(async () => { google.setCertFetcher(null); delete process.env.ADMIN_2FA_REQUIRED; await s.stop(); });

// Code valide « maintenant » (+ décalage de pas) après avoir oublié le dernier pas accepté : évite d'attendre 30 s entre deux essais
async function codeFor(user, secret, offset = 0) {
  await q('UPDATE users SET totp_last_step = NULL WHERE id = $1', [user.id]);
  return totp.code(secret, totp.stepAt() + offset);
}

// Administrateur avec 2FA activée. Renvoie { user (jeton mfa), secret, codes }
async function adminWith2fa(label = 'admin') {
  const admin = await s.makeAdmin(await s.register(label));
  const setup = await post('/setup', admin.token);
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  const secret = clean(setup.body.secret);
  const enable = await post('/enable', admin.token, { code: await codeFor(admin, secret) });
  assert.equal(enable.status, 200, JSON.stringify(enable.body));
  return { user: { ...admin, token: enable.body.token }, secret, codes: enable.body.recovery_codes };
}

// Première étape de la connexion (mot de passe) : renvoie le jeton de défi
async function challenge(user) {
  const r = await s.request('POST', '/api/auth/login', { body: { email: user.email, password: 'motdepasse1' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.mfa_token, 'défi attendu');
  return r.body.mfa_token;
}

const waitMail = async (test, ms = 3000) => {
  for (const end = Date.now() + ms; Date.now() < end && !mails.some(test);) await sleep(20);
  return mails.filter(test);
};

test('réservé aux administrateurs : un membre ordinaire ne peut rien configurer', async () => {
  const member = await s.register('membre');
  for (const [m, p] of [['GET', ''], ['POST', '/setup'], ['POST', '/enable'], ['POST', '/disable'], ['POST', '/recovery-codes']]) {
    const r = await s.request(m, '/api/auth/2fa' + p, { token: member.token, body: m === 'POST' ? {} : undefined });
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.body.error, 'La double authentification est réservée aux administrateurs.');
  }
  assert.equal((await s.request('GET', '/api/auth/2fa')).status, 401, 'sans connexion');
  const me = await s.request('GET', '/api/auth/me', { token: member.token });
  assert.equal(me.body.two_factor, false);
  assert.equal(me.body.two_factor_required, false);
});

test('configuration : secret chiffré au repos, QR, activation seulement avec un code valide, codes de secours montrés une fois', async () => {
  const admin = await s.makeAdmin(await s.register('admin'));
  assert.deepEqual((await s.request('GET', '/api/auth/2fa', { token: admin.token })).body, { enabled: false, required: false, recovery_left: 0 });
  assert.equal((await post('/enable', admin.token, { code: '123456' })).body.error, 'Lancez d\'abord la configuration de la double authentification.');

  const setup = await post('/setup', admin.token);
  assert.equal(setup.status, 200);
  const secret = clean(setup.body.secret);
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.body.secret, /^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/, 'groupes de 4');
  assert.match(setup.body.uri, /^otpauth:\/\/totp\/DzImmo%3A/);
  assert.ok(setup.body.uri.includes('secret=' + secret));
  assert.match(setup.body.qr_svg, /^<svg[\s\S]*<\/svg>$/);
  const stored = (await row(admin.id)).totp_secret;
  assert.ok(stored && !stored.includes(secret), 'le secret n\'est pas stocké en clair');
  assert.equal(tf.decrypt(stored), secret);
  assert.equal((await row(admin.id)).totp_enabled_at, null, 'rien n\'est protégé avant le premier code');

  // Mauvais code, puis code de secours inexistant : aucune activation
  assert.equal((await post('/enable', admin.token, { code: '000000' })).status, 401);
  assert.equal((await post('/enable', admin.token, { code: 'abcde-fghij' })).status, 401);
  assert.equal((await post('/enable', admin.token, {})).status, 400);
  assert.equal((await row(admin.id)).totp_enabled_at, null);

  await untilNextSecond();   // le jeton d'origine doit dater d'avant la révocation
  const ok = await post('/enable', admin.token, { code: await codeFor(admin, secret) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.recovery_codes.length, tf.RECOVERY_COUNT);
  for (const c of ok.body.recovery_codes) assert.match(c, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
  assert.equal(new Set(ok.body.recovery_codes).size, tf.RECOVERY_COUNT);
  assert.equal(ok.body.user.two_factor, true);
  assert.equal(jwt.decode(ok.body.token).mfa, true, 'la session qui vient d\'activer est déjà validée');
  const after = await row(admin.id);
  assert.ok(after.totp_enabled_at);
  assert.equal(after.totp_recovery.length, tf.RECOVERY_COUNT);
  assert.ok(!after.totp_recovery.some(h => ok.body.recovery_codes.includes(h)), 'seuls les empreintes des codes de secours sont stockées');

  // Les autres sessions sont fermées, l'état est visible, une seconde configuration est refusée
  assert.equal((await s.request('GET', '/api/auth/me', { token: admin.token })).status, 401, 'ancien jeton révoqué');
  assert.deepEqual((await s.request('GET', '/api/auth/2fa', { token: ok.body.token })).body,
    { enabled: true, required: false, recovery_left: tf.RECOVERY_COUNT });
  assert.equal((await post('/setup', ok.body.token)).status, 409);
  assert.equal((await post('/enable', ok.body.token, { code: '123456' })).status, 409);
  const notice = await waitMail(m => m.to === admin.email && /🔐/.test(m.subject));
  assert.equal(notice.length, 1, 'email d\'alerte de sécurité');
  assert.doesNotMatch(notice[0].html, new RegExp(secret + '|' + ok.body.recovery_codes[0]), 'ni secret ni code dans l\'email');
});

test('connexion en deux étapes : le mot de passe seul ne donne ni jeton ni fiche ; le bon code ouvre une session complète', async () => {
  const { user, secret } = await adminWith2fa();
  const first = await s.request('POST', '/api/auth/login', { body: { email: user.email, password: 'motdepasse1' } });
  assert.equal(first.status, 200);
  assert.deepEqual(Object.keys(first.body).sort(), ['mfa_required', 'mfa_token']);
  assert.equal(first.body.mfa_required, true);
  // Mauvais mot de passe : toujours refusé avant tout défi
  assert.equal((await s.request('POST', '/api/auth/login', { body: { email: user.email, password: 'faux' } })).status, 401);

  const bad = await post('/login', null, { mfa_token: first.body.mfa_token, code: '000000' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, 'Code de vérification incorrect.');
  assert.equal((await post('/login', null, { mfa_token: first.body.mfa_token })).status, 400);
  assert.equal((await post('/login', null, { code: '123456' })).status, 400);
  assert.equal((await post('/login', null, { mfa_token: 'n-importe-quoi', code: '123456' })).status, 401);

  const ok = await post('/login', null, { mfa_token: first.body.mfa_token, code: await codeFor(user, secret, 1) });
  assert.equal(ok.status, 200);
  assert.equal(jwt.decode(ok.body.token).mfa, true);
  assert.equal(ok.body.user.two_factor, true);
  assert.equal(ok.body.user.is_admin, true);
  assert.doesNotMatch(ok.text, /totp|secret|recovery/i, 'aucun secret dans la réponse');
  assert.equal((await s.request('GET', '/api/admin/users', { token: ok.body.token })).status, 200);
});

test('jeton de défi : n\'ouvre aucune route, expire, ne sert qu\'à la seconde étape', async () => {
  const { user, secret } = await adminWith2fa();
  const mfaToken = await challenge(user);
  for (const path of ['/api/auth/me', '/api/admin/users', '/api/auth/2fa'])
    assert.equal((await s.request('GET', path, { token: mfaToken })).status, 401, path);
  // Un jeton de session (même valide) n'est pas un défi
  assert.equal((await post('/login', null, { mfa_token: user.token, code: await codeFor(user, secret) })).status, 401);
  // Défi expiré
  const expired = jwt.sign({ id: user.id, purpose: 'mfa' }, crypto.createHmac('sha256', 'secret-de-test').update('mfa-challenge').digest('hex'), { expiresIn: -10 });
  assert.equal((await post('/login', null, { mfa_token: expired, code: await codeFor(user, secret) })).body.error, 'Connexion expirée. Reconnectez-vous.');
  // Défi antérieur à une révocation des sessions
  await untilNextSecond();
  const old = await challenge(user);
  await untilNextSecond();
  await q('UPDATE users SET sessions_valid_after = NOW() WHERE id = $1', [user.id]);
  assert.equal((await post('/login', null, { mfa_token: old, code: await codeFor(user, secret) })).status, 401);
});

test('session sans double authentification : refusée par l\'administration, même avec le rôle admin dans le jeton', async () => {
  const { user } = await adminWith2fa();
  const dbUser = await row(user.id);
  const plain = tokens.sign(dbUser);                       // ce que donnerait un mot de passe volé
  const full  = tokens.sign(dbUser, { mfa: true });
  const denied = await s.request('GET', '/api/admin/users', { token: plain });
  assert.equal(denied.status, 401);
  assert.equal(denied.body.error, 'Double authentification requise.');
  assert.equal((await s.request('GET', '/api/admin/users', { token: full })).status, 200);
  // Sur les routes ordinaires, le jeton simple n'a pas les pouvoirs d'un administrateur (voir les annonces en attente…)
  const asMember = await s.request('GET', '/api/properties?status=pending', { token: plain });
  assert.equal(asMember.status, 403);
  assert.equal((await s.request('GET', '/api/properties?status=pending', { token: full })).status, 200);
});

test('verrou : 5 codes faux, même lancés ensemble, verrouillent le compte 15 minutes ; le bon code n\'y change rien', async () => {
  const { user, secret } = await adminWith2fa();
  const mfaToken = await challenge(user);
  const rs = await Promise.all(Array.from({ length: 12 }, () => post('/login', null, { mfa_token: mfaToken, code: '000000' })));
  assert.equal(rs.filter(r => r.status === 401).length, tf.MAX_ATTEMPTS, 'exactement 5 essais comptés');
  assert.equal(rs.filter(r => r.status === 429).length, 12 - tf.MAX_ATTEMPTS);
  assert.equal(rs.find(r => r.status === 429).body.error, 'Trop de tentatives. Réessayez dans 15 minutes.');
  const locked = await post('/login', null, { mfa_token: mfaToken, code: await codeFor(user, secret) });
  assert.equal(locked.status, 429, 'le bon code est refusé pendant le verrou');
  const r = await row(user.id);
  assert.ok(new Date(r.totp_locked_until) > new Date(Date.now() + 10 * 60000), 'verrou d\'environ 15 minutes');
  // Le verrou expiré, le compteur repart de zéro
  await q(`UPDATE users SET totp_locked_until = NOW() - interval '1 minute' WHERE id = $1`, [user.id]);
  assert.equal((await post('/login', null, { mfa_token: mfaToken, code: '000000' })).status, 401);
  assert.equal((await row(user.id)).totp_failures, 1);
  const ok = await post('/login', null, { mfa_token: mfaToken, code: await codeFor(user, secret) });
  assert.equal(ok.status, 200);
  assert.equal((await row(user.id)).totp_failures, 0, 'un succès remet le compteur à zéro');
});

test('rejeu : un code déjà utilisé est refusé, même dans sa fenêtre de validité', async () => {
  const { user, secret } = await adminWith2fa();
  const code = await codeFor(user, secret, 1);
  assert.equal((await post('/login', null, { mfa_token: await challenge(user), code })).status, 200);
  assert.equal((await post('/login', null, { mfa_token: await challenge(user), code })).status, 401, 'même code : refusé');
  const earlier = totp.code(secret, totp.stepAt());
  assert.equal((await post('/login', null, { mfa_token: await challenge(user), code: earlier })).status, 401, 'pas antérieur : refusé');
  // Deux soumissions simultanées du même code : une seule réussit
  await q('UPDATE users SET totp_last_step = NULL WHERE id = $1', [user.id]);
  const rs = await Promise.all([1, 2, 3].map(async () => post('/login', null, { mfa_token: await challenge(user), code: earlier })));
  assert.equal(rs.filter(r => r.status === 200).length, 1);
});

test('codes de secours : à usage unique, tolérants à la saisie, email d\'alerte, nombre restant', async () => {
  const { user, codes } = await adminWith2fa();
  const first = await post('/login', null, { mfa_token: await challenge(user), code: codes[0].toUpperCase().replace('-', ' ') });
  assert.equal(first.status, 200);
  assert.equal(first.body.recovery_left, tf.RECOVERY_COUNT - 1);
  assert.equal(jwt.decode(first.body.token).mfa, true);
  const again = await post('/login', null, { mfa_token: await challenge(user), code: codes[0] });
  assert.equal(again.status, 401, 'un code de secours ne sert qu\'une fois');
  assert.equal((await post('/login', null, { mfa_token: await challenge(user), code: codes[1].replace('-', '') })).status, 200);
  assert.equal((await s.request('GET', '/api/auth/2fa', { token: first.body.token })).body.recovery_left, tf.RECOVERY_COUNT - 2);
  const sent = await waitMail(m => m.to === user.email && /🔐/.test(m.subject) && m.html.includes('secours'));
  assert.ok(sent.length >= 1, 'email de prévenance à l\'usage d\'un code de secours');
  // Ni un code de l'autre compte ni un code approximatif
  const other = await adminWith2fa('autre');
  assert.equal((await post('/login', null, { mfa_token: await challenge(user), code: other.codes[0] })).status, 401);
  assert.equal((await post('/login', null, { mfa_token: await challenge(user), code: codes[2].slice(0, 9) })).status, 401);
});

test('renouvellement des codes de secours : il faut un code valide, les anciens cessent de fonctionner', async () => {
  const { user, secret, codes } = await adminWith2fa();
  assert.equal((await post('/recovery-codes', user.token, { code: '000000' })).status, 401);
  assert.equal((await post('/recovery-codes', user.token, {})).status, 400);
  const r = await post('/recovery-codes', user.token, { code: await codeFor(user, secret) });
  assert.equal(r.status, 200);
  assert.equal(r.body.recovery_codes.length, tf.RECOVERY_COUNT);
  assert.ok(!r.body.recovery_codes.some(c => codes.includes(c)));
  assert.equal((await post('/login', null, { mfa_token: await challenge(user), code: codes[0] })).status, 401, 'ancien code');
  assert.equal((await post('/login', null, { mfa_token: await challenge(user), code: r.body.recovery_codes[0] })).status, 200);
  const notice = await waitMail(m => m.to === user.email && /🔐/.test(m.subject) && m.html.includes('Nouveaux codes de secours'));
  assert.ok(notice.length >= 1);
});

test('désactivation : mot de passe ET code, sessions fermées, secret effacé, email d\'alerte', async () => {
  const { user, secret } = await adminWith2fa();
  assert.equal((await post('/disable', user.token, { password: 'faux', code: await codeFor(user, secret) })).body.error, 'Mot de passe incorrect.');
  assert.equal((await post('/disable', user.token, { code: await codeFor(user, secret) })).status, 401, 'sans mot de passe');
  assert.equal((await post('/disable', user.token, { password: 'motdepasse1', code: '000000' })).status, 401);
  assert.equal((await post('/disable', user.token, { password: 'motdepasse1' })).status, 400);
  assert.ok((await row(user.id)).totp_enabled_at, 'toujours activée');

  await untilNextSecond();
  const ok = await post('/disable', user.token, { password: 'motdepasse1', code: await codeFor(user, secret, 1) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.two_factor, false);
  assert.equal(jwt.decode(ok.body.token).mfa, undefined);
  const r = await row(user.id);
  assert.deepEqual([r.totp_secret, r.totp_enabled_at, r.totp_last_step, r.totp_recovery, r.totp_failures, r.totp_locked_until],
    [null, null, null, [], 0, null]);
  assert.equal((await s.request('GET', '/api/auth/me', { token: user.token })).status, 401, 'ancien jeton révoqué');
  assert.equal((await post('/disable', ok.body.token, { password: 'motdepasse1', code: '123456' })).status, 409);
  assert.equal((await post('/recovery-codes', ok.body.token, { code: '123456' })).status, 409);
  // Sans 2FA, la connexion redevient directe
  assert.ok((await s.request('POST', '/api/auth/login', { body: { email: user.email, password: 'motdepasse1' } })).body.token);
  assert.ok((await waitMail(m => m.to === user.email && /🔐/.test(m.subject) && m.html.includes('désactiv'))).length >= 1);
});

test('mode obligatoire : un administrateur sans 2FA doit la configurer avant d\'utiliser l\'administration', async () => {
  process.env.ADMIN_2FA_REQUIRED = 'true';
  try {
    assert.equal(tf.required(), true);
    const admin = await s.makeAdmin(await s.register('obligatoire'));
    const member = await s.register('simple');
    const login = await s.request('POST', '/api/auth/login', { body: { email: admin.email, password: 'motdepasse1' } });
    assert.equal(login.body.user.two_factor_required, true, 'le site doit ouvrir l\'écran de configuration');
    assert.equal((await s.request('POST', '/api/auth/login', { body: { email: member.email, password: 'motdepasse1' } })).body.user.two_factor_required, false);

    const blocked = await s.request('GET', '/api/admin/users', { token: admin.token });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'mfa_setup_required');
    assert.equal(blocked.body.error, 'Activez la double authentification pour utiliser l\'administration.');
    const ar = await s.request('GET', '/api/admin/users', { token: admin.token, headers: { 'X-Lang': 'ar' } });
    assert.equal(ar.body.error, AR['Activez la double authentification pour utiliser l\'administration.']);

    // La configuration, elle, reste possible ; ensuite l'administration s'ouvre
    const setup = await post('/setup', admin.token);
    assert.equal(setup.status, 200);
    assert.equal((await s.request('GET', '/api/auth/2fa', { token: admin.token })).body.required, true);
    const done = await post('/enable', admin.token, { code: await codeFor(admin, clean(setup.body.secret)) });
    assert.equal(done.status, 200);
    assert.equal(done.body.user.two_factor_required, false);
    assert.equal((await s.request('GET', '/api/admin/users', { token: done.body.token })).status, 200);
  } finally { delete process.env.ADMIN_2FA_REQUIRED; }
  assert.equal(tf.required({ NODE_ENV: 'production' }), true, 'obligatoire par défaut en production');
  assert.equal(tf.required({ NODE_ENV: 'production', ADMIN_2FA_REQUIRED: 'false' }), false);
  assert.equal(tf.required({ NODE_ENV: 'development' }), false);
  assert.equal(tf.required({ NODE_ENV: 'development', ADMIN_2FA_REQUIRED: ' TRUE ' }), true);
});

test('rétrogradation : un ancien administrateur garde sa 2FA mais ne peut plus la reconfigurer', async () => {
  const { user, secret } = await adminWith2fa();
  await q('UPDATE users SET is_admin = false WHERE id = $1', [user.id]);
  assert.equal((await post('/disable', user.token, { password: 'motdepasse1', code: await codeFor(user, secret) })).status, 403);
  assert.equal((await s.request('GET', '/api/admin/users', { token: user.token })).status, 403);
});

test('compte suspendu : le défi ne donne pas de session', async () => {
  const { user, secret } = await adminWith2fa();
  const mfaToken = await challenge(user);
  await q('UPDATE users SET banned = true WHERE id = $1', [user.id]);
  const r = await post('/login', null, { mfa_token: mfaToken, code: await codeFor(user, secret) });
  assert.equal(r.status, 403);
  assert.equal(r.body.token, undefined);
});

test('Google : la 2FA s\'applique aussi à la connexion Google, et la désactivation n\'y demande pas de mot de passe', async () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://accounts.google.com', aud: CLIENT, sub: 'sub-2fa-1', email: 'admin.google@gmail.com', email_verified: true, name: 'Admin Google', iat: now, exp: now + 3600 };
  const idToken = () => jwt.sign(claims, KEYS.privateKey, { algorithm: 'RS256', keyid: 'kid1' });
  const g = await s.request('POST', '/api/auth/google', { body: { credential: idToken() } });
  assert.equal(g.status, 200);
  const id = g.body.user.id;
  await q('UPDATE users SET is_admin = true WHERE id = $1', [id]);
  const setup = await post('/setup', g.body.token);
  const secret = clean(setup.body.secret);
  assert.equal((await post('/enable', g.body.token, { code: await codeFor({ id }, secret) })).status, 200);

  const again = await s.request('POST', '/api/auth/google', { body: { credential: idToken() } });
  assert.equal(again.status, 200);
  assert.equal(again.body.mfa_required, true);
  assert.equal(again.body.token, undefined, 'Google seul ne donne pas de session');
  assert.equal(again.body.user, undefined);
  const ok = await post('/login', null, { mfa_token: again.body.mfa_token, code: await codeFor({ id }, secret, 1) });
  assert.equal(ok.status, 200);
  assert.equal((await s.request('GET', '/api/admin/users', { token: ok.body.token })).status, 200);

  const off = await post('/disable', ok.body.token, { code: await codeFor({ id }, secret) });
  assert.equal(off.status, 200, JSON.stringify(off.body));
});

test('arabe : erreurs traduites, emails d\'alerte dans la langue du compte', async () => {
  const bad = await post('/login', null, { mfa_token: 'x', code: '123456' }, { 'X-Lang': 'ar' });
  assert.equal(bad.body.error, AR['Connexion expirée. Reconnectez-vous.']);
  assert.match(bad.body.error, ARABIC);
  const { user, secret } = await adminWith2fa('arabe');
  await q(`UPDATE users SET lang = 'ar' WHERE id = $1`, [user.id]);
  assert.equal((await post('/login', null, { mfa_token: await challenge(user), code: '000000' }, { 'X-Lang': 'ar' })).body.error, AR['Code de vérification incorrect.']);
  mails.length = 0;
  await post('/recovery-codes', user.token, { code: await codeFor(user, secret) });
  const [m] = await waitMail(x => x.to === user.email);
  assert.match(m.subject, ARABIC);
  assert.match(m.html, /dir="rtl"/);
});
