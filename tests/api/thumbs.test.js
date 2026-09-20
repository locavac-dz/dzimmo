// Miniatures des photos (server/thumbs.js) : générées à la première demande, conservées, largeurs et noms strictement contrôlés.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const sharp  = require('sharp');
const http   = require('node:http');
const { startServer } = require('../helpers/server');

const UPLOADS = path.join(__dirname, '..', '..', 'public', 'uploads');
const THUMBS  = path.join(UPLOADS, 'thumbs');
const TAG     = `test-thumbs-${process.pid}-${Date.now().toString(36)}`;
const made = [];     // fichiers créés par ce test (originaux et miniatures), retirés à la fin

let s, thumbs;
const get = async (url, headers = {}) => fetch(s.base + url, { headers, redirect: 'manual' });
// http brut : fetch (undici) ajoute « Cache-Control: no-cache » dès qu'on lui donne If-None-Match, ce qui empêche toute réponse 304
const rawGet = (url, headers) => new Promise((ok, ko) => http.get(s.base + url, { headers }, res => { res.resume(); res.on('end', () => ok(res)); }).on('error', ko));
const meta = async res => sharp(Buffer.from(await res.arrayBuffer())).metadata();

async function original(name, width = 1600, height = 1000) {
  fs.mkdirSync(UPLOADS, { recursive: true });
  const file = path.join(UPLOADS, name);
  await sharp({ create: { width, height, channels: 3, background: '#3b82f6' } }).webp().toFile(file);
  made.push(file);
  return file;
}
const thumbFile = (w, name) => path.join(THUMBS, String(w), name);

test.before(async () => {
  s = await startServer();
  thumbs = require('../../server/thumbs');
});
test.after(async () => {
  await s.stop();
  for (const f of made) try { fs.unlinkSync(f); } catch { /* déjà retiré */ }
  for (const w of [480, 960]) for (const f of (fs.existsSync(path.join(THUMBS, String(w))) ? fs.readdirSync(path.join(THUMBS, String(w))) : []))
    if (f.startsWith(TAG)) fs.unlinkSync(path.join(THUMBS, String(w), f));
});

