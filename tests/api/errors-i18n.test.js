// Les erreurs de l'API sortent dans la langue du site (X-Lang), sans toucher aux réponses de succès.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const { AR } = require('../../server/i18n');

let s, user;
test.before(async () => { s = await startServer(); user = await s.register('lang'); });
test.after(async () => { await s.stop(); });

const badLogin = headers => s.request('POST', '/api/auth/login', { body: { email: 'inconnu@test.dz', password: 'faux-mot-de-passe' }, headers });

test('sans en-tête : erreurs en français', async () => {
  const r = await badLogin();
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Email ou mot de passe incorrect.');
});

test('X-Lang: ar : même erreur, en arabe, même code HTTP', async () => {
  const r = await badLogin({ 'X-Lang': 'ar' });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, AR['Email ou mot de passe incorrect.']);
});

test('Accept-Language arabe sans X-Lang : arabe ; X-Lang: fr l\'emporte', async () => {
  assert.equal((await badLogin({ 'Accept-Language': 'ar-DZ,ar;q=0.9' })).body.error, AR['Email ou mot de passe incorrect.']);
  assert.equal((await badLogin({ 'Accept-Language': 'ar', 'X-Lang': 'fr' })).body.error, 'Email ou mot de passe incorrect.');
});

test('erreurs des middlewares (jeton, droits) et des routes (404, validation, conflit)', async () => {
  const ar = { 'X-Lang': 'ar' };
  assert.equal((await s.request('GET', '/api/auth/me', { headers: ar })).body.error, AR['Token manquant ou invalide.']);
  assert.equal((await s.request('GET', '/api/admin/users', { token: user.token, headers: ar })).status, 403);
  assert.equal((await s.request('GET', '/api/admin/users', { token: user.token, headers: ar })).body.error, AR['Accès réservé aux administrateurs.']);
  assert.equal((await s.request('GET', '/api/properties/999999', { headers: ar })).body.error, AR['Annonce introuvable.']);
  assert.equal((await s.request('POST', '/api/auth/register', { headers: ar, body: { name: 'X', email: 'pas-un-email', password: 'motdepasse1' } })).body.error,
    AR['Adresse email invalide.']);
  assert.equal((await s.request('POST', '/api/auth/register', { headers: ar, body: { name: 'X', email: user.email, password: 'motdepasse1' } })).body.error,
    AR['Cet email est déjà utilisé.']);
});

test('erreurs techniques : JSON mal formé traduit (au lieu du message anglais du module)', async () => {
  for (const [lang, expected] of [['fr', 'Requête invalide (JSON mal formé).'], ['ar', AR['Requête invalide (JSON mal formé).']]]) {
    const res = await fetch(s.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lang': lang }, body: '{"email": ' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, expected);
  }
});

test('envoi de fichier : erreurs multer traduites (format, taille, fichier absent)', async () => {
  const send = async (lang, build) => {
    const fd = new FormData(); build(fd);
    const res = await fetch(s.base + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + user.token, 'X-Lang': lang }, body: fd });
    return { status: res.status, error: (await res.json()).error };
  };
  const txt = fd => fd.append('file', new Blob(['pas une image'], { type: 'text/plain' }), 'note.txt');
  assert.deepEqual(await send('fr', txt), { status: 400, error: 'Format non supporté. Utilisez JPEG, PNG ou WebP.' });
  assert.deepEqual(await send('ar', txt), { status: 400, error: AR['Format non supporté. Utilisez JPEG, PNG ou WebP.'] });
  assert.equal((await send('ar', () => {})).error, AR['Aucun fichier reçu.']);
  const big = fd => fd.append('file', new Blob([Buffer.alloc(11 * 1024 * 1024)], { type: 'image/png' }), 'gros.png');
  assert.deepEqual(await send('fr', big), { status: 400, error: 'Fichier trop volumineux (10 Mo maximum).' });
  assert.equal((await send('ar', big)).error, AR['Fichier trop volumineux (10 Mo maximum).']);
});

test('les réponses de succès ne sont jamais modifiées', async () => {
  const ok = await s.request('GET', '/api/health', { headers: { 'X-Lang': 'ar' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.match(ok.body.message, /DzImmo/);
  // une annonce dont le titre ressemble à un message d'erreur reste intacte
  const created = await s.request('POST', '/api/properties', { token: user.token, headers: { 'X-Lang': 'ar' }, body: {
    title: 'Annonce introuvable.', mode: 'vente', type_bien: 'villa', price: 1000000, wilaya: 'Oran', photos: [] } });
  assert.equal(created.status, 201);
  const mine = await s.request('GET', `/api/properties/user/${user.id}`, { token: user.token, headers: { 'X-Lang': 'ar' } });
  assert.equal(mine.body.find(p => p.id === created.body.id).title, 'Annonce introuvable.');
});

test('statut non public demandé : refus (403) traduit', async () => {
  const res = await s.request('GET', '/api/properties?status=archived', { headers: { 'X-Lang': 'ar' } });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, AR['Statut non autorisé.']);
});
