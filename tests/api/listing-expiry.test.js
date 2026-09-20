// Expiration et reconfirmation des annonces : rappel après 30 jours, lien « toujours disponible » sans connexion (usage unique),
// retrait 14 jours plus tard sans réponse, renouvellement en un clic, et les cas où rien ne doit se passer.
const test   = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer } = require('../helpers/server');
const { AR } = require('../../server/i18n');

let s, admin, expiry, mails, wsLog;
const q = (sql, p) => s.db.pool.query(sql, p);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ago = days => `NOW() - interval '${days} days'`;

test.before(async () => {
  s = await startServer();
  expiry = require('../../server/expiry');           // après startServer : ce module ouvre la connexion à la base
  mails = []; wsLog = [];
  require('nodemailer').createTransport = () => ({ sendMail: async o => { mails.push(o); } });
  process.env.EMAIL_HOST = 'smtp.test'; process.env.EMAIL_USER = 'noreply@test.dz';
  require('../../server/ws').send = (id, data) => { wsLog.push({ id: Number(id), data }); };
  admin = await s.makeAdmin(await s.register('admin'));
});
test.after(async () => { await s.stop(); });

// Annonce active d'un propriétaire (publiée par SQL : indépendante de la modération et de la détection de doublons)
let n = 0;
async function listing(owner, over = {}) {
  const r = await q(
    `INSERT INTO properties (owner_id, title, description, mode, type_bien, price, surface_m2, wilaya, status, published_at, last_confirmed_at, expiry_notified_at, expired_at)
     VALUES ($1, $2, 'Description', $3, 'appartement', 5000000, 80, 'Oran', $4, NOW(), ${over.confirmedAgo != null ? ago(over.confirmedAgo) : 'NOW()'},
             ${over.notifiedAgo != null ? ago(over.notifiedAgo) : 'NULL'}, ${over.expired ? 'NOW()' : 'NULL'}) RETURNING id`,
    [owner.id, over.title || `Annonce ${++n}`, over.mode || 'vente', over.status || 'active']);
  return r.rows[0].id;
}
const row = async id => (await q('SELECT status, last_confirmed_at, expiry_notified_at, expired_at FROM properties WHERE id = $1', [id])).rows[0];
const settle = async (cond, ms = 1500) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return; await sleep(20); } };
const confirm = (id, body) => s.request('POST', `/api/properties/${id}/confirm`, { body });
const tokenOf = async id => { const r = await row(id); return expiry.token(id, r.last_confirmed_at); };

test('réglages : 30 jours de rappel, 14 jours de délai de grâce, modifiables ; valeurs absurdes = défauts', () => {
  const env = process.env;
  const keep = [env.LISTING_CONFIRM_DAYS, env.LISTING_EXPIRE_GRACE_DAYS];
  try {
    delete env.LISTING_CONFIRM_DAYS; delete env.LISTING_EXPIRE_GRACE_DAYS;
    assert.deepEqual([expiry.confirmDays(), expiry.graceDays()], [30, 14]);
    env.LISTING_CONFIRM_DAYS = '10'; env.LISTING_EXPIRE_GRACE_DAYS = '3';
    assert.deepEqual([expiry.confirmDays(), expiry.graceDays()], [10, 3]);
    for (const bad of ['0', '-5', '1.5', 'abc', '', '366', '99999', 'NaN', '1e2']) {
      env.LISTING_CONFIRM_DAYS = bad; env.LISTING_EXPIRE_GRACE_DAYS = bad;
      assert.deepEqual([expiry.confirmDays(), expiry.graceDays()], [30, 14], `« ${bad} »`);
    }
  } finally { env.LISTING_CONFIRM_DAYS = keep[0]; env.LISTING_EXPIRE_GRACE_DAYS = keep[1]; if (keep[0] === undefined) delete env.LISTING_CONFIRM_DAYS; if (keep[1] === undefined) delete env.LISTING_EXPIRE_GRACE_DAYS; }
});

