// Newsletter à double confirmation : inscription, confirmation, désinscription, envois par lots, administration.
// Le SMTP est simulé (les emails sont gardés en mémoire) ; les jetons ne se lisent que dans les emails.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { startServer, ROOT } = require('../helpers/server');
const { readFront } = require('../helpers/front');
const { fullSitemap } = require('../helpers/sitemap');

let s, admin, newsletter, mailer;
const mails = [];
let smtpDown = false;
const q = (sql, p) => s.db.pool.query(sql, p);
const post = (url, body, headers, token) => s.request('POST', url, { body, headers, token });
const ARABIC = /[؀-ۿ]/;
const wait = ms => new Promise(r => setTimeout(r, ms));
// L'email de confirmation part sans être attendu par la route : on patiente jusqu'à son arrivée
async function until(cond, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await wait(20);
  return cond();
}
const mailsTo = email => mails.filter(m => m.to === email);
// Paramètres e et t du lien contenu dans un email (les & sont écrits &amp; dans le HTML)
const linkOf = (html, page) => {
  const href = html.match(new RegExp(`href="([^"]*/newsletter/${page}[^"]*)"`))[1].replace(/&amp;/g, '&');
  const u = new URL(href);
  return { e: u.searchParams.get('e'), t: u.searchParams.get('t'), href };
};
const confirmedSub = async (email, lang = 'fr') =>
  (await q('INSERT INTO newsletter_subscribers (email, lang, confirmed_at) VALUES ($1, $2, NOW()) RETURNING id', [email, lang])).rows[0].id;

test.before(async () => {
  s = await startServer();
  Object.assign(process.env, { EMAIL_HOST: 'smtp.test', EMAIL_USER: 'noreply@dzimmo.test' });
  require('nodemailer').createTransport = () => ({ sendMail: async o => { if (smtpDown) throw new Error('550 refusé pour chef@test.dz'); mails.push(o); } });
  mailer = require('../../server/mailer');
  newsletter = require('../../server/newsletter');
  admin = await s.makeAdmin(await s.register('chef'));
});
test.after(() => s.stop());
test.beforeEach(async () => {
  mails.length = 0; smtpDown = false;
  await q('TRUNCATE newsletter_subscribers, newsletter_campaigns, newsletter_deliveries RESTART IDENTITY CASCADE');
});

// ── Inscription ──────────────────────────────────────────────────────────────
test('inscription : réponse identique pour tous, aucun jeton renvoyé, un seul email de confirmation par tranche de 10 minutes', async () => {
  const r1 = await post('/api/newsletter/subscribe', { email: 'Lecteur@Exemple.dz', lang: 'ar' });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.body, { ok: true });
  assert.ok(await until(() => mailsTo('lecteur@exemple.dz').length === 1), 'email de confirmation envoyé');
  const m = mailsTo('lecteur@exemple.dz')[0];
  assert.match(m.subject, ARABIC);
  assert.match(m.html, /dir="rtl"/);
  const row = (await q('SELECT * FROM newsletter_subscribers')).rows[0];
  assert.equal(row.email, 'lecteur@exemple.dz');
  assert.equal(row.lang, 'ar');
  assert.equal(row.confirmed_at, null, 'pas de consentement avant le clic');

  // Deuxième demande immédiate : même réponse, aucun second email (pas d'inondation d'une boîte tierce)
  const r2 = await post('/api/newsletter/subscribe', { email: 'lecteur@exemple.dz' });
  assert.deepEqual(r2.body, r1.body);
  await wait(150);
  assert.equal(mailsTo('lecteur@exemple.dz').length, 1);
  assert.doesNotMatch(JSON.stringify([r1.body, r2.body, r1.headers.get('set-cookie')]), /[0-9a-f]{20}/, 'aucun jeton dans les réponses');

  // Dix minutes plus tard : un nouvel email, dans la langue demandée cette fois
  await q("UPDATE newsletter_subscribers SET confirm_sent_at = NOW() - interval '11 minutes'");
  await post('/api/newsletter/subscribe', { email: 'lecteur@exemple.dz', lang: 'fr' });
  assert.ok(await until(() => mailsTo('lecteur@exemple.dz').length === 2));
  assert.match(mailsTo('lecteur@exemple.dz')[1].subject, /Confirmez votre inscription/);
  assert.equal((await q('SELECT count(*)::int AS n FROM newsletter_subscribers')).rows[0].n, 1, 'une seule ligne par adresse');
});

