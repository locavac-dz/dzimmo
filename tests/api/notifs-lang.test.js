// Emails et notifications temps réel : rédigés dans la langue du destinataire (users.lang),
// mémorisée depuis le choix de langue du site (en-tête X-Lang).
const test   = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer } = require('../helpers/server');

const ARABIC = /[؀-ۿ]/;
let s, ws, mails, wsLog;

// Envois interceptés : aucun SMTP ni WebSocket réel
const settle = async (cond, ms = 1500) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return; await new Promise(r => setTimeout(r, 20)); }
};

test.before(async () => {
  s = await startServer();
  mails = []; wsLog = [];
  const nodemailer = require('nodemailer');
  nodemailer.createTransport = () => ({ sendMail: async o => { mails.push(o); } });
  process.env.EMAIL_HOST = 'smtp.test'; process.env.EMAIL_USER = 'noreply@test.dz';
  ws = require('../../server/ws');
  ws.send = (id, data) => { wsLog.push({ id: Number(id), data }); };
});
test.after(async () => { await s.stop(); });

const dbLang = async id => (await s.db.pool.query('SELECT lang FROM users WHERE id = $1', [id])).rows[0].lang;
const waitLang = async (id, expected) => { await settle(async () => false, 0); const end = Date.now() + 1500; let l; while (Date.now() < end) { l = await dbLang(id); if (l === expected) return l; await new Promise(r => setTimeout(r, 20)); } return l; };
const mailsTo = to => mails.filter(m => m.to === to);
const notifsFor = id => wsLog.filter(w => w.id === id && w.data.type === 'notif').map(w => w.data);

// Inscription dans une langue donnée
async function registerIn(lang, label) {
  const email = `${label}-${crypto.randomBytes(2).toString('hex')}@test.dz`;
  const headers = lang ? { 'X-Lang': lang } : {};
  const r = await s.request('POST', '/api/auth/register', { headers, body: { name: `Test ${label}`, email, password: 'motdepasse1' } });
  assert.equal(r.status, 201);
  return { id: r.body.user.id, email, token: r.body.token };
}

test('inscription en arabe : langue mémorisée, emails de vérification et de bienvenue en arabe', async () => {
  const u = await registerIn('ar', 'inscrit');
  assert.equal(await dbLang(u.id), 'ar');
  await settle(() => mailsTo(u.email).length >= 2);
  const sent = mailsTo(u.email);
  assert.equal(sent.length, 2);
  for (const m of sent) {
    assert.match(m.subject, ARABIC);
    assert.match(m.html, /<html lang="ar" dir="rtl">/);
  }
  assert.ok(sent.some(m => m.subject.includes('أكِّد')), 'email de vérification');
  assert.ok(sent.some(m => m.subject.includes('مرحباً')), 'email de bienvenue');
});

test('inscription sans en-tête de langue : français', async () => {
  const u = await registerIn(null, 'francais');
  assert.equal(await dbLang(u.id), 'fr');
  await settle(() => mailsTo(u.email).length >= 2);
  assert.ok(mailsTo(u.email).every(m => /lang="fr"/.test(m.html) && !ARABIC.test(m.subject)));
});

test('la langue du compte suit le dernier choix sur le site (connexion et requêtes authentifiées)', async () => {
  const u = await registerIn('fr', 'suivi');
  assert.equal(await dbLang(u.id), 'fr');
  await s.request('GET', '/api/auth/me', { token: u.token, headers: { 'X-Lang': 'ar' } });
  assert.equal(await waitLang(u.id, 'ar'), 'ar', 'passage à l\'arabe via une requête authentifiée');
  await s.request('POST', '/api/auth/login', { headers: { 'X-Lang': 'fr' }, body: { email: u.email, password: 'motdepasse1' } });
  assert.equal(await dbLang(u.id), 'fr', 'retour au français à la connexion');
  // sans en-tête explicite (simple Accept-Language du navigateur) : la préférence enregistrée ne bouge pas
  await s.request('GET', '/api/auth/me', { token: u.token, headers: { 'Accept-Language': 'ar' } });
  await new Promise(r => setTimeout(r, 150));
  assert.equal(await dbLang(u.id), 'fr');
});