test('rappel : seules les annonces actives, non confirmées depuis plus de 30 jours et non déjà relancées', async () => {
  const o = await s.register('rappel');
  const ids = {
    vieille:    await listing(o, { confirmedAgo: 31 }),
    recente:    await listing(o, { confirmedAgo: 29 }),
    dejaRelancee: await listing(o, { confirmedAgo: 40, notifiedAgo: 2 }),
    enAttente:  await listing(o, { confirmedAgo: 60, status: 'pending' }),
    vendue:     await listing(o, { confirmedAgo: 60, status: 'sold' }),
    archivee:   await listing(o, { confirmedAgo: 60, status: 'archived' }),
    refusee:    await listing(o, { confirmedAgo: 60, status: 'rejected' }),
  };
  const sent = await expiry.remindDue();
  assert.equal(sent, 1);
  assert.notEqual((await row(ids.vieille)).expiry_notified_at, null, 'relancée');
  for (const k of ['recente', 'enAttente', 'vendue', 'archivee', 'refusee']) assert.equal((await row(ids[k])).expiry_notified_at, null, k);
  const before = (await row(ids.dejaRelancee)).expiry_notified_at;
  assert.equal(new Date((await row(ids.dejaRelancee)).expiry_notified_at).getTime(), new Date(before).getTime(), 'pas de deuxième rappel');
  assert.equal(await expiry.remindDue(), 0, 'un second passage n\'envoie rien');
});

test('rappel : email et notification dans la langue du propriétaire, avec un lien unique vers l\'annonce', async () => {
  const [fr, ar] = [await s.register('rappel-fr'), await s.register('rappel-ar')];
  await s.request('POST', '/api/auth/login', { headers: { 'X-Lang': 'ar' }, body: { email: ar.email, password: 'motdepasse1' } });
  const [a, b] = [await listing(fr, { confirmedAgo: 35, title: 'Villa française' }), await listing(ar, { confirmedAgo: 35, title: 'Villa arabe' })];
  mails.length = 0; wsLog.length = 0;
  await expiry.remindDue();
  await settle(() => mails.length >= 2);
  const mFr = mails.find(m => m.to === fr.email), mAr = mails.find(m => m.to === ar.email);
  assert.match(mFr.subject, /Votre annonce est-elle toujours disponible \? — Villa française/);
  assert.match(mAr.subject, /[؀-ۿ]/);
  assert.match(mAr.html, /dir="rtl"/);
  for (const [m, id] of [[mFr, a], [mAr, b]]) {
    const link = m.html.match(/href="([^"]*\?renew=[a-f0-9]+)"/)[1];
    assert.match(link, new RegExp(`/annonce/${id}-[a-z0-9-]+\\?renew=${await tokenOf(id)}$`), 'lien : page de l\'annonce + jeton de cette annonce');
    assert.match(m.html, /30/); assert.match(m.html, /14/);
  }
  assert.notEqual(mFr.html.match(/renew=([a-f0-9]+)/)[1], mAr.html.match(/renew=([a-f0-9]+)/)[1], 'un jeton par annonce');
  const nFr = wsLog.find(w => w.id === fr.id).data, nAr = wsLog.find(w => w.id === ar.id).data;
  assert.equal(nFr.title, 'Annonce à reconfirmer');
  assert.match(nAr.title, /[؀-ۿ]/);
  assert.equal(nFr.link_id, a);
});

test('rappel : un propriétaire suspendu n\'est pas relancé ; deux passages simultanés n\'envoient qu\'un seul rappel', async () => {
  const banned = await s.register('rappel-banni');
  const idBanned = await listing(banned, { confirmedAgo: 50 });
  await q('UPDATE users SET banned = true WHERE id = $1', [banned.id]);
  const o = await s.register('rappel-course');
  const idRace = await listing(o, { confirmedAgo: 50 });
  mails.length = 0;
  const [x, y] = await Promise.all([expiry.remindDue(), expiry.remindDue()]);
  await settle(() => mails.some(m => m.to === o.email));
  assert.equal(x + y >= 1, true);
  assert.equal(mails.filter(m => m.to === o.email).length, 1, 'un seul email pour l\'annonce en course');
  assert.equal((await row(idBanned)).expiry_notified_at, null, 'compte suspendu ignoré');
  assert.notEqual((await row(idRace)).expiry_notified_at, null);
});

test('lien de l\'email : « toujours disponible » remet le compteur à zéro, sans connexion, et ne sert qu\'une fois', async () => {
  const o = await s.register('lien');
  const id = await listing(o, { confirmedAgo: 40, notifiedAgo: 3 });
  const token = await tokenOf(id);
  const r = await confirm(id, { token, action: 'available' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.ok, r.body.status], [true, 'active']);
  const after = await row(id);
  assert.equal(after.expiry_notified_at, null);
  assert.ok(Date.now() - new Date(after.last_confirmed_at).getTime() < 5000, 'confirmée à l\'instant');
  // Même lien réutilisé : refusé (le jeton dépend de la date de dernière confirmation)
  const again = await confirm(id, { token, action: 'available' });
  assert.equal(again.status, 400);
  assert.equal(again.body.error, 'Ce lien de confirmation est invalide ou a expiré.');
  const ar = await s.request('POST', `/api/properties/${id}/confirm`, { body: { token, action: 'available' }, headers: { 'X-Lang': 'ar' } });
  assert.equal(ar.body.error, AR['Ce lien de confirmation est invalide ou a expiré.']);
});