test('inscription : la langue peut venir de l\'en-tête X-Lang', async () => {
  await post('/api/newsletter/subscribe', { email: 'x@exemple.dz' }, { 'X-Lang': 'ar' });
  assert.ok(await until(() => mails.some(m => m.to === 'x@exemple.dz')));
  assert.equal((await q("SELECT lang FROM newsletter_subscribers WHERE email = 'x@exemple.dz'")).rows[0].lang, 'ar');
});

test('inscription : une adresse déjà confirmée ne reçoit rien et garde sa langue, la réponse ne la révèle pas', async () => {
  await confirmedSub('deja@exemple.dz', 'ar');
  const r = await post('/api/newsletter/subscribe', { email: 'deja@exemple.dz', lang: 'fr' });
  assert.deepEqual(r.body, { ok: true });
  await wait(150);
  assert.equal(mailsTo('deja@exemple.dz').length, 0);
  assert.equal((await q("SELECT lang FROM newsletter_subscribers WHERE email = 'deja@exemple.dz'")).rows[0].lang, 'ar');
});

test('inscription : adresses refusées (400, message traduit), aucune ligne écrite', async () => {
  const bad = ['', 'pas-une-adresse', 'a@b.dz\r\nBcc: victime@c.dz', 'a@b.dz, autre@c.dz', 'a'.repeat(250) + '@b.dz', { $ne: 1 }, ['a@b.dz'], null];
  for (const email of bad) {
    const r = await post('/api/newsletter/subscribe', { email });
    assert.equal(r.status, 400, JSON.stringify(email));
    assert.equal(r.body.error, 'Adresse email invalide.');
    assert.match((await post('/api/newsletter/subscribe', { email }, { 'X-Lang': 'ar' })).body.error, ARABIC);
  }
  assert.equal((await s.request('POST', '/api/newsletter/subscribe')).status, 400, 'corps absent');
  assert.equal((await q('SELECT count(*)::int AS n FROM newsletter_subscribers')).rows[0].n, 0);
  assert.equal(mails.length, 0);
});

test('inscription : sans SMTP → 503 (on ne fait pas croire à une inscription), rien n\'est écrit', async () => {
  const original = mailer.configured;
  mailer.configured = () => false;
  try {
    const r = await post('/api/newsletter/subscribe', { email: 'lecteur@exemple.dz' });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'Inscription momentanément indisponible. Réessayez plus tard.');
    assert.match((await post('/api/newsletter/subscribe', { email: 'lecteur@exemple.dz' }, { 'X-Lang': 'ar' })).body.error, ARABIC);
  } finally { mailer.configured = original; }
  assert.equal((await q('SELECT count(*)::int AS n FROM newsletter_subscribers')).rows[0].n, 0);
});

test('inscription : si l\'email de confirmation échoue, la réservation est rendue (le visiteur peut réessayer aussitôt)', async () => {
  smtpDown = true;
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await post('/api/newsletter/subscribe', { email: 'lecteur@exemple.dz' })).status, 200);
    for (let i = 0; i < 100; i++) {
      if ((await q('SELECT confirm_sent_at FROM newsletter_subscribers')).rows[0].confirm_sent_at === null) break;
      await wait(20);
    }
  } finally { console.error = original; }
  assert.equal((await q('SELECT confirm_sent_at FROM newsletter_subscribers')).rows[0].confirm_sent_at, null);
  smtpDown = false;
  await post('/api/newsletter/subscribe', { email: 'lecteur@exemple.dz' });
  assert.ok(await until(() => mailsTo('lecteur@exemple.dz').length === 1));
});