test('mot de passe oublié : email dans la langue de la demande', async () => {
  const u = await registerIn('fr', 'reset');
  mails.length = 0;
  await s.request('POST', '/api/auth/forgot-password', { headers: { 'X-Lang': 'ar' }, body: { email: u.email } });
  await settle(() => mailsTo(u.email).length >= 1);
  assert.match(mailsTo(u.email)[0].subject, /إعادة تعيين كلمة المرور/);
  mails.length = 0;
  await s.request('POST', '/api/auth/forgot-password', { headers: { 'X-Lang': 'fr' }, body: { email: u.email } });
  await settle(() => mailsTo(u.email).length >= 1);
  assert.match(mailsTo(u.email)[0].subject, /Réinitialisation/);
  // sans en-tête : langue enregistrée du compte
  await s.request('GET', '/api/auth/me', { token: u.token, headers: { 'X-Lang': 'ar' } });
  await waitLang(u.id, 'ar');
  mails.length = 0;
  await s.request('POST', '/api/auth/forgot-password', { body: { email: u.email } });
  await settle(() => mailsTo(u.email).length >= 1);
  assert.match(mailsTo(u.email)[0].subject, /إعادة تعيين/);
});

test('demande de contact : email et notification pour le propriétaire dans sa langue, réponse dans celle du demandeur', async () => {
  const owner = await s.makeAdmin(await registerIn('ar', 'proprio'));     // admin : sa publication est directe
  await s.request('GET', '/api/auth/me', { token: owner.token, headers: { 'X-Lang': 'ar' } });
  const requester = await registerIn('fr', 'demandeur');
  const created = await s.request('POST', '/api/properties', { token: owner.token, body: {
    title: 'Villa test langue', mode: 'vente', type_bien: 'villa', price: 30000000, wilaya: 'Oran', photos: [] } });
  assert.equal(created.body.status, 'active');
  mails.length = 0; wsLog.length = 0;

  const req = await s.request('POST', '/api/contacts', { token: requester.token, headers: { 'X-Lang': 'fr' },
    body: { property_id: created.body.id, type: 'offre', offer_amount: 25000000, message: 'Intéressé' } });
  assert.equal(req.status, 201);

  await settle(() => mailsTo(owner.email).length >= 1 && notifsFor(owner.id).length >= 1);
  const mail = mailsTo(owner.email)[0];
  assert.match(mail.subject, /^📩 عرض سعر — Villa test langue$/);
  assert.match(mail.html, /dir="rtl"/);
  assert.match(mail.html, /25\s?000\s?000 د\.ج/);
  const n = notifsFor(owner.id)[0];
  assert.equal(n.title, 'طلب تواصل جديد');
  assert.match(n.body, /Test demandeur/);
  assert.match(n.body, /Villa test langue/);

  // le propriétaire confirme : le demandeur (français) reçoit la notification en français
  const contactId = req.body.id;
  wsLog.length = 0;
  await s.request('PUT', `/api/contacts/${contactId}/status`, { token: owner.token, body: { status: 'confirmed' } });
  await settle(() => notifsFor(requester.id).length >= 1);
  assert.equal(notifsFor(requester.id)[0].title, 'Demande confirmée !');

  // le demandeur passe à l'arabe : la prochaine notification lui arrive en arabe
  await s.request('GET', '/api/auth/me', { token: requester.token, headers: { 'X-Lang': 'ar' } });
  await waitLang(requester.id, 'ar');
  wsLog.length = 0;
  await s.request('PUT', `/api/contacts/${contactId}/status`, { token: owner.token, body: { status: 'rejected' } });
  await settle(() => notifsFor(requester.id).length >= 1);
  assert.equal(notifsFor(requester.id)[0].title, 'تم رفض طلبك');
});