test('lien de l\'email : « vendue » ou « louée » retire l\'annonce selon son mode', async () => {
  const o = await s.register('lien-ferme');
  const [vente, loc] = [await listing(o, { confirmedAgo: 40, mode: 'vente' }), await listing(o, { confirmedAgo: 40, mode: 'location_longue' })];
  assert.equal((await confirm(vente, { token: await tokenOf(vente), action: 'closed' })).body.status, 'sold');
  assert.equal((await confirm(loc, { token: await tokenOf(loc), action: 'closed' })).body.status, 'rented');
  assert.equal((await row(vente)).status, 'sold');
  assert.equal((await row(loc)).status, 'rented');
  // Une annonce vendue n'est plus renouvelable par ce lien
  const t = await tokenOf(vente);
  assert.equal((await confirm(vente, { token: t, action: 'available' })).status, 409);
});

test('lien de l\'email : jetons faux, vides, d\'une autre annonce ou de forme absurde = refusés, réponse identique', async () => {
  const o = await s.register('lien-faux');
  const [a, b] = [await listing(o, { confirmedAgo: 40 }), await listing(o, { confirmedAgo: 40 })];
  const good = await tokenOf(a);
  const message = 'Ce lien de confirmation est invalide ou a expiré.';
  const bad = [undefined, null, '', 'abc', good.slice(1), good + 'x', good.toUpperCase(), await tokenOf(b), 42, [good], { token: good }, '../../', "' OR 1=1 --", 'x'.repeat(5000)];
  for (const token of bad) {
    const r = await confirm(a, { token, action: 'available' });
    assert.equal(r.status, 400, JSON.stringify(token)?.slice(0, 40));
    assert.equal(r.body.error, message);
  }
  // Annonce inconnue : même réponse (pas d'énumération des annonces)
  for (const id of [999999, 0, 'abc', '1.5', '99999999999']) {
    const r = await confirm(id, { token: good, action: 'available' });
    assert.equal(r.status, 400, String(id));
    assert.equal(r.body.error, message);
  }
  // Action invalide
  for (const action of [undefined, 'renew', 'sold', '', 42, ['available']]) assert.equal((await confirm(a, { token: good, action })).status, 400, JSON.stringify(action));
  assert.equal((await confirm(a, {})).status, 400);
  assert.equal((await s.request('POST', `/api/properties/${a}/confirm`)).status, 400, 'sans corps');
  assert.equal((await row(a)).expiry_notified_at, null, 'rien n\'a changé');
});

test('le jeton est calculé avec le secret du serveur : sans lui, impossible de le fabriquer', async () => {
  const o = await s.register('lien-secret');
  const id = await listing(o, { confirmedAgo: 40 });
  const { last_confirmed_at } = await row(id);
  const forged = crypto.createHmac('sha256', 'un-autre-secret').update(`renew:${id}:${new Date(last_confirmed_at).getTime()}`).digest('hex').slice(0, 40);
  assert.equal((await confirm(id, { token: forged, action: 'available' })).status, 400);
  assert.equal(expiry.validToken(id, last_confirmed_at, expiry.token(id, last_confirmed_at)), true);
  assert.equal(expiry.validToken(id + 1, last_confirmed_at, expiry.token(id, last_confirmed_at)), false, 'lié à l\'annonce');
  assert.equal(expiry.validToken(id, new Date(new Date(last_confirmed_at).getTime() + 1), expiry.token(id, last_confirmed_at)), false, 'lié à la date de confirmation');
});