// ── Confirmation ─────────────────────────────────────────────────────────────
test('confirmation : le lien de l\'email confirme (idempotent), un jeton faux ou d\'un autre usage est refusé', async () => {
  await post('/api/newsletter/subscribe', { email: 'lecteur@exemple.dz' });
  assert.ok(await until(() => mailsTo('lecteur@exemple.dz').length === 1));
  const { e, t, href } = linkOf(mailsTo('lecteur@exemple.dz')[0].html, 'confirmation');
  assert.match(href, /^http/);

  for (const body of [{ e, t: 'f'.repeat(40) }, { e, t: '' }, { e }, { e: '999999', t }, { e: 'abc', t }, { e: '1e3', t }, { e: '-1', t }, { e: [e], t }, { t },
                      { e, t: newsletter.token('unsub', e) }, {}]) {
    const r = await post('/api/newsletter/confirm', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, 'Lien invalide ou expiré.');
  }
  assert.equal((await q('SELECT confirmed_at FROM newsletter_subscribers')).rows[0].confirmed_at, null, 'aucun refus n\'a confirmé');

  assert.deepEqual((await post('/api/newsletter/confirm', { e, t })).body, { ok: true });
  const first = (await q('SELECT confirmed_at FROM newsletter_subscribers')).rows[0].confirmed_at;
  assert.ok(first);
  assert.deepEqual((await post('/api/newsletter/confirm', { e, t })).body, { ok: true }, 'idempotent');
  assert.deepEqual((await q('SELECT confirmed_at FROM newsletter_subscribers')).rows[0].confirmed_at, first, 'la date ne change pas');
});

test('confirmation : un jeton de confirmation ne désabonne pas, et inversement', async () => {
  const id = await confirmedSub('lecteur@exemple.dz');
  assert.equal((await post('/api/newsletter/unsubscribe', { e: String(id), t: newsletter.token('confirm', id) })).status, 400);
  assert.equal((await q('SELECT count(*)::int AS n FROM newsletter_subscribers')).rows[0].n, 1);
});

// ── Désinscription ───────────────────────────────────────────────────────────
test('désinscription : la ligne disparaît, le second clic réussit aussi, un jeton faux est refusé', async () => {
  const id = await confirmedSub('lecteur@exemple.dz');
  const other = await confirmedSub('autre@exemple.dz');
  assert.equal((await post('/api/newsletter/unsubscribe', { e: String(id), t: newsletter.token('unsub', other) })).status, 400, 'jeton d\'un autre');
  assert.equal((await post('/api/newsletter/unsubscribe', { e: String(id), t: 'f'.repeat(40) })).status, 400);
  assert.equal((await q('SELECT count(*)::int AS n FROM newsletter_subscribers')).rows[0].n, 2);
  const t = newsletter.token('unsub', id);
  assert.deepEqual((await post('/api/newsletter/unsubscribe', { e: String(id), t })).body, { ok: true });
  assert.deepEqual((await post('/api/newsletter/unsubscribe', { e: String(id), t })).body, { ok: true }, 'idempotent');
  assert.deepEqual((await q('SELECT email FROM newsletter_subscribers')).rows, [{ email: 'autre@exemple.dz' }], 'seul cet inscrit est effacé');
});

test('désinscription « un clic » des messageries (RFC 8058) : identifiant et jeton dans l\'adresse', async () => {
  const id = await confirmedSub('lecteur@exemple.dz');
  const url = `/api/newsletter/unsubscribe?e=${id}&t=${newsletter.token('unsub', id)}`;
  assert.equal((await s.request('POST', url)).status, 200);
  assert.equal((await q('SELECT count(*)::int AS n FROM newsletter_subscribers')).rows[0].n, 0);
  assert.equal((await s.request('GET', url)).status, 404, 'une simple ouverture du lien ne désabonne personne');
});

