// Alerte de baisse de prix : les membres qui ont l'annonce en favori sont prévenus (notification WS immédiate + email différé en digest quotidien),
// sous conditions (seuil, plancher des 30 jours, délai entre deux alertes, annonce publiée) et sauf choix contraire du membre.
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
const pause = ms => new Promise(r => setTimeout(r, ms));

test.before(async () => {
  s = await startServer();
  admin = await s.makeAdmin(await s.register('admin'));
  mails = []; wsLog = [];
  require('nodemailer').createTransport = () => ({ sendMail: async o => { mails.push(o); } });
  process.env.EMAIL_HOST = 'smtp.test'; process.env.EMAIL_USER = 'noreply@test.dz';
  require('../../server/ws').send = (id, data) => { wsLog.push({ id: Number(id), data }); };
});
test.after(async () => { await s.stop(); });

const drops = id => wsLog.filter(w => w.id === id && w.data.type === 'notif' && w.data.notif_type === 'price_drop').map(w => w.data);
// Les emails de baisse de prix sont des digest (sujet commence par 📉) ; le filtre s'applique aux deux gabarits
const mailsTo = user => mails.filter(m => m.to === user.email && m.subject.startsWith('📉'));

// Annonce publiée à 10 000 000 DZD appartenant à `owner`
async function listing(owner, title = 'Appartement en baisse') {
  const r = await s.request('POST', '/api/properties', { token: admin.token, body: {
    title, mode: 'vente', type_bien: 'appartement', price: 10000000, wilaya: 'Oran', photos: [] } });
  assert.equal(r.status, 201);
  await q(`UPDATE properties SET owner_id = $1, status = 'active' WHERE id = $2`, [owner.id, r.body.id]);
  return r.body.id;
}
// Membre qui suit l'annonce ; l'email est confirmé sauf demande contraire
async function follower(id, { lang = 'fr', verified = true, alerts = true } = {}) {
  const u = await s.register('suiveur');
  await q('UPDATE users SET email_verified = $2, lang = $3, notify_price_drop = $4 WHERE id = $1', [u.id, verified, lang, alerts]);
  await q('INSERT INTO favorites (user_id, property_id) VALUES ($1, $2)', [u.id, id]);
  return u;
}
const setPrice = (owner, id, price) => s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { price } });
const statusOf = async id => (await q('SELECT status FROM properties WHERE id = $1', [id])).rows[0].status;

test('baisse de 10 % : notification WS immédiate et email digest aux favoris, dans leur langue ; pas au propriétaire ni à qui a coupé l\'alerte', async () => {
  const owner = await s.register('proprio');
  const id = await listing(owner);
  await q('INSERT INTO favorites (user_id, property_id) VALUES ($1, $2)', [owner.id, id]);   // il suit sa propre annonce : jamais prévenu
  const fr = await follower(id), ar = await follower(id, { lang: 'ar' });
  const muet = await follower(id, { alerts: false }), sansEmail = await follower(id, { verified: false });

  const r = await setPrice(owner, id, 9000000);
  assert.equal(r.status, 200);
  assert.equal(await statusOf(id), 'active', 'la baisse ne remet pas l\'annonce en modération');

  // Notifications WS : immédiates
  await settle(() => drops(fr.id).length && drops(ar.id).length);
  const nFr = drops(fr.id);
  assert.equal(nFr.length, 1);
  assert.equal(nFr[0].link_id, id);
  assert.match(nFr[0].title, /Prix en baisse/);
  assert.match(nFr[0].body, /−10 %/);
  assert.match(nFr[0].body, /DZD/);
  const nAr = drops(ar.id)[0];
  assert.match(nAr.title, ARABIC);
  assert.match(nAr.body, /د\.ج/);

  // Emails : mis en file d'attente (digest quotidien)
  const queue = (await q('SELECT user_id FROM price_drop_queue WHERE property_id = $1', [id])).rows;
  assert.equal(queue.filter(e => e.user_id === fr.id).length, 1, 'fr en file');
  assert.equal(queue.filter(e => e.user_id === ar.id).length, 1, 'ar en file');
  assert.equal(queue.filter(e => e.user_id === owner.id).length, 0, 'propriétaire pas en file');
  assert.equal(queue.filter(e => e.user_id === muet.id).length, 0, 'alerte coupée pas en file');
  assert.equal(queue.filter(e => e.user_id === sansEmail.id).length, 0, 'sans email confirmé pas en file');

  // Envoi du digest : un email par membre, dans sa langue
  const { sendPriceDropDigest } = require('../../server/price-drop');
  const sent = await sendPriceDropDigest();
  assert.equal(sent, 2, 'deux membres prévenus par digest (fr et ar)');
  assert.equal(mailsTo(fr).length, 1, 'email fr envoyé');
  assert.equal(mailsTo(ar).length, 1, 'email ar envoyé');
  assert.match(mailsTo(fr)[0].subject, /baisse.*favoris/);
  assert.match(mailsTo(fr)[0].html, /\/annonce\/\d+-appartement-en-baisse/);
  assert.match(mailsTo(ar)[0].subject, ARABIC);
  assert.match(mailsTo(ar)[0].html, /\/ar\/annonce\/\d+-/, 'lien vers la version arabe');

  // La file est vidée après l'envoi
  const queueAfter = (await q('SELECT id FROM price_drop_queue WHERE property_id = $1', [id])).rows;
  assert.equal(queueAfter.length, 0, 'file vidée après digest');

  await pause(150);
  assert.equal(drops(owner.id).length, 0, 'propriétaire');
  assert.equal(drops(muet.id).length, 0, 'alerte coupée');
  assert.equal(mailsTo(muet).length, 0);
  assert.equal(drops(sansEmail.id).length, 1, 'notification sur le site même sans email confirmé');
  assert.equal(mailsTo(sansEmail).length, 0, 'jamais d\'email à une adresse non confirmée');
});