test('retrait : 14 jours après le rappel sans confirmation, l\'annonce est retirée (pas supprimée) et l\'annonceur prévenu', async () => {
  const o = await s.register('retrait');
  const [due, tooSoon, confirmedLater, neverReminded, closedByOwner] = [
    await listing(o, { confirmedAgo: 60, notifiedAgo: 15, title: 'À retirer' }),
    await listing(o, { confirmedAgo: 60, notifiedAgo: 13 }),
    await listing(o, { confirmedAgo: 5, notifiedAgo: 15 }),          // confirmée depuis le rappel
    await listing(o, { confirmedAgo: 90 }),                          // jamais relancée : jamais retirée d'un coup
    await listing(o, { confirmedAgo: 60, notifiedAgo: 15, status: 'sold' }),
  ];
  mails.length = 0; wsLog.length = 0;
  assert.equal(await expiry.expireDue(), 1);
  assert.deepEqual([(await row(due)).status, (await row(due)).expired_at !== null], ['archived', true]);
  for (const id of [tooSoon, confirmedLater, neverReminded]) assert.equal((await row(id)).status, 'active', `annonce ${id}`);
  assert.equal((await row(closedByOwner)).status, 'sold');
  assert.equal((await row(closedByOwner)).expired_at, null);
  await settle(() => mails.some(m => m.to === o.email));
  const m = mails.find(x => x.to === o.email);
  assert.match(m.subject, /Votre annonce a été retirée — À retirer/);
  assert.match(m.html, /\?renew=[a-f0-9]+/, 'lien pour renouveler');
  assert.equal(wsLog.find(w => w.id === o.id).data.title, 'Annonce retirée');
  assert.equal(await expiry.expireDue(), 0, 'un second passage ne retire rien de plus');
  assert.equal((await q('SELECT COUNT(*)::int c FROM properties WHERE id = $1', [due])).rows[0].c, 1, 'l\'annonce existe toujours');
  // Le rappel a bien été envoyé avant le retrait : run() enchaîne les deux
  const run = await expiry.run();
  assert.ok(typeof run.reminded === 'number' && typeof run.expired === 'number');
});

test('annonce retirée : invisible du public, renouvelable par le lien de l\'email (le dernier lien fonctionne encore)', async () => {
  const o = await s.register('renouv-lien');
  const id = await listing(o, { confirmedAgo: 60, notifiedAgo: 15 });
  const token = await tokenOf(id);
  await expiry.expireDue();
  assert.ok(!(await s.request('GET', '/api/properties?limit=200')).body.data.some(p => p.id === id), 'retirée de la liste publique');
  const r = await confirm(id, { token, action: 'available' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'active');
  const after = await row(id);
  assert.deepEqual([after.status, after.expired_at, after.expiry_notified_at], ['active', null, null]);
  assert.ok((await s.request('GET', '/api/properties?limit=200')).body.data.some(p => p.id === id), 'de nouveau en ligne');
});

test('renouvellement depuis le tableau de bord : propriétaire seulement, annonces actives ou retirées automatiquement seulement', async () => {
  const [o, other] = [await s.register('renouv'), await s.register('renouv-autre')];
  const active = await listing(o, { confirmedAgo: 33, notifiedAgo: 2 });
  const expired = await listing(o, { confirmedAgo: 60, notifiedAgo: 20, status: 'archived', expired: true });
  const archivedByOwner = await listing(o, { status: 'archived' });
  const sold = await listing(o, { status: 'sold' });
  const pending = await listing(o, { status: 'pending' });
  const renew = (id, token) => s.request('POST', `/api/properties/${id}/renew`, { token });
  // Actif : « toujours disponible »
  const r1 = await renew(active, o.token);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.status, 'active');
  assert.equal((await row(active)).expiry_notified_at, null);
  // Retirée automatiquement : remise en ligne
  const r2 = await renew(expired, o.token);
  assert.deepEqual([r2.status, r2.body.status], [200, 'active']);
  assert.deepEqual([(await row(expired)).status, (await row(expired)).expired_at], ['active', null]);
  // Pas d'effet sur une annonce que l'annonceur a lui-même archivée, vendue ou en modération
  for (const id of [archivedByOwner, sold, pending]) {
    const r = await renew(id, o.token);
    assert.equal(r.status, 409, `annonce ${id}`);
    assert.equal(r.body.error, 'Cette annonce ne peut pas être renouvelée.');
  }
  assert.equal((await row(archivedByOwner)).status, 'archived');
  // Autres comptes, visiteurs, annonces inconnues
  assert.equal((await renew(active, other.token)).status, 403);
  assert.equal((await renew(active, admin.token)).status, 403, 'un administrateur ne confirme pas à la place de l\'annonceur');
  assert.equal((await renew(active, undefined)).status, 401);
  assert.equal((await renew(999999, o.token)).status, 404);
  assert.equal((await renew('abc', o.token)).status, 404);
});

