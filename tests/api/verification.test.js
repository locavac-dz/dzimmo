// Vérification des annonceurs : envoi d'un justificatif, examen par un admin, badge public, suppression des fichiers.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const sharp  = require('sharp');

// Dossier privé jetable, fixé avant le démarrage du serveur
const PRIVATE = fs.mkdtempSync(path.join(os.tmpdir(), 'dzimmo-verif-'));
process.env.VERIFICATION_DIR = PRIVATE;
const { startServer } = require('../helpers/server');
const { AR } = require('../../server/i18n');

let s, admin, mails, wsLog;
const q = (sql, p) => s.db.pool.query(sql, p);
const filesOnDisk = () => fs.existsSync(PRIVATE) ? fs.readdirSync(PRIVATE) : [];
const settle = async (cond, ms = 1500) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return; await new Promise(r => setTimeout(r, 20)); } };

test.before(async () => {
  s = await startServer();
  mails = []; wsLog = [];
  require('nodemailer').createTransport = () => ({ sendMail: async o => { mails.push(o); } });
  process.env.EMAIL_HOST = 'smtp.test'; process.env.EMAIL_USER = 'noreply@test.dz';
  require('../../server/ws').send = (id, data) => { wsLog.push({ id: Number(id), data }); };
  admin = await s.makeAdmin(await s.register('admin'));
});
test.after(async () => { await s.stop(); fs.rmSync(PRIVATE, { recursive: true, force: true }); });

// Petite image valide (PNG) et « fausse » image
const png = (w = 600, h = 400) => sharp({ create: { width: w, height: h, channels: 3, background: '#8899aa' } }).png().toBuffer();