test('baisse de moins de 3 % ou hausse : aucune alerte', async () => {
  const owner = await s.register('proprio');
  const id = await listing(owner);
  const f = await follower(id);
  assert.equal((await setPrice(owner, id, 9800000)).status, 200);   // −2 %
  assert.equal((await setPrice(owner, id, 10500000)).status, 200);  // hausse
  await pause(200);
  assert.equal(drops(f.id).length, 0);
  assert.equal(mailsTo(f).length, 0);
});

test('délai : une seule alerte par annonce et par semaine (deux baisses rapprochées = une alerte), puis de nouveau possible', async () => {
  const owner = await s.register('proprio');
  const id = await listing(owner);
  const f = await follower(id);
  await setPrice(owner, id, 9000000);
  await settle(() => drops(f.id).length === 1);
  await setPrice(owner, id, 8000000);
  await pause(250);
  assert.equal(drops(f.id).length, 1, 'la seconde baisse, trois jours plus tôt qu\'un délai de sept jours, ne prévient pas');
  await q(`UPDATE properties SET price_drop_notified_at = NOW() - INTERVAL '8 days' WHERE id = $1`, [id]);
  await setPrice(owner, id, 7000000);
  await settle(() => drops(f.id).length === 2);
  assert.equal(drops(f.id).length, 2);
});

test('monter puis « baisser » sans passer sous le prix des 30 derniers jours : pas d\'alerte', async () => {
  const owner = await s.register('proprio');
  const id = await listing(owner);   // 10 000 000
  const f = await follower(id);
  assert.equal((await setPrice(owner, id, 12000000)).status, 200);
  assert.equal((await setPrice(owner, id, 10500000)).status, 200);   // −12,5 % sur 12 M, mais au-dessus de 10 M
  await pause(250);
  assert.equal(drops(f.id).length, 0);
  assert.equal((await setPrice(owner, id, 9000000)).status, 200);    // sous tous les prix récents
  await settle(() => drops(f.id).length === 1);
  assert.equal(drops(f.id).length, 1);
});

test('annonce qui n\'est plus publiée : aucune alerte', async () => {
  const owner = await s.register('proprio');
  const id = await listing(owner);
  const f = await follower(id);
  await q(`UPDATE properties SET status = 'archived' WHERE id = $1`, [id]);
  assert.equal((await setPrice(owner, id, 8000000)).status, 200);
  await pause(250);
  assert.equal(drops(f.id).length, 0);
});

test('réservation atomique : deux appels simultanés ne préviennent qu\'une fois', async () => {
  const priceDrop = require('../../server/price-drop');
  const owner = await s.register('proprio');
  const id = await listing(owner);
  const f = await follower(id);
  await q('UPDATE properties SET price = 9000000 WHERE id = $1', [id]);
  const n = await Promise.all([1, 2, 3].map(() => priceDrop.notifyDrop(id, 10000000, 9000000, 10000000)));
  assert.equal(n.filter(x => x > 0).length, 1);
  assert.equal(drops(f.id).length, 1);
});

test('profil : le choix d\'alerte se lit, se modifie et se retrouve dans l\'export ; une valeur qui n\'est pas booléenne est refusée', async () => {
  const u = await s.register('choix');
  assert.equal((await s.request('GET', '/api/auth/me', { token: u.token })).body.notify_price_drop, true, 'active par défaut');
  const off = await s.request('PUT', '/api/auth/profile', { token: u.token, body: { notify_price_drop: false } });
  assert.equal(off.status, 200);
  assert.equal(off.body.notify_price_drop, false);
  assert.equal((await q('SELECT notify_price_drop FROM users WHERE id = $1', [u.id])).rows[0].notify_price_drop, false);
  for (const v of ['false', 0, null, {}])
    assert.equal((await s.request('PUT', '/api/auth/profile', { token: u.token, body: { notify_price_drop: v } })).status, 400, JSON.stringify(v));
  const on = await s.request('PUT', '/api/auth/profile', { token: u.token, body: { name: 'Nouveau nom', notify_price_drop: true } });
  assert.equal(on.body.notify_price_drop, true);
  assert.equal(on.body.name, 'Nouveau nom');
});