test('première demande : la miniature est créée à la bonne largeur, en WebP, cache d\'un an « immuable » ; l\'original est intact', async () => {
  const name = `${TAG}-a.webp`;
  const src = await original(name);
  const before = fs.statSync(src).size;
  assert.equal(fs.existsSync(thumbFile(480, name)), false);
  const r = await get(`/uploads/thumbs/480/${name}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/webp');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const m = await meta(r);
  assert.deepEqual([m.format, m.width, m.height], ['webp', 480, 300], 'proportions conservées');
  assert.ok(fs.existsSync(thumbFile(480, name)), 'conservée sur disque');
  assert.equal(fs.statSync(src).size, before, 'l\'original n\'est pas modifié');
  const big = await meta(await get(`/uploads/thumbs/960/${name}`));
  assert.deepEqual([big.width, big.height], [960, 600]);
  made.push(thumbFile(480, name), thumbFile(960, name));
});

test('deuxième demande : servie directement depuis le disque par express.static, mêmes en-têtes, sans régénération', async () => {
  const name = `${TAG}-b.webp`;
  await original(name);
  await get(`/uploads/thumbs/480/${name}`);
  made.push(thumbFile(480, name));
  const t0 = fs.statSync(thumbFile(480, name)).mtimeMs;
  const again = await get(`/uploads/thumbs/480/${name}`);
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(fs.statSync(thumbFile(480, name)).mtimeMs, t0, 'fichier inchangé');
  // Revalidation : 304 quand le navigateur repose la question (rechargement forcé)
  const etag = again.headers.get('etag');
  assert.ok(etag, 'ETag');
  assert.equal((await rawGet(`/uploads/thumbs/480/${name}`, { 'If-None-Match': etag })).statusCode, 304);
});

test('une photo plus étroite que la miniature n\'est pas agrandie', async () => {
  const name = `${TAG}-petite.webp`;
  await original(name, 300, 200);
  const m = await meta(await get(`/uploads/thumbs/960/${name}`));
  assert.deepEqual([m.width, m.height], [300, 200]);
  made.push(thumbFile(960, name));
});

test('demandes simultanées : toutes réussissent, une seule miniature créée, aucun fichier temporaire ne reste', async () => {
  const name = `${TAG}-course.webp`;
  await original(name);
  const results = await Promise.all(Array.from({ length: 12 }, () => get(`/uploads/thumbs/480/${name}`)));
  assert.deepEqual(results.map(r => r.status), Array(12).fill(200));
  const sizes = new Set(await Promise.all(results.map(async r => (await r.arrayBuffer()).byteLength)));
  assert.equal(sizes.size, 1, 'même contenu pour tous');
  made.push(thumbFile(480, name));
  const leftovers = fs.readdirSync(path.join(THUMBS, '480')).filter(f => f.startsWith(TAG) && f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('largeurs : seules 480 et 960 existent ; tout le reste est une 404 ordinaire et ne crée rien', async () => {
  const name = `${TAG}-largeurs.webp`;
  await original(name);
  const before = fs.existsSync(THUMBS) ? fs.readdirSync(THUMBS).sort() : [];
  for (const w of ['0', '1', '100', '500', '1920', '4000', '-480', '480.0', '0480', '4.8e2', '480%20', 'abc', '%00', '999999999999']) {
    const r = await get(`/uploads/thumbs/${w}/${name}`);
    assert.equal(r.status, 404, `largeur ${w}`);
  }
  assert.deepEqual(fs.existsSync(THUMBS) ? fs.readdirSync(THUMBS).sort() : [], before, 'aucun dossier créé par une largeur refusée');
  assert.deepEqual(thumbs.WIDTHS, [480, 960]);
});

test('noms : seuls les fichiers .webp de /uploads ; traversée de dossier, extensions et noms piégés refusés', async () => {
  await original(`${TAG}-nom.webp`);
  for (const bad of ['..%2f..%2fpackage.json', '..%2fserver%2fapp.js', '%2e%2e%2fpackage.json', `${TAG}-nom.png`, `${TAG}-nom.jpg`, `${TAG}-nom.webp.php`, `${TAG}-nom.WEBPX`,
    '.webp', 'a%00.webp', 'a%20b.webp', 'index.html', 'thumbs', '..', '%5c..%5cpackage.json', 'x'.repeat(400) + '.webp']) {
    const r = await get(`/uploads/thumbs/480/${bad}`);
    assert.equal(r.status, 404, bad.slice(0, 50));
    assert.doesNotMatch(r.headers.get('content-type') || '', /image\/webp/, bad.slice(0, 50));
  }
  assert.equal((await get('/uploads/thumbs/480/absent-du-disque.webp')).status, 404, 'original absent');
  assert.equal((await get('/uploads/thumbs/480/')).status, 404);
  const dir = await get('/uploads/thumbs/480');    // le dossier lui-même : redirection vers « …/480/ » (comme /uploads), puis 404, jamais de liste de fichiers
  assert.deepEqual([dir.status, dir.headers.get('location')], [301, '/uploads/thumbs/480/']);
  assert.deepEqual([thumbs.thumbPath(480, '../x.webp'), thumbs.thumbPath(480, 'a/b.webp'), thumbs.thumbPath('480 ', 'a.webp'), thumbs.thumbPath(480, undefined)], [null, null, null, null]);
});

test('original illisible : 404 (jamais 500), rien n\'est conservé', async () => {
  const name = `${TAG}-corrompu.webp`;
  const file = path.join(UPLOADS, name);
  fs.writeFileSync(file, 'ceci n\'est pas une image');
  made.push(file);
  const r = await get(`/uploads/thumbs/480/${name}`);
  assert.equal(r.status, 404);
  assert.equal(fs.existsSync(thumbFile(480, name)), false);
  const tmp = fs.existsSync(path.join(THUMBS, '480')) ? fs.readdirSync(path.join(THUMBS, '480')).filter(f => f.startsWith(name)) : [];
  assert.deepEqual(tmp, [], 'pas de fichier temporaire abandonné');
});

test('de bout en bout : une photo envoyée par POST /api/upload a ses miniatures immédiatement', async () => {
  const user = await s.register('miniatures');
  const png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#ef4444' } }).png().toBuffer();
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'photo.png');
  const up = await fetch(s.base + '/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + user.token }, body: fd });
  assert.equal(up.status, 200);
  const { url } = await up.json();
  const name = path.basename(url);
  made.push(path.join(UPLOADS, name), thumbFile(480, name), thumbFile(960, name));
  const original = await meta(await get(url));
  assert.equal(original.width, 1920, 'l\'envoi est réduit à 1920 px');
  assert.equal((await meta(await get(`/uploads/thumbs/480/${name}`))).width, 480);
  assert.equal((await meta(await get(`/uploads/thumbs/960/${name}`))).width, 960);
  assert.equal((await get(url)).headers.get('cache-control'), 'public, max-age=31536000, immutable', 'l\'original aussi est immuable');
});