// Envoi multipart : fields = objet, files = [{ name, type, data }]
async function post(url, { token, fields = {}, files = [], headers = {} } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append('files', new Blob([f.data], { type: f.type }), f.name);
  const res = await fetch(s.base + url, { method: 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: fd });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const submit = async (user, over = {}, files) => post('/api/verification', {
  token: user.token,
  fields: { kind: 'identity', doc_type: 'cni', consent: 'true', ...over },
  files: files || [{ name: 'cni.png', type: 'image/png', data: await png() }],
});
const get = (url, token, headers) => s.request('GET', url, { token, headers });
// Sans 3e argument : jeton admin ; « undefined » explicite = appel sans jeton
const decide = (id, body, ...t) => s.request('PUT', `/api/admin/verifications/${id}/decision`, { token: t.length ? t[0] : admin.token, body });

test('état initial : compte non vérifié, aucune demande', async () => {
  const u = await s.register('vide');
  const r = await get('/api/verification/me', u.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { verified_kind: null, verified_at: null, agency: null, request: null });
  assert.equal((await get('/api/verification/me')).status, 401);
});

test('parcours particulier : envoi, examen, approbation, badge public, fichiers supprimés', async () => {
  const u = await s.register('particulier');
  const r = await submit(u, {}, [
    { name: 'recto.png', type: 'image/png', data: await png() },
    { name: 'verso.jpg', type: 'image/jpeg', data: await sharp({ create: { width: 500, height: 300, channels: 3, background: '#aa8899' } }).jpeg().toBuffer() },
  ]);
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'pending');
  const filesBeforeSubmit = 0;   // premier test à écrire des fichiers de ce dossier jetable
  assert.equal(filesOnDisk().length, filesBeforeSubmit + 2, 'deux fichiers dans le dossier privé');
  assert.ok(filesOnDisk().every(f => /^[a-f0-9]{32}\.webp$/.test(f)), 'noms générés par le serveur, jamais ceux de l\'utilisateur');

  // Suivi côté demandeur : jamais de nom de fichier
  const me = (await get('/api/verification/me', u.token)).body;
  assert.equal(me.request.status, 'pending');
  assert.equal(me.request.kind, 'identity');
  assert.ok(!('files' in me.request));
  assert.equal(me.verified_kind, null);

  // Les admins sont prévenus (temps réel + email)
  await settle(() => mails.some(m => m.to === admin.email));
  assert.ok(wsLog.some(w => w.id === admin.id && w.data.notif_type === 'verification_pending'));
  assert.match(mails.find(m => m.to === admin.email && /Vérification à traiter/.test(m.subject)).html, /pièce d'identité/);

  // File d'examen
  const queue = (await get('/api/admin/verifications', admin.token)).body;
  const item = queue.items.find(i => i.user_id === u.id);
  assert.equal(queue.counts.pending, queue.total);
  assert.equal(item.user_email, u.email);
  assert.equal(item.files_count, 2);
  assert.equal(item.doc_type, 'cni');

  // Le justificatif est consultable par un admin, en image WebP, sans cache
  const img = await fetch(`${s.base}/api/admin/verifications/${item.id}/files/0`, { headers: { Authorization: 'Bearer ' + admin.token } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  assert.match(img.headers.get('cache-control'), /no-store/);
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  const bytes = Buffer.from(await img.arrayBuffer());
  assert.equal((await sharp(bytes).metadata()).format, 'webp');

  // Approbation
  const wsBefore = wsLog.length, mailsBefore = mails.length;
  assert.equal((await decide(item.id, { decision: 'approve' })).status, 200);
  assert.equal((await q('SELECT verified_kind, verified_at FROM users WHERE id = $1', [u.id])).rows[0].verified_kind, 'identity');
  assert.ok((await q('SELECT verified_at FROM users WHERE id = $1', [u.id])).rows[0].verified_at);
  assert.equal(filesOnDisk().length, filesBeforeSubmit, 'justificatifs supprimés dès la décision');
  const row = (await q('SELECT status, files, reviewed_by, reviewed_at FROM verification_requests WHERE id = $1', [item.id])).rows[0];
  assert.deepEqual([row.status, row.files, row.reviewed_by], ['approved', [], admin.id]);
  assert.ok(row.reviewed_at);
  assert.equal((await get(`/api/admin/verifications/${item.id}/files/0`, admin.token)).status, 404, 'plus de justificatif à consulter');

  // Le demandeur est prévenu, dans sa langue
  await settle(() => mails.length > mailsBefore);
  const notif = wsLog.slice(wsBefore).find(w => w.id === u.id).data;
  assert.equal(notif.title, 'Compte vérifié');
  assert.match(mails.find(m => m.to === u.email && /vérifié/.test(m.subject)).html, /Identité vérifiée/);

  // Badge public : profil, connexion, annonce
  assert.equal((await get(`/api/auth/users/${u.id}`)).body.verified_kind, 'identity');
  assert.equal((await get('/api/verification/me', u.token)).body.verified_kind, 'identity');
  assert.equal((await s.request('POST', '/api/auth/login', { body: { email: u.email, password: 'motdepasse1' } })).body.user.verified_kind, 'identity');
  await q('DELETE FROM properties');
  const prop = (await s.request('POST', '/api/properties', { token: u.token, body: { title: 'Bien vérifié', mode: 'vente', type_bien: 'villa', price: 5, wilaya: 'Oran', photos: [] } })).body.id;
  await s.request('PUT', `/api/admin/properties/${prop}/moderate`, { token: admin.token, body: { decision: 'approve' } });
  const detail = (await get(`/api/properties/${prop}`)).body;
  assert.equal(detail.owner_verified_kind, 'identity');
  assert.equal(detail.agency_verified, false);
  const list = (await get('/api/properties')).body.data.find(p => p.id === prop);
  assert.equal(list.owner_verified_kind, 'identity');
  assert.equal(list.agency_verified, false);
});

test('parcours professionnel : agence vérifiée d\'emblée, publication sans modération', async () => {
  const u = await s.register('agence');
  const ag = (await s.request('POST', '/api/agencies', { token: u.token, body: { name: 'Agence Confiance', wilaya: 'Oran' } })).body.id;
  assert.equal((await q('SELECT verified FROM agencies WHERE id = $1', [ag])).rows[0].verified, false);
  assert.equal((await submit(u, { kind: 'business', doc_type: 'registre_commerce' })).status, 400, 'numéro du registre requis');
  const sub = await submit(u, { kind: 'business', doc_type: 'registre_commerce', reference: '22/00-0025204B26' });
  assert.equal(sub.status, 201);
  assert.equal((await decide(sub.body.id, { decision: 'approve' })).status, 200);
  assert.equal((await q('SELECT verified_kind FROM users WHERE id = $1', [u.id])).rows[0].verified_kind, 'business');
  assert.equal((await q('SELECT verified FROM agencies WHERE id = $1', [ag])).rows[0].verified, true);
  // Une annonce est publiée sans passer par la file de modération
  const p = await s.request('POST', '/api/properties', { token: u.token, body: { title: 'Direct', mode: 'vente', type_bien: 'villa', price: 5, wilaya: 'Oran', photos: [] } });
  assert.equal(p.body.status, 'active');
  assert.equal((await get(`/api/properties/${p.body.id}`)).body.agency_verified, false, 'l\'annonce n\'est pas rattachée à l\'agence : pas de badge d\'agence');
  assert.equal((await get(`/api/properties/${p.body.id}`)).body.owner_verified_kind, 'business');
  const me = (await get('/api/verification/me', u.token)).body;
  assert.deepEqual(me.agency, { id: ag, name: 'Agence Confiance', verified: true });
});

test('professionnel vérifié qui crée son agence après coup : agence vérifiée d\'emblée', async () => {
  const u = await s.register('agence-tardive');
  const sub = await submit(u, { kind: 'business', doc_type: 'agrement', reference: 'AGR-2026-77' });
  await decide(sub.body.id, { decision: 'approve' });
  const ag = (await s.request('POST', '/api/agencies', { token: u.token, body: { name: 'Agence Tardive', wilaya: 'Blida' } })).body.id;
  assert.equal((await q('SELECT verified FROM agencies WHERE id = $1', [ag])).rows[0].verified, true);
});

test('refus : motif obligatoire, fichiers supprimés, demandeur prévenu en arabe, nouvel envoi possible', async () => {
  const u = await s.register('refuse');
  await s.request('POST', '/api/auth/login', { headers: { 'X-Lang': 'ar' }, body: { email: u.email, password: 'motdepasse1' } });
  const sub = await submit(u);
  assert.equal(sub.status, 201);
  assert.equal((await decide(sub.body.id, { decision: 'reject' })).status, 400, 'motif requis');
  assert.equal((await decide(sub.body.id, { decision: 'reject', reason: 'abc' })).status, 400, 'motif trop court');
  const filesBefore = filesOnDisk().length;
  const wsBefore = wsLog.length, mailsBefore = mails.length;
  assert.equal((await decide(sub.body.id, { decision: 'reject', reason: 'Document expiré — carte périmée' })).status, 200);
  assert.equal(filesOnDisk().length, filesBefore - 1, 'le fichier de cette demande est supprimé');
  assert.equal((await q('SELECT verified_kind FROM users WHERE id = $1', [u.id])).rows[0].verified_kind, null);
  const me = (await get('/api/verification/me', u.token)).body;
  assert.deepEqual([me.request.status, me.request.reason], ['rejected', 'Document expiré — carte périmée']);
  await settle(() => mails.length > mailsBefore);
  const n = wsLog.slice(wsBefore).find(w => w.id === u.id).data;
  assert.match(n.title, /[؀-ۿ]/, 'notification en arabe');
  assert.match(n.body, /الوثيقة منتهية الصلاحية — carte périmée/, 'motif prédéfini traduit, précision libre conservée');
  const mail = mails.find(m => m.to === u.email && /التوثيق/.test(m.subject));
  assert.match(mail.html, /dir="rtl"/);
  // Le refus n'interdit pas de réessayer
  assert.equal((await submit(u)).status, 201);
});

test('une seule demande en cours par compte ; annulation par le demandeur', async () => {
  const u = await s.register('doublon');
  const first = await submit(u);
  assert.equal(first.status, 201);
  const filesAfterFirst = filesOnDisk().length;
  const second = await submit(u);
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'Une demande de vérification est déjà en cours.');
  assert.equal(filesOnDisk().length, filesAfterFirst, 'le refus du doublon ne laisse aucun fichier orphelin');
  // Envois simultanés : une seule demande créée
  const v = await s.register('simultane');
  const png1 = await png();
  const results = await Promise.all([1, 2, 3, 4].map(() => post('/api/verification', { token: v.token, fields: { kind: 'identity', doc_type: 'cni', consent: 'true' }, files: [{ name: 'a.png', type: 'image/png', data: png1 }] })));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 3);
  assert.equal((await q(`SELECT COUNT(*)::int n FROM verification_requests WHERE user_id = $1`, [v.id])).rows[0].n, 1);

  // Annulation : seule la personne concernée, seulement en cours
  const other = await s.register('autre');
  assert.equal((await s.request('DELETE', `/api/verification/${first.body.id}`, { token: other.token })).status, 404);
  const before = filesOnDisk().length;
  assert.equal((await s.request('DELETE', `/api/verification/${first.body.id}`, { token: u.token })).status, 200);
  assert.equal(filesOnDisk().length, before - 1);
  assert.equal((await s.request('DELETE', `/api/verification/${first.body.id}`, { token: u.token })).status, 404);
  assert.equal((await get('/api/verification/me', u.token)).body.request, null);
  assert.equal((await submit(u)).status, 201, 'nouvelle demande possible');
});

test('validations : type, document, consentement, fichiers', async () => {
  const u = await s.register('valide');
  const before = filesOnDisk().length;
  const cases = [
    [{ kind: 'nimporte' }, 'Type de vérification invalide.'],
    [{ kind: undefined }, 'Type de vérification invalide.'],
    [{ kind: '__proto__' }, 'Type de vérification invalide.'],
    [{ doc_type: 'registre_commerce' }, 'Type de document invalide.'],
    [{ kind: 'business', doc_type: 'cni', reference: 'RC-123' }, 'Type de document invalide.'],
    [{ kind: 'business', doc_type: 'agrement', reference: 'ab' }, "Numéro du registre de commerce ou de l'agrément requis."],
    [{ kind: 'business', doc_type: 'agrement', reference: 'x'.repeat(41) }, "Numéro du registre de commerce ou de l'agrément requis."],
    [{ consent: 'false' }, 'Votre consentement est requis pour examiner le justificatif.'],
    [{ consent: undefined }, 'Votre consentement est requis pour examiner le justificatif.'],
  ];
  for (const [over, message] of cases) {
    const r = await submit(u, over);
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.body.error, message, JSON.stringify(over));
  }
  assert.equal((await submit(u, {}, [])).body.error, 'Au moins un justificatif (photo) est requis.');
  assert.equal(filesOnDisk().length, before, 'aucun fichier écrit pour une demande invalide');
  // Sans compte
  assert.equal((await post('/api/verification', { fields: { kind: 'identity', doc_type: 'cni', consent: 'true' } })).status, 401);
});