test('modération : admin (français) prévenu en français, propriétaire (arabe) prévenu en arabe avec le motif traduit', async () => {
  const admin = await s.makeAdmin(await registerIn('fr', 'moderateur'));
  const owner = await registerIn('ar', 'annonceur');
  mails.length = 0; wsLog.length = 0;

  const created = await s.request('POST', '/api/properties', { token: owner.token, body: {
    title: 'Appartement en attente', mode: 'vente', type_bien: 'appartement', price: 9000000, wilaya: 'Alger', photos: [] } });
  assert.equal(created.body.status, 'pending');
  await settle(() => notifsFor(admin.id).length >= 1 && mailsTo(admin.email).length >= 1);
  assert.equal(notifsFor(admin.id)[0].title, 'Annonce à valider');
  assert.match(mailsTo(admin.email)[0].subject, /^🛡️ Annonce à valider/);

  mails.length = 0; wsLog.length = 0;
  await s.request('PUT', `/api/admin/properties/${created.body.id}/moderate`, { token: admin.token,
    body: { decision: 'reject', reason: 'Prix incohérent avec le bien — Trop bas' } });
  await settle(() => notifsFor(owner.id).length >= 1 && mailsTo(owner.email).length >= 1);
  const n = notifsFor(owner.id)[0];
  assert.equal(n.title, 'تم رفض الإعلان');
  assert.match(n.body, /السعر غير منطقي بالنسبة للعقار — Trop bas/, 'motif prédéfini traduit, précision libre conservée');
  const m = mailsTo(owner.email)[0];
  assert.match(m.subject, /^❌ تم رفض إعلانك/);
  assert.match(m.html, /السعر غير منطقي بالنسبة للعقار — Trop bas/);

  mails.length = 0; wsLog.length = 0;
  await s.request('PUT', `/api/admin/properties/${created.body.id}/moderate`, { token: admin.token, body: { decision: 'approve' } });
  await settle(() => notifsFor(owner.id).length >= 1 && mailsTo(owner.email).length >= 1);
  assert.equal(notifsFor(owner.id)[0].title, 'تم نشر الإعلان');
  assert.match(mailsTo(owner.email)[0].subject, /^✅ تم نشر إعلانك/);
});

test('alertes email (tâche horaire réelle) : email dans la langue du destinataire, fenêtre avancée', async () => {
  const { sendSearchAlerts } = require('../../server/alerts-job');
  const ar = await registerIn('ar', 'alerte-ar');
  const fr = await registerIn('fr', 'alerte-fr');
  for (const u of [ar, fr]) await s.request('POST', '/api/alerts', { token: u.token, body: { wilaya: 'Blida', mode: 'vente', type_bien: 'terrain' } });
  await s.db.pool.query("UPDATE search_alerts SET last_sent = NOW() - INTERVAL '1 day'");
  // annonce publiée après la création des alertes (un admin publie directement)
  const admin = await s.makeAdmin(await registerIn('fr', 'publieur'));
  await s.request('POST', '/api/properties', { token: admin.token, body: {
    title: 'Terrain alerte', mode: 'vente', type_bien: 'terrain', price: 12000000, wilaya: 'Blida', photos: [] } });
  // une annonce en attente de modération ne déclenche jamais d'alerte
  const pending = await registerIn('fr', 'enattente');
  const p = await s.request('POST', '/api/properties', { token: pending.token, body: {
    title: 'Terrain non validé', mode: 'vente', type_bien: 'terrain', price: 5000000, wilaya: 'Blida', photos: [] } });
  assert.equal(p.body.status, 'pending');
  mails.length = 0;

  await sendSearchAlerts();

  const mailAr = mailsTo(ar.email), mailFr = mailsTo(fr.email);
  assert.equal(mailAr.length, 1);
  assert.equal(mailFr.length, 1);
  assert.match(mailAr[0].subject, /^🔔 1 إعلان جديد — البليدة · بيع · أرض$/);
  assert.match(mailAr[0].html, /dir="rtl"/);
  assert.match(mailAr[0].html, /Terrain alerte/);
  assert.doesNotMatch(mailAr[0].html, /Terrain non validé/, 'annonce en attente exclue');
  assert.equal(mailFr[0].subject, '🔔 1 nouvelle annonce — Blida · Vente · Terrain');
  assert.match(mailFr[0].html, /lang="fr"/);

  // la fenêtre a avancé : un second passage n'envoie plus rien
  mails.length = 0;
  await sendSearchAlerts();
  assert.equal(mails.length, 0);
});
