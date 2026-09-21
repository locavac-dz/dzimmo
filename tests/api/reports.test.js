// Signalements d'annonces : dépôt (un par membre et par annonce, plafond quotidien), retrait automatique quand assez de membres
// fiables et différents ont signalé la même annonce, exemptions, décision d'un administrateur, notifications FR / AR.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

const ARABIC = /[؀-ۿ]/;
let s, admin, mails, wsLog;
const q = (sql, params) => s.db.pool.query(sql, params);

const settle = async (cond, ms = 1500) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return; await new Promise(r => setTimeout(r, 20)); }
};

test.before(async () => {
  s = await startServer();
  admin = await s.makeAdmin(await s.register('admin'));
  mails = []; wsLog = [];
  require('nodemailer').createTransport = () => ({ sendMail: async o => { mails.push(o); } });
  process.env.EMAIL_HOST = 'smtp.test'; process.env.EMAIL_USER = 'noreply@test.dz';
  require('../../server/ws').send = (id, data) => { wsLog.push({ id: Number(id), data }); };
});
test.after(async () => { await s.stop(); });

const notifsFor = (id, type) => wsLog.filter(w => w.id === id && w.data.type === 'notif' && (!type || w.data.notif_type === type)).map(w => w.data);

// Annonce publiée appartenant à `owner` (créée par un admin, puis rattachée au membre)
async function listing(owner, title = 'Bien signalé') {
  const r = await s.request('POST', '/api/properties', { token: admin.token, body: {
    title, mode: 'vente', type_bien: 'appartement', price: 10000000, wilaya: 'Oran', photos: [] } });
  assert.equal(r.status, 201);
  await q(`UPDATE properties SET owner_id = $1, status = 'active' WHERE id = $2`, [owner.id, r.body.id]);
  return r.body.id;
}
const statusOf = async id => (await q('SELECT status FROM properties WHERE id = $1', [id])).rows[0].status;