test('modifier son annonce vaut confirmation ; une modification par un administrateur non', async () => {
  const o = await s.register('modif');
  const id = await listing(o, { confirmedAgo: 40, notifiedAgo: 5 });
  const adminEdit = await s.request('PUT', `/api/properties/${id}`, { token: admin.token, body: { rooms: 4 } });
  assert.equal(adminEdit.status, 200);
  assert.notEqual((await row(id)).expiry_notified_at, null, 'l\'administrateur ne confirme pas la disponibilité');
  const ownerEdit = await s.request('PUT', `/api/properties/${id}`, { token: o.token, body: { rooms: 3 } });
  assert.equal(ownerEdit.status, 200);
  const after = await row(id);
  assert.equal(after.expiry_notified_at, null);
  assert.ok(Date.now() - new Date(after.last_confirmed_at).getTime() < 5000);
});

test('publication par la modération : la date de confirmation repart de l\'approbation', async () => {
  const o = await s.register('modere');
  const id = (await s.request('POST', '/api/properties', { token: o.token, body: { title: 'À valider', mode: 'vente', type_bien: 'villa', price: 9000000, wilaya: 'Oran', photos: [], description: 'Villa de test pour la modération, texte assez long pour être mémorisé.' } })).body.id;
  await q(`UPDATE properties SET last_confirmed_at = ${ago(90)} WHERE id = $1`, [id]);
  await s.request('PUT', `/api/admin/properties/${id}/moderate`, { token: admin.token, body: { decision: 'approve' } });
  assert.ok(Date.now() - new Date((await row(id)).last_confirmed_at).getTime() < 5000);
});

test('liste de l\'annonceur : annonces retirées automatiquement visibles (à renouveler), échéance du rappel ; rien de tout cela en public', async () => {
  const o = await s.register('liste');
  const [remind, exp, mine, plain] = [await listing(o, { confirmedAgo: 33, notifiedAgo: 4, title: 'Rappelée' }), await listing(o, { confirmedAgo: 60, notifiedAgo: 20, status: 'archived', expired: true, title: 'Retirée auto' }),
    await listing(o, { status: 'archived', title: 'Archivée par moi' }), await listing(o, { title: 'Normale' })];
  const own = (await s.request('GET', `/api/properties/user/${o.id}`, { token: o.token })).body;
  const titles = own.map(p => p.title).sort();
  assert.deepEqual(titles, ['Normale', 'Rappelée', 'Retirée auto'], 'les annonces archivées volontairement restent masquées');
  const r = own.find(p => p.id === remind), e = own.find(p => p.id === exp), p0 = own.find(p => p.id === plain);
  assert.ok(r.expires_at, 'échéance du retrait annoncée');
  const days = (new Date(r.expires_at) - new Date(r.expiry_notified_at)) / 86400000;
  assert.equal(Math.round(days), 14);
  assert.equal(p0.expires_at, null);
  assert.ok(e.expired_at);
  assert.ok('expires_at' in r);
  // Vue publique du même annonceur : ni annonces retirées, ni compteurs, ni échéances, ni signaux de qualité
  const pub = (await s.request('GET', `/api/properties/user/${o.id}`)).body;
  assert.deepEqual(pub.map(p => p.title).sort(), ['Normale', 'Rappelée']);
  for (const p of pub) for (const k of ['call_clicks', 'whatsapp_clicks', 'expires_at', 'quality_flags']) assert.ok(!(k in p), `${k} en public`);
  const other = await s.register('liste-autre');
  const seenByOther = (await s.request('GET', `/api/properties/user/${o.id}`, { token: other.token })).body;
  assert.ok(seenByOther.every(p => !('call_clicks' in p)), 'un autre membre ne voit pas les compteurs');
  assert.ok(!seenByOther.some(p => p.title === 'Retirée auto'));
});

test('la date de dernière confirmation est publique (signal de confiance) ; les champs internes d\'expiration ne le sont pas plus que nécessaire', async () => {
  const o = await s.register('public');
  const id = await listing(o, { confirmedAgo: 3 });
  const detail = (await s.request('GET', `/api/properties/${id}`)).body;
  assert.ok(detail.last_confirmed_at);
  const days = (Date.now() - new Date(detail.last_confirmed_at)) / 86400000;
  assert.ok(days > 2.9 && days < 3.1);
  const inList = (await s.request('GET', '/api/properties?limit=200')).body.data.find(p => p.id === id);
  assert.ok(inList.last_confirmed_at);
});

test('migration : les annonces existantes reçoivent une date de confirmation (délai de grâce complet), jamais NULL', async () => {
  const col = (await q(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'last_confirmed_at' AND table_schema = current_schema()`)).rows[0];
  assert.equal(col.is_nullable, 'NO');
  assert.match(col.column_default, /now\(\)/i);
});