test('fichiers : format, faux fichier image, taille, nombre', async () => {
  const u = await s.register('fichiers');
  const before = filesOnDisk().length;
  const bad = async (files, status, message) => {
    const r = await submit(u, {}, files);
    assert.equal(r.status, status, message);
    assert.equal(r.body.error, message);
  };
  await bad([{ name: 'a.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4 ...') }], 400, 'Format non supporté. Utilisez JPEG, PNG ou WebP.');
  await bad([{ name: 'a.svg', type: 'image/svg+xml', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') }], 400, 'Format non supporté. Utilisez JPEG, PNG ou WebP.');
  await bad([{ name: 'a.png', type: 'image/png', data: Buffer.from('ceci n\'est pas une image') }], 400, "Ce justificatif n'est pas une image valide.");
  await bad([{ name: 'a.png', type: 'image/png', data: Buffer.from('<?php system($_GET["c"]); ?>') }], 400, "Ce justificatif n'est pas une image valide.");
  // Un fichier valide suivi d'un faux : rien ne reste sur le disque
  await bad([{ name: 'ok.png', type: 'image/png', data: await png() }, { name: 'faux.png', type: 'image/png', data: Buffer.from('faux') }], 400, "Ce justificatif n'est pas une image valide.");
  await bad(await Promise.all([1, 2, 3].map(async () => ({ name: 'x.png', type: 'image/png', data: await png() }))), 400, 'Trop de fichiers (2 maximum).');
  const gros = await sharp({ create: { width: 3000, height: 3000, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer();
  assert.ok(gros.length > 8 * 1024 * 1024, 'l\'image de test dépasse 8 Mo');
  await bad([{ name: 'gros.png', type: 'image/png', data: gros }], 400, 'Fichier trop volumineux (8 Mo maximum).');
  assert.equal(filesOnDisk().length, before, 'aucun fichier orphelin après tous ces refus');
});

test('les métadonnées de l\'image (EXIF, GPS) sont retirées et la taille bornée', async () => {
  const u = await s.register('exif');
  const withExif = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#556677' } })
    .withExif({ IFD0: { Copyright: 'SECRET-COPYRIGHT', Artist: 'SECRET-ARTIST' } }).jpeg().toBuffer();
  assert.match((await sharp(withExif).metadata()).exif.toString('latin1'), /SECRET-ARTIST/);
  const r = await submit(u, {}, [{ name: 'photo.jpg', type: 'image/jpeg', data: withExif }]);
  assert.equal(r.status, 201);
  const item = (await get('/api/admin/verifications?per_page=100', admin.token)).body.items.find(i => i.user_id === u.id);
  const img = Buffer.from(await (await fetch(`${s.base}/api/admin/verifications/${item.id}/files/0`, { headers: { Authorization: 'Bearer ' + admin.token } })).arrayBuffer());
  const meta = await sharp(img).metadata();
  assert.ok(!meta.exif || !/SECRET/.test(meta.exif.toString('latin1')), 'aucune métadonnée conservée');
  assert.ok(Math.max(meta.width, meta.height) <= 2000, 'image réduite à 2000 px');
});

test('sécurité : justificatifs et décisions réservés aux administrateurs, jamais dans les fichiers publics', async () => {
  const u = await s.register('secu');
  const sub = await submit(u);
  const other = await s.register('curieux');
  for (const token of [undefined, other.token, u.token]) {
    const expected = token ? 403 : 401;
    assert.equal((await get('/api/admin/verifications', token)).status, expected);
    assert.equal((await get(`/api/admin/verifications/${sub.body.id}/files/0`, token)).status, expected);
    assert.equal((await decide(sub.body.id, { decision: 'approve' }, token)).status, expected);
    assert.equal((await s.request('PUT', `/api/admin/verifications/revoke/${u.id}`, { token })).status, expected);
  }
  assert.equal((await q('SELECT verified_kind FROM users WHERE id = $1', [u.id])).rows[0].verified_kind, null, 'aucune décision passée');
  // Le dossier privé n'est pas servi par le site
  const name = filesOnDisk()[0];
  for (const url of [`/uploads/${name}`, `/private/verification/${name}`, `/verification/${name}`, `/${name}`, '/private/', `/api/verification/${name}`])
    assert.ok([401, 404].includes((await get(url)).status), url);
  assert.ok(!fs.readdirSync(path.join(__dirname, '..', '..', 'public', 'uploads')).includes(name), 'pas dans public/uploads');
  // Numéros de fichier et identifiants absurdes : introuvable, jamais d'erreur serveur
  for (const n of ['-1', '2', '9', 'abc', '../../etc/passwd', '0%2F..']) assert.equal((await get(`/api/admin/verifications/${sub.body.id}/files/${n}`, admin.token)).status, 404, n);
  for (const id of ['abc', '0', '99999999999', '1.5']) assert.equal((await get(`/api/admin/verifications/${id}/files/0`, admin.token)).status, 404, id);
  assert.equal((await decide('abc', { decision: 'approve' })).status, 404);
  assert.equal((await decide(sub.body.id, { decision: 'peut-etre' })).status, 400);
});

test('une demande déjà traitée ne se traite pas deux fois ; identité ne rétrograde pas « professionnel »', async () => {
  const u = await s.register('deux-fois');
  const sub = await submit(u);
  assert.equal((await decide(sub.body.id, { decision: 'approve' })).status, 200);
  const again = await decide(sub.body.id, { decision: 'reject', reason: 'trop tard, pas valable' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'Demande déjà traitée.');
  assert.equal((await q('SELECT verified_kind FROM users WHERE id = $1', [u.id])).rows[0].verified_kind, 'identity');
  // Déjà vérifié : pas de nouvelle demande du même type
  assert.equal((await submit(u)).body.error, 'Votre compte est déjà vérifié.');
  // Passer à « professionnel » reste possible
  const biz = await submit(u, { kind: 'business', doc_type: 'registre_commerce', reference: 'RC 12345' });
  assert.equal(biz.status, 201);
  await decide(biz.body.id, { decision: 'approve' });
  assert.equal((await q('SELECT verified_kind FROM users WHERE id = $1', [u.id])).rows[0].verified_kind, 'business');
  // Une vérification d'identité approuvée après coup ne ramène pas à « identity »
  await q(`INSERT INTO verification_requests (user_id, kind, doc_type) VALUES ($1, 'identity', 'cni')`, [u.id]);
  const late = (await q(`SELECT id FROM verification_requests WHERE user_id = $1 AND status = 'pending'`, [u.id])).rows[0].id;
  await decide(late, { decision: 'approve' });
  assert.equal((await q('SELECT verified_kind FROM users WHERE id = $1', [u.id])).rows[0].verified_kind, 'business');
  assert.equal((await submit(u, { kind: 'business', doc_type: 'agrement', reference: 'AG 1234' })).body.error, 'Votre compte est déjà vérifié.');
});

test('retrait d\'une vérification : badge et agence retirés', async () => {
  const u = await s.register('fraude');
  const ag = (await s.request('POST', '/api/agencies', { token: u.token, body: { name: 'Agence Douteuse', wilaya: 'Oran' } })).body.id;
  const sub = await submit(u, { kind: 'business', doc_type: 'agrement', reference: 'AG-999' });
  await decide(sub.body.id, { decision: 'approve' });
  assert.equal((await q('SELECT verified FROM agencies WHERE id = $1', [ag])).rows[0].verified, true);
  assert.equal((await s.request('PUT', `/api/admin/verifications/revoke/${u.id}`, { token: admin.token })).status, 200);
  assert.deepEqual((await q('SELECT verified_kind, verified_at FROM users WHERE id = $1', [u.id])).rows[0], { verified_kind: null, verified_at: null });
  assert.equal((await q('SELECT verified FROM agencies WHERE id = $1', [ag])).rows[0].verified, false);
  assert.equal((await get(`/api/auth/users/${u.id}`)).body.verified_kind, null);
  assert.equal((await s.request('PUT', `/api/admin/verifications/revoke/${u.id}`, { token: admin.token })).status, 404, 'déjà retiré');
  assert.equal((await s.request('PUT', '/api/admin/verifications/revoke/abc', { token: admin.token })).status, 404);
  // La liste des comptes de l'admin montre l'état
  const row = (await get('/api/admin/users?per_page=100', admin.token)).body.items.find(x => x.id === u.id);
  assert.equal(row.verified_kind, null);
});

test('file d\'examen : pagination, statuts, recherche des décisions passées', async () => {
  const before = (await get('/api/admin/verifications', admin.token)).body;
  const users = [];
  for (let i = 0; i < 12; i++) { const u = await s.register('file' + i); users.push(u); assert.equal((await submit(u)).status, 201); }
  const p1 = (await get('/api/admin/verifications', admin.token)).body;
  assert.equal(p1.per_page, 10);
  assert.equal(p1.items.length, 10);
  assert.equal(p1.total, before.total + 12);
  assert.equal(p1.counts.pending, p1.total);
  const dates = p1.items.map(i => new Date(i.created_at).getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => a - b), 'les plus anciennes d\'abord');
  const last = (await get(`/api/admin/verifications?page=${p1.pages}`, admin.token)).body;
  assert.ok(last.items.length >= 1);
  const done = (await get('/api/admin/verifications?status=approved&per_page=100', admin.token)).body;
  assert.ok(done.items.length >= 3 && done.items.every(i => i.status === 'approved'));
  assert.ok((await get('/api/admin/verifications?status=rejected', admin.token)).body.items.every(i => i.status === 'rejected'));
  assert.ok(!('files' in done.items[0]), 'jamais de noms de fichiers dans la liste');
});

test('suppression du compte : justificatifs en attente supprimés', async () => {
  const u = await s.register('supprime');
  await submit(u);
  const before = filesOnDisk().length;
  assert.equal((await s.request('DELETE', '/api/auth/me', { token: u.token })).status, 200);
  assert.equal(filesOnDisk().length, before - 1, 'le justificatif disparaît avec le compte');
  assert.equal((await q('SELECT COUNT(*)::int n FROM verification_requests WHERE user_id = $1', [u.id])).rows[0].n, 0);
});

test('messages d\'erreur traduits en arabe', async () => {
  const u = await s.register('arabe');
  const r = await post('/api/verification', { token: u.token, headers: { 'X-Lang': 'ar' }, fields: { kind: 'identity', doc_type: 'cni', consent: 'true' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, AR['Au moins un justificatif (photo) est requis.']);
  const dup = await submit(u); assert.equal(dup.status, 201);
  const again = await post('/api/verification', { token: u.token, headers: { 'X-Lang': 'ar' }, fields: { kind: 'identity', doc_type: 'cni', consent: 'true' }, files: [{ name: 'a.png', type: 'image/png', data: await png() }] });
  assert.equal(again.body.error, AR['Une demande de vérification est déjà en cours.']);
});