// Membre dont le signalement compte : email confirmé, inscrit depuis plus de 24 h
async function reliable(label = 'membre') {
  const u = await s.register(label);
  await q(`UPDATE users SET email_verified = true, created_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [u.id]);
  return u;
}
const report = (user, id, motif = 'arnaque', message) =>
  s.request('POST', `/api/properties/${id}/signaler`, { token: user.token, body: { motif, message } });

test('dépôt : connexion, motif, annonce existante, pas sa propre annonce', async () => {
  const owner = await s.register('proprio');
  const id = await listing(owner);
  const u = await reliable();
  assert.equal((await s.request('POST', `/api/properties/${id}/signaler`, { body: { motif: 'faux' } })).status, 401);
  assert.equal((await s.request('POST', `/api/properties/${id}/signaler`, { token: u.token, body: {} })).status, 400);
  assert.equal((await report(u, 999999)).status, 404);
  assert.equal((await report(u, 'abc')).status, 404);
  const own = await report(owner, id);
  assert.equal(own.status, 400);
  assert.match(own.body.error, /propre annonce/);
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM signalements WHERE property_id = $1', [id])).rows[0].n, 0);
  assert.equal((await report(u, id, 'faux', 'Photos volées')).status, 200);
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM signalements WHERE property_id = $1', [id])).rows[0].n, 1);
});

test('dépôt répété : réponse identique, une seule ligne, une seule alerte pour les administrateurs', async () => {
  const owner = await s.register('proprio');
  const id = await listing(owner);
  const u = await reliable();
  const avant = notifsFor(admin.id, 'report_new').length;
  for (let i = 0; i < 3; i++) assert.equal((await report(u, id)).status, 200);
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM signalements WHERE property_id = $1', [id])).rows[0].n, 1);
  await settle(() => notifsFor(admin.id, 'report_new').length > avant);
  assert.equal(notifsFor(admin.id, 'report_new').length, avant + 1);
});

test('retrait automatique : au troisième membre fiable, l’annonce repasse en modération et le propriétaire est prévenu', async () => {
  const owner = await s.register('proprio');
  await q(`UPDATE users SET lang = 'ar' WHERE id = $1`, [owner.id]);
  const id = await listing(owner, 'Villa très signalée');
  const [a, b, c] = [await reliable(), await reliable(), await reliable()];
  await report(a, id); await report(b, id);
  assert.equal(await statusOf(id), 'active');
  await report(c, id);
  assert.equal(await statusOf(id), 'pending');
  const row = (await q('SELECT moderation_reason, moderated_by FROM properties WHERE id = $1', [id])).rows[0];
  assert.equal(row.moderation_reason, 'Annonce signalée par plusieurs membres');
  assert.equal(row.moderated_by, null);
  // invisible du public
  assert.notEqual((await s.request('GET', `/api/properties/${id}`)).status, 200);

  // propriétaire (arabe) : notification temps réel et email
  const about = to => mails.find(m => m.to === to && m.html.includes('Villa très signalée'));   // hors emails d'inscription
  await settle(() => notifsFor(owner.id, 'report_owner').length > 0 && about(owner.email));
  assert.equal(notifsFor(owner.id, 'report_owner').length, 1);
  const mail = about(owner.email);
  assert.ok(mail, 'email au propriétaire');
  assert.match(mail.subject, ARABIC);
  assert.match(mail.html, /<html lang="ar" dir="rtl">/);
  // administrateur (français) : notification et email
  await settle(() => notifsFor(admin.id, 'report_hidden').some(n => n.link_id === id) && about(admin.email));
  assert.ok(notifsFor(admin.id, 'report_hidden').some(n => n.link_id === id));
  const adminMail = about(admin.email);
  assert.ok(adminMail, 'email à l’administrateur');
  assert.doesNotMatch(adminMail.subject, ARABIC);
});

test('les comptes non fiables ne comptent pas dans le seuil (email non confirmé, compte récent, compte suspendu)', async () => {
  const owner = await s.register('proprio');
  const id = await listing(owner);
  const fiable = await reliable();
  const nonConfirme = await s.register('nonconfirme');                       // email non confirmé
  const recent = await s.register('recent');                                   // confirmé, mais inscrit à l'instant
  await q('UPDATE users SET email_verified = true WHERE id = $1', [recent.id]);
  const suspendu = await reliable('suspendu');
  for (const u of [fiable, nonConfirme, recent, suspendu]) assert.equal((await report(u, id)).status, 200);
  await q('UPDATE users SET banned = true WHERE id = $1', [suspendu.id]);
  const dernier = await reliable();
  await report(dernier, id);                                                    // 2 membres fiables seulement
  assert.equal(await statusOf(id), 'active');
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM signalements WHERE property_id = $1', [id])).rows[0].n, 5);
  await report(await reliable(), id);                                           // le troisième membre fiable déclenche
  assert.equal(await statusOf(id), 'pending');
});

test('exemptions : annonceur vérifié, administrateur, agence vérifiée ne sont jamais retirés automatiquement', async () => {
  const verifie = await s.register('verifie');
  await q(`UPDATE users SET verified_kind = 'identity' WHERE id = $1`, [verifie.id]);
  const adm = await s.makeAdmin(await s.register('adminproprio'));
  const pro = await s.register('agence');
  await q(`INSERT INTO agencies (owner_id, name, verified) VALUES ($1, 'Agence test', true)`, [pro.id]);
  for (const owner of [verifie, adm, pro]) {
    const id = await listing(owner);
    for (let i = 0; i < 4; i++) assert.equal((await report(await reliable(), id)).status, 200);
    assert.equal(await statusOf(id), 'active', `annonce de ${owner.email}`);
    assert.equal((await q(`SELECT COUNT(*)::int AS n FROM signalements WHERE property_id = $1 AND status = 'pending'`, [id])).rows[0].n, 4);
  }
});

test('REPORT_AUTO_HIDE=0 désactive le retrait automatique', async () => {
  const avant = process.env.REPORT_AUTO_HIDE;
  process.env.REPORT_AUTO_HIDE = '0';
  try {
    const id = await listing(await s.register('proprio'));
    for (let i = 0; i < 4; i++) await report(await reliable(), id);
    assert.equal(await statusOf(id), 'active');
  } finally {
    if (avant === undefined) delete process.env.REPORT_AUTO_HIDE; else process.env.REPORT_AUTO_HIDE = avant;
  }
});

test('plafond : 10 signalements par membre et par 24 h, puis 429', async () => {
  const u = await reliable('bavard');
  const ids = [];
  for (let i = 0; i < 11; i++) ids.push(await listing(await s.register('proprio'), `Plafond ${i}`));
  for (let i = 0; i < 10; i++) assert.equal((await report(u, ids[i], 'autre')).status, 200);
  const r = await report(u, ids[10], 'autre');
  assert.equal(r.status, 429);
  assert.match(r.body.error, /Trop de signalements/);
  // le plafond porte sur 24 h glissantes : un signalement plus ancien libère une place
  await q(`UPDATE signalements SET created_at = NOW() - INTERVAL '25 hours' WHERE user_id = $1 AND property_id = $2`, [u.id, ids[0]]);
  assert.equal((await report(u, ids[10], 'autre')).status, 200);
});

test('annonce approuvée par un administrateur : signalements classés, nouveau retrait seulement après de nouveaux signalements', async () => {
  const owner = await s.register('proprio');
  const id = await listing(owner);
  const trois = [await reliable(), await reliable(), await reliable()];
  for (const u of trois) await report(u, id);
  assert.equal(await statusOf(id), 'pending');

  const ok = await s.request('PUT', `/api/admin/properties/${id}/moderate`, { token: admin.token, body: { decision: 'approve' } });
  assert.equal(ok.status, 200);
  assert.equal(await statusOf(id), 'active');
  const cls = (await q(`SELECT status, resolved_by FROM signalements WHERE property_id = $1`, [id])).rows;
  assert.equal(cls.length, 3);
  assert.ok(cls.every(r => r.status === 'dismissed' && r.resolved_by === admin.id));

  // les mêmes membres peuvent signaler à nouveau ; deux ne suffisent pas, le troisième retire l'annonce
  await report(trois[0], id); await report(trois[1], id);
  assert.equal(await statusOf(id), 'active');
  await report(trois[2], id);
  assert.equal(await statusOf(id), 'pending');
});

test('administration : liste avec état de l’annonce, rejet depuis un signalement, classement des autres signalements', async () => {
  const owner = await s.register('proprio');
  const id = await listing(owner, 'Annonce à retirer');
  const [a, b] = [await reliable(), await reliable()];
  await report(a, id, 'arnaque', 'Demande un virement avant visite');
  await report(b, id, 'faux');

  const liste = await s.request('GET', '/api/admin/signalements?status=pending', { token: admin.token });
  assert.equal(liste.status, 200);
  const lignes = liste.body.items.filter(r => r.property_id === id);
  assert.equal(lignes.length, 2);
  assert.ok(lignes.every(r => r.property_status === 'active' && r.property_pending === 2 && r.property_title === 'Annonce à retirer'));
  assert.equal((await s.request('GET', '/api/admin/signalements', { token: a.token })).status, 403);

  const sid = lignes.find(r => r.user_id === a.id).id;
  assert.equal((await s.request('PUT', `/api/admin/signalements/${sid}/resolve`, { token: admin.token, body: { status: 'nimporte' } })).status, 400);
  assert.equal((await s.request('PUT', '/api/admin/signalements/999999/resolve', { token: admin.token, body: { status: 'resolved' } })).status, 404);
  // « rejeter » n'a de sens qu'avec « résolu » et un motif
  assert.equal((await s.request('PUT', `/api/admin/signalements/${sid}/resolve`, { token: admin.token, body: { status: 'dismissed', action: 'reject', reason: 'Motif suffisant' } })).status, 400);
  assert.equal((await s.request('PUT', `/api/admin/signalements/${sid}/resolve`, { token: admin.token, body: { status: 'resolved', action: 'reject' } })).status, 400);
  assert.equal(await statusOf(id), 'active');

  const r = await s.request('PUT', `/api/admin/signalements/${sid}/resolve`, { token: admin.token,
    body: { status: 'resolved', action: 'reject', reason: 'Signalement confirmé après vérification' } });
  assert.equal(r.status, 200);
  assert.equal(await statusOf(id), 'rejected');
  const apres = (await q('SELECT status FROM signalements WHERE property_id = $1', [id])).rows;
  assert.ok(apres.every(x => x.status === 'resolved'));
  await settle(() => notifsFor(owner.id).length > 0);
  assert.ok(notifsFor(owner.id).length >= 1, 'le propriétaire est prévenu du refus');
  const encore = await s.request('GET', '/api/admin/signalements?status=pending', { token: admin.token });
  assert.ok(!encore.body.items.some(x => x.property_id === id));
});

test('classement simple : « résolu » ou « sans suite » ne touche pas à l’annonce', async () => {
  const id = await listing(await s.register('proprio'));
  const u = await reliable();
  await report(u, id);
  const sid = (await q('SELECT id FROM signalements WHERE property_id = $1', [id])).rows[0].id;
  assert.equal((await s.request('PUT', `/api/admin/signalements/${sid}/resolve`, { token: admin.token, body: { status: 'dismissed' } })).status, 200);
  assert.equal(await statusOf(id), 'active');
  const row = (await q('SELECT status, resolved_by FROM signalements WHERE id = $1', [sid])).rows[0];
  assert.deepEqual([row.status, row.resolved_by], ['dismissed', admin.id]);
  // un signalement classé libère le membre : il peut signaler de nouveau
  assert.equal((await report(u, id)).status, 200);
  assert.equal((await q(`SELECT COUNT(*)::int AS n FROM signalements WHERE property_id = $1 AND status = 'pending'`, [id])).rows[0].n, 1);
});
