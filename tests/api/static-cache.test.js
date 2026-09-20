// Cache HTTP des fichiers statiques et des pages : photos et ressources versionnées immuables, pages revalidées par ETag, adresses versionnées.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const http   = require('node:http');
const crypto = require('node:crypto');
const { startServer } = require('../helpers/server');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const YEAR = 'public, max-age=31536000, immutable';
let s;
// http brut : fetch (undici) ajoute « Cache-Control: no-cache » dès qu'on lui donne If-None-Match et décompresse sans le dire
const raw = (url, headers = {}) => new Promise((ok, ko) => {
  http.get(s.base + url, { headers }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', ko);
});
const sha10 = f => crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC, f))).digest('hex').slice(0, 10);

test.before(async () => { s = await startServer(); });
test.after(async () => { await s.stop(); });

test('pages : revalidées à chaque visite (ETag, 304 si inchangées), jamais servies périmées', async () => {
  for (const url of ['/', '/vente', '/vente/appartements/oran', '/agences', '/promoteurs', '/programmes']) {
    const r = await raw(url);
    assert.equal(r.headers['cache-control'], 'no-cache', url);
    assert.ok(r.headers.etag, `ETag de ${url}`);
    const again = await raw(url, { 'If-None-Match': r.headers.etag });
    assert.equal(again.status, 304, `${url} : 304 quand la page n'a pas changé`);
    assert.equal(again.body.length, 0);
  }
});

test('pages inexistantes (404) : jamais mises en cache non plus', async () => {
  const r = await raw('/annonce/999999');
  assert.deepEqual([r.status, r.headers['cache-control']], [404, 'no-cache']);   // pas de 304 : Express ne revalide que les réponses 2xx
});

test('pages : styles et scripts appelés par une adresse versionnée (empreinte du contenu)', async () => {
  const html = (await raw('/')).body.toString('utf8');
  for (const f of ['pro.js', 'contrats.js']) {
    assert.ok(html.includes(`"/${f}?v=${sha10(f)}"`), `${f} référencé avec ?v=${sha10(f)}`);
    assert.doesNotMatch(html, new RegExp(`"/${f.replace('.', '\\.')}"`), `${f} : plus d'adresse sans version`);
  }
  // Une page dynamique (annonce inconnue, 404 indexable) est versionnée aussi
  assert.ok((await raw('/annonce/999999')).body.toString('utf8').includes(`"/pro.js?v=${sha10('pro.js')}"`));
});

test('ressources versionnées : un an, immuables ; sans version (ou version invalide) : validation par ETag', async () => {
  for (const f of ['pro.js', 'contrats.js']) {
    const v = await raw(`/${f}?v=${sha10(f)}`);
    assert.equal(v.status, 200, f);
    assert.equal(v.headers['cache-control'], YEAR, f);
    assert.match(v.headers['content-type'], f.endsWith('.css') ? /text\/css/ : /javascript/, f);
    assert.equal(v.headers['cache-control'], (await raw(`/${f}?v=nimporte-quoi`)).headers['cache-control'], 'toute empreinte bien formée compte : c\'est l\'adresse qui change');
    assert.equal((await raw(`/${f}`)).headers['cache-control'], 'no-cache', `${f} sans version`);
    for (const bad of ['<script>', 'a', 'x'.repeat(41), 'a b c d e f', '../..', '%00abcdef']) {
      assert.equal((await raw(`/${f}?v=${encodeURIComponent(bad)}`)).headers['cache-control'], 'no-cache', `${f}?v=${bad}`);
    }
  }
});

test('autres fichiers : images du site un jour, manifest à valider, service worker jamais en cache', async () => {
  assert.equal((await raw('/logo-icon.svg')).headers['cache-control'], 'public, max-age=86400');
  assert.equal((await raw('/favicon-32.png')).headers['cache-control'], 'public, max-age=86400');
  assert.equal((await raw('/manifest.json')).headers['cache-control'], 'no-cache');
  assert.match((await raw('/sw.js')).headers['cache-control'], /no-store/);
  assert.equal((await raw('/robots.txt')).status, 200);
});

test('compression : le code du site est servi compressé (gzip), très en dessous de sa taille brute', async () => {
  for (const f of ['pro.js', 'contrats.js']) {
    const r = await raw(`/${f}?v=${sha10(f)}`, { 'Accept-Encoding': 'gzip' });
    assert.equal(r.headers['content-encoding'], 'gzip', f);
    assert.ok(r.body.length < fs.statSync(path.join(PUBLIC, f)).size * 0.35, `${f} : ${r.body.length} octets compressés`);
  }
});