// ── Pages des liens ──────────────────────────────────────────────────────────
test('pages /newsletter/confirmation et /newsletter/desinscription : 200, jamais indexées, jeton hors des en-têtes Referer', async () => {
  for (const page of ['confirmation', 'desinscription']) {
    const r = await s.request('GET', `/newsletter/${page}?e=1&t=${'a'.repeat(40)}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /<meta name="robots" content="noindex,nofollow"/);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.match(r.text, /id="page-newsletter"/);
  }
  assert.match((await s.request('GET', '/robots.txt')).text, /Disallow: \/newsletter\//);
  assert.doesNotMatch(await fullSitemap(s), /newsletter/);
  assert.equal((await s.request('GET', '/newsletter/autre')).status, 404);
});

// ── Envois ───────────────────────────────────────────────────────────────────
const campaign = { subject_fr: 'Nouveautés', body_fr: 'Bonjour à tous.\n\nDeux nouvelles annonces.' };

test('envoi : seuls les abonnés confirmés reçoivent, par lots, avec lien et en-têtes de désinscription valides', async () => {
  for (let i = 1; i <= 4; i++) await confirmedSub(`abonne${i}@exemple.dz`, i % 2 ? 'fr' : 'ar');
  await q("INSERT INTO newsletter_subscribers (email) VALUES ('attente@exemple.dz')");
  const r = await post('/api/admin/newsletter/campaigns', campaign, undefined, admin.token);
  assert.equal(r.status, 201);
  assert.equal(r.body.recipients, 4, 'le non confirmé est écarté');

  assert.deepEqual(await newsletter.sendDue(3), { sent: 3, failed: 0 });
  assert.deepEqual(await newsletter.sendDue(3), { sent: 1, failed: 0 });
  assert.deepEqual(await newsletter.sendDue(3), { sent: 0, failed: 0 });
  const sent = mails.filter(m => /abonne\d@/.test(m.to));
  assert.equal(sent.length, 4);
  assert.equal(new Set(sent.map(m => m.to)).size, 4, 'un email par destinataire');
  assert.equal(mailsTo('attente@exemple.dz').length, 0);

  const m = mailsTo('abonne1@exemple.dz')[0];
  assert.equal(m.subject, 'Nouveautés');
  assert.match(m.html, /Bonjour à tous/);
  assert.match(m.html, /Deux nouvelles annonces/);
  // « abonne2 » est arabophone mais la campagne n'existe qu'en français : repli sur le français
  assert.equal(mailsTo('abonne2@exemple.dz')[0].subject, 'Nouveautés');
  const link = linkOf(m.html, 'desinscription');
  const id = (await q("SELECT id FROM newsletter_subscribers WHERE email = 'abonne1@exemple.dz'")).rows[0].id;
  assert.equal(link.e, String(id));
  assert.equal(link.t, newsletter.token('unsub', id));
  const oneClick = m.headers['List-Unsubscribe'].match(/^<(.+)>$/)[1];
  assert.equal(oneClick, `${mailer.siteUrl()}/api/newsletter/unsubscribe?e=${id}&t=${newsletter.token('unsub', id)}`);
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  // Le lien « un clic » de l'en-tête fonctionne réellement
  const u = new URL(oneClick);
  assert.equal((await s.request('POST', u.pathname + u.search)).status, 200);
  assert.equal((await q("SELECT count(*)::int AS n FROM newsletter_subscribers WHERE email = 'abonne1@exemple.dz'")).rows[0].n, 0);
  const d = (await q('SELECT count(*)::int AS n, count(sent_at)::int AS sent FROM newsletter_deliveries')).rows[0];
  assert.deepEqual(d, { n: 4, sent: 4 }, 'le compte des envois reste exact après une désinscription');
});

test('envoi : chaque abonné reçoit sa langue quand la campagne est bilingue', async () => {
  await confirmedSub('fr@exemple.dz', 'fr');
  await confirmedSub('ar@exemple.dz', 'ar');
  await post('/api/admin/newsletter/campaigns', { ...campaign, subject_ar: 'عروض جديدة', body_ar: 'مرحبا بكم.\n\nإعلانان جديدان.' }, undefined, admin.token);
  await newsletter.sendDue();
  assert.equal(mailsTo('fr@exemple.dz')[0].subject, 'Nouveautés');
  assert.match(mailsTo('fr@exemple.dz')[0].html, /dir="ltr"/);
  assert.equal(mailsTo('ar@exemple.dz')[0].subject, 'عروض جديدة');
  assert.match(mailsTo('ar@exemple.dz')[0].html, /dir="rtl"/);
  assert.match(mailsTo('ar@exemple.dz')[0].html, /إلغاء الاشتراك/, 'lien de désinscription en arabe');
});

test('envoi : arabe seulement, un abonné francophone reçoit la version arabe', async () => {
  await confirmedSub('fr@exemple.dz', 'fr');
  await post('/api/admin/newsletter/campaigns', { subject_ar: 'عروض', body_ar: 'مرحبا' }, undefined, admin.token);
  await newsletter.sendDue();
  assert.equal(mailsTo('fr@exemple.dz')[0].subject, 'عروض');
});

test('envoi : le contenu saisi est échappé, aucun HTML n\'est interprété', async () => {
  await confirmedSub('lecteur@exemple.dz');
  await post('/api/admin/newsletter/campaigns', { subject_fr: '<b>Sujet</b>', body_fr: '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>' }, undefined, admin.token);
  await newsletter.sendDue();
  const m = mailsTo('lecteur@exemple.dz')[0];
  assert.doesNotMatch(m.html, /<script>|<img src=x/);
  assert.match(m.html, /&lt;script&gt;/);
});

test('envoi : un échec est réessayé plus tard (10 minutes), puis abandonné après 5 tentatives', async () => {
  await confirmedSub('lecteur@exemple.dz');
  await post('/api/admin/newsletter/campaigns', campaign, undefined, admin.token);
  smtpDown = true;
  const original = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  try {
    assert.deepEqual(await newsletter.sendDue(), { sent: 0, failed: 1 });
    smtpDown = false;
    assert.deepEqual(await newsletter.sendDue(), { sent: 0, failed: 0 }, 'pas de nouvelle tentative avant 10 minutes');
    await q("UPDATE newsletter_deliveries SET tried_at = NOW() - interval '11 minutes'");
    assert.deepEqual(await newsletter.sendDue(), { sent: 1, failed: 0 });
  } finally { console.error = original; }
  assert.doesNotMatch(logged.join('\n'), /@/, 'pas d\'adresse dans les journaux');
  assert.equal(mailsTo('lecteur@exemple.dz').length, 1);

  await q('DELETE FROM newsletter_deliveries');
  await q("INSERT INTO newsletter_deliveries (campaign_id, subscriber_id, attempts, tried_at) SELECT id, (SELECT id FROM newsletter_subscribers), 5, NOW() - interval '1 day' FROM newsletter_campaigns");
  assert.deepEqual(await newsletter.sendDue(), { sent: 0, failed: 0 }, 'abandonné après 5 tentatives');
  const list = (await s.request('GET', '/api/admin/newsletter/campaigns', { token: admin.token })).body.items[0];
  assert.deepEqual([list.total, list.sent, list.failed], [1, 0, 1]);
});

test('envoi : un désabonné entre la mise en file et l\'envoi est écarté, une campagne annulée n\'envoie plus rien', async () => {
  const gone = await confirmedSub('parti@exemple.dz');
  await confirmedSub('reste@exemple.dz');
  const c1 = (await post('/api/admin/newsletter/campaigns', campaign, undefined, admin.token)).body.id;
  await post('/api/newsletter/unsubscribe', { e: String(gone), t: newsletter.token('unsub', gone) });
  assert.deepEqual(await newsletter.sendDue(), { sent: 1, failed: 0 });
  assert.equal(mailsTo('parti@exemple.dz').length, 0);

  await confirmedSub('nouveau@exemple.dz');
  const c2 = (await post('/api/admin/newsletter/campaigns', { ...campaign, subject_fr: 'Autre' }, undefined, admin.token)).body.id;
  assert.equal((await post(`/api/admin/newsletter/campaigns/${c2}/cancel`, undefined, undefined, admin.token)).status, 200);
  assert.deepEqual(await newsletter.sendDue(), { sent: 0, failed: 0 });
  assert.equal(mails.filter(m => m.subject === 'Autre').length, 0);
  assert.notEqual(c1, c2);
});

test('envoi : deux passages simultanés (deux workers) ne prennent jamais le même destinataire', async () => {
  for (let i = 1; i <= 12; i++) await confirmedSub(`abonne${i}@exemple.dz`);
  await post('/api/admin/newsletter/campaigns', campaign, undefined, admin.token);
  const [a, b, c] = await Promise.all([newsletter.sendDue(5), newsletter.sendDue(5), newsletter.sendDue(5)]);
  await newsletter.sendDue(5);
  const sent = mails.filter(m => /abonne\d+@/.test(m.to));
  assert.equal(sent.length, 12);
  assert.equal(new Set(sent.map(m => m.to)).size, 12, 'aucun doublon');
  assert.ok(a.sent + b.sent + c.sent <= 12);
});

test('envoi : sans SMTP, la file n\'est pas consommée', async () => {
  await confirmedSub('lecteur@exemple.dz');
  await post('/api/admin/newsletter/campaigns', campaign, undefined, admin.token);
  const original = mailer.configured;
  mailer.configured = () => false;
  try { assert.deepEqual(await newsletter.sendDue(), { sent: 0, failed: 0 }); } finally { mailer.configured = original; }
  assert.equal((await q('SELECT attempts FROM newsletter_deliveries')).rows[0].attempts, 0);
  assert.deepEqual(await newsletter.sendDue(), { sent: 1, failed: 0 });
});

// ── Purge ────────────────────────────────────────────────────────────────────
test('purge : les inscriptions jamais confirmées disparaissent après 7 jours, les autres restent', async () => {
  await q(`INSERT INTO newsletter_subscribers (email, created_at, confirm_sent_at, confirmed_at) VALUES
    ('ancien@exemple.dz', NOW() - interval '30 days', NULL, NULL),
    ('relance@exemple.dz', NOW() - interval '30 days', NOW() - interval '1 day', NULL),
    ('vieux-non-confirme@exemple.dz', NOW() - interval '30 days', NOW() - interval '8 days', NULL),
    ('recent@exemple.dz', NOW(), NOW(), NULL),
    ('confirme@exemple.dz', NOW() - interval '90 days', NOW() - interval '90 days', NOW() - interval '89 days')`);
  assert.equal(await newsletter.purgeUnconfirmed(), 2);
  assert.deepEqual((await q('SELECT email FROM newsletter_subscribers ORDER BY email')).rows.map(r => r.email),
    ['confirme@exemple.dz', 'recent@exemple.dz', 'relance@exemple.dz']);
});

// ── Administration ───────────────────────────────────────────────────────────
test('administration : routes réservées aux administrateurs', async () => {
  const user = await s.register('curieux');
  const calls = [['GET', '/api/admin/newsletter'], ['GET', '/api/admin/newsletter/campaigns'], ['POST', '/api/admin/newsletter/campaigns', campaign],
                 ['POST', '/api/admin/newsletter/campaigns/1/cancel'], ['POST', '/api/admin/newsletter/test', campaign]];
  await confirmedSub('lecteur@exemple.dz');
  for (const [method, url, body] of calls) {
    assert.equal((await s.request(method, url, { body })).status, 401, method + ' ' + url);
    assert.equal((await s.request(method, url, { body, token: user.token })).status, 403, method + ' ' + url);
  }
  assert.equal((await q('SELECT count(*)::int AS n FROM newsletter_campaigns')).rows[0].n, 0);
  assert.equal(mails.filter(m => m.to === 'lecteur@exemple.dz').length, 0);
});

test('administration : saisies refusées (400, traduites), 400 sans abonné confirmé, 404 pour une campagne inconnue', async () => {
  await confirmedSub('lecteur@exemple.dz');
  const bad = [
    [{}, 'Renseignez le sujet et le texte, au moins dans une langue (une langue commencée doit être complète).'],
    [{ subject_fr: 'Sujet' }, 'Renseignez le sujet et le texte, au moins dans une langue (une langue commencée doit être complète).'],
    [{ ...campaign, subject_ar: 'عنوان' }, 'Renseignez le sujet et le texte, au moins dans une langue (une langue commencée doit être complète).'],
    [{ subject_fr: ['x'], body_fr: { a: 1 } }, 'Renseignez le sujet et le texte, au moins dans une langue (une langue commencée doit être complète).'],
    [{ ...campaign, subject_fr: 'x'.repeat(151) }, 'Sujet trop long (150 caractères maximum).'],
    [{ ...campaign, body_fr: 'x'.repeat(10001) }, 'Texte trop long (10 000 caractères maximum).'],
  ];
  for (const [body, error] of bad) {
    const r = await post('/api/admin/newsletter/campaigns', body, undefined, admin.token);
    assert.equal(r.status, 400, error);
    assert.equal(r.body.error, error);
    assert.match((await post('/api/admin/newsletter/campaigns', body, { 'X-Lang': 'ar' }, admin.token)).body.error, ARABIC);
    assert.equal((await post('/api/admin/newsletter/test', body, undefined, admin.token)).status, 400);
  }
  assert.equal((await post('/api/admin/newsletter/campaigns', undefined, undefined, admin.token)).status, 400, 'corps absent');
  assert.equal((await q('SELECT count(*)::int AS n FROM newsletter_campaigns')).rows[0].n, 0);

  await q('DELETE FROM newsletter_subscribers');
  const none = await post('/api/admin/newsletter/campaigns', campaign, undefined, admin.token);
  assert.equal(none.status, 400);
  assert.equal(none.body.error, 'Aucun abonné confirmé.');
  assert.match((await post('/api/admin/newsletter/campaigns', campaign, { 'X-Lang': 'ar' }, admin.token)).body.error, ARABIC);
  assert.equal((await q('SELECT count(*)::int AS n FROM newsletter_campaigns')).rows[0].n, 0, 'aucune campagne vide');

  for (const id of ['999', 'abc', '1e3', '-1'])
    assert.equal((await post(`/api/admin/newsletter/campaigns/${id}/cancel`, undefined, undefined, admin.token)).status, 404, id);
  assert.match((await post('/api/admin/newsletter/campaigns/999/cancel', undefined, { 'X-Lang': 'ar' }, admin.token)).body.error, ARABIC);
});

test('administration : sans SMTP, création et test répondent 503', async () => {
  await confirmedSub('lecteur@exemple.dz');
  const original = mailer.configured;
  mailer.configured = () => false;
  try {
    for (const url of ['/api/admin/newsletter/campaigns', '/api/admin/newsletter/test']) {
      const r = await post(url, campaign, undefined, admin.token);
      assert.equal(r.status, 503, url);
      assert.match((await post(url, campaign, { 'X-Lang': 'ar' }, admin.token)).body.error, ARABIC);
    }
    assert.equal((await s.request('GET', '/api/admin/newsletter', { token: admin.token })).body.smtp, false);
  } finally { mailer.configured = original; }
  assert.equal((await q('SELECT count(*)::int AS n FROM newsletter_campaigns')).rows[0].n, 0);
});

test('administration : le test part vers l\'administrateur seul, sujet préfixé, lien de désinscription sans jeton', async () => {
  await confirmedSub('lecteur@exemple.dz');
  const r = await post('/api/admin/newsletter/test', campaign, undefined, admin.token);
  assert.equal(r.status, 200);
  const m = mailsTo(admin.email);
  assert.equal(m.length, 1);
  assert.equal(m[0].subject, '[TEST] Nouveautés');
  assert.equal(mailsTo('lecteur@exemple.dz').length, 0);
  assert.doesNotMatch(m[0].html, /t=[0-9a-f]{20}/, 'aucun jeton réel dans un test');
  assert.equal((await q('SELECT count(*)::int AS n FROM newsletter_campaigns')).rows[0].n, 0, 'un test ne crée pas de campagne');
  smtpDown = true;
  const original = console.error;
  console.error = () => {};
  try { assert.equal((await post('/api/admin/newsletter/test', campaign, undefined, admin.token)).status, 503); } finally { console.error = original; }
});

test('administration : abonnés (colonnes explicites, compte des confirmés) et campagnes (paginées, avec envoyés / échecs)', async () => {
  await q("INSERT INTO newsletter_subscribers (email) SELECT 'attente' || g || '@exemple.dz' FROM generate_series(1, 30) g");
  await confirmedSub('c1@exemple.dz');
  await confirmedSub('c2@exemple.dz', 'ar');
  const subs = (await s.request('GET', '/api/admin/newsletter?per_page=10', { token: admin.token })).body;
  assert.equal(subs.items.length, 10);
  assert.equal(subs.total, 32);
  assert.equal(subs.confirmed, 2);
  assert.equal(subs.smtp, true);
  assert.deepEqual(Object.keys(subs.items[0]).sort(), ['confirmed_at', 'created_at', 'email', 'id', 'lang']);

  for (let i = 1; i <= 3; i++) await post('/api/admin/newsletter/campaigns', { ...campaign, subject_fr: 'Envoi ' + i }, undefined, admin.token);
  await newsletter.sendDue(2);
  const list = (await s.request('GET', '/api/admin/newsletter/campaigns?per_page=2', { token: admin.token })).body;
  assert.equal(list.items.length, 2);
  assert.equal(list.total, 3);
  assert.equal(list.pages, 2);
  assert.equal(list.items[0].subject_fr, 'Envoi 3', 'plus récent d\'abord');
  assert.deepEqual(list.items.map(c => c.total), [2, 2]);
  // La file se vide dans l'ordre : les deux envois partis sont ceux de la première campagne (page 2)
  const all = (await s.request('GET', '/api/admin/newsletter/campaigns?per_page=3', { token: admin.token })).body.items;
  assert.deepEqual(all.map(c => [c.subject_fr, c.sent]), [['Envoi 3', 0], ['Envoi 2', 0], ['Envoi 1', 2]]);
  const huge = (await s.request('GET', '/api/admin/newsletter/campaigns?per_page=100000', { token: admin.token })).body;
  assert.ok(huge.items.length <= 100, 'liste bornée');
});

// ── Code et interface ────────────────────────────────────────────────────────
test('newsletter : limiteur partagé sur l\'inscription seulement, tâches planifiées, variables de configuration', () => {
  const app = fs.readFileSync(path.join(ROOT, 'server', 'app.js'), 'utf8');
  assert.match(app, /\.\.\.shared\('newsletter'\)/);
  assert.ok(app.includes("app.use('/api/newsletter/subscribe', newsletterLimiter)"));
  const cron = fs.readFileSync(path.join(ROOT, 'server', 'cron.js'), 'utf8');
  assert.match(cron, /newsletter'\)\.sendDue\(\)/);
  assert.match(cron, /newsletter'\)\.purgeUnconfirmed\(\)/);
  const routes = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'newsletter.js'), 'utf8');
  assert.doesNotMatch(routes, /res\.json\(\{[^}]*(token|jeton)/i, 'aucune route publique ne renvoie de jeton');
});

test('front : formulaire du pied de page, page des liens, textes FR / AR, aucune donnée dans un onclick', () => {
  const front = readFront();
  assert.match(front, /onsubmit="return newsletterSubscribe\(event\)"/);
  assert.match(front, /id="page-newsletter"/);
  assert.ok(front.includes("api('/newsletter/subscribe', 'POST'"));
  assert.ok(front.includes("'/newsletter/' + (kind === 'confirm' ? 'confirm' : 'unsubscribe')"));
  assert.match(front, /const PAGES = \[[^\]]*'newsletter'/);
  for (const key of ['nl_title', 'nl_desc', 'nl_btn', 'nl_sent', 'nl_failed', 'nl_confirm_ask_title', 'nl_confirm_ask_msg', 'nl_confirm_ask_btn',
    'nl_confirm_done_title', 'nl_confirm_done_msg', 'nl_unsub_ask_title', 'nl_unsub_ask_msg', 'nl_unsub_ask_btn', 'nl_unsub_done_title',
    'nl_unsub_done_msg', 'nl_bad_title', 'nl_bad_msg'])
    assert.equal(front.split(key + ':').length - 1, 2, key + ' en français et en arabe');
  // Les actions de l'administration lisent leur identifiant dans data-id, jamais dans le code de l'attribut onclick
  assert.match(front, /data-id="\$\{Number\(k\.id\)\}" onclick="adminNlCancel\(this\)"/);
  // Le lien de l'email n'agit pas à l'ouverture : seul le bouton appelle l'API
  const open = front.slice(front.indexOf('function showNewsletterLink'), front.indexOf('async function newsletterAct'));
  assert.doesNotMatch(open, /api\(/);
});
