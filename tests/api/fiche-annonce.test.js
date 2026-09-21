// Fiche imprimable d'une annonce (/annonce/<slug>/fiche) : page A4 avec QR code, en français et en arabe, jamais indexée,
// sans donnée privée, sans <style> ni <script> en ligne, 404 pour une annonce non publique, redirection canonique.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, owner, agencyId, id;
const BASE = 'https://dzimmo.test';   // APP_URL défini par le helper
const q = (sql, params) => s.db.pool.query(sql, params);
const ARABIC = /[؀-ۿ]/;

test.before(async () => {
  s = await startServer();
  owner = await s.register('proprio');
  await q('UPDATE users SET phone = $2 WHERE id = $1', [owner.id, '0770 11 22 33']);
  agencyId = (await q(`INSERT INTO agencies (owner_id, name, kind, wilaya, phone) VALUES ($1, 'Agence <Soleil>', 'agence', 'Oran', '0555 44 33 22') RETURNING id`, [owner.id])).rows[0].id;
  id = (await q(
    `INSERT INTO properties (owner_id, title, description, mode, type_bien, price, surface_m2, rooms, baths, floor, total_floors,
                             wilaya, commune, address, image, photos, features, status)
     VALUES ($1, 'Villa <b>vue mer</b> à Oran', 'Belle villa lumineuse avec jardin & garage.', 'vente', 'villa', 48000000, 250, 6, 3, 0, 2,
             'Oran', 'Bir El Djir', 'Rue des Oliviers', '/uploads/fiche-1.webp',
             '["/uploads/fiche-1.webp","/uploads/fiche-2.jpg","javascript:alert(1)","https://evil.example/x.png"]',
             '["parking","piscine","inconnu"]', 'active') RETURNING id`, [owner.id])).rows[0].id;
});
test.after(async () => { await s.stop(); });

const path = () => `/annonce/${id}-villa-b-vue-mer-b-a-oran`;

test('fiche en français : contenu, prix, caractéristiques, équipements, contact, QR SVG, pas de donnée privée', async () => {
  const r = await s.request('GET', path() + '/fiche');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.text, /<html lang="fr" dir="ltr">/);
  assert.match(r.headers.get('content-language'), /fr/);
  assert.match(r.text, /Villa &lt;b&gt;vue mer&lt;\/b&gt; à Oran/, 'titre échappé');
  assert.doesNotMatch(r.text, /<b>vue mer<\/b>/);
  assert.match(r.text, /Villa à vendre/);
  assert.match(r.text, /48\D000\D000 DZD/);
  assert.match(r.text, /Bir El Djir, Oran/);
  assert.match(r.text, /Rue des Oliviers/);
  assert.match(r.text, /250 m²/);
  assert.match(r.text, /6 pièces/);
  assert.match(r.text, /3 salles de bain/);
  assert.match(r.text, /Rez-de-chaussée/, 'étage 0 gardé');
  assert.match(r.text, /Parking/); assert.match(r.text, /Piscine/);
  assert.doesNotMatch(r.text, /inconnu/, 'clé d\'équipement inconnue ignorée');
  assert.match(r.text, /jardin &amp; garage/);
  assert.match(r.text, new RegExp(`Réf\\. ${id}\\b`));
  assert.match(r.text, /<svg[\s\S]*<\/svg>/, 'QR code en SVG');
  assert.match(r.text, new RegExp(`dir="ltr">${BASE}${path()}</p>`), 'adresse de l\'annonce en clair sous le QR');
  assert.match(r.text, /href="\/annonce\/\d+-[^"]+"/, 'lien de retour');
  assert.match(r.text, /<link rel="stylesheet" href="\/fiche\.css">/);
  assert.match(r.text, /<script src="\/fiche\.js" defer><\/script>/);
  // Les données privées du compte n'y figurent pas
  assert.doesNotMatch(r.text, new RegExp(owner.email.replace(/[.+]/g, '\\$&')));
});

test('contact : le téléphone de l\'agence prime, son nom est échappé', async () => {
  const sans = await s.request('GET', path() + '/fiche');
  assert.match(sans.text, /Annonceur : Test proprio/);
  assert.match(sans.text, /0770 11 22 33/);
  await q('UPDATE properties SET agency_id = $2 WHERE id = $1', [id, agencyId]);
  const r = await s.request('GET', path() + '/fiche');
  assert.match(r.text, /Agence : Agence &lt;Soleil&gt;/);
  assert.match(r.text, /0555 44 33 22/);
  assert.doesNotMatch(r.text, /0770 11 22 33/);
  assert.doesNotMatch(r.text, /<Soleil>/);
  await q('UPDATE properties SET agency_id = NULL WHERE id = $1', [id]);
  await q('UPDATE users SET phone = NULL WHERE id = $1', [owner.id]);
  const nophone = await s.request('GET', path() + '/fiche');
  assert.match(nophone.text, /Contactez l’annonceur depuis l’annonce en ligne/);
  await q('UPDATE users SET phone = $2 WHERE id = $1', [owner.id, '0770 11 22 33']);
});

test('photos : miniature de 960 px pour un fichier .webp du site, autres fichiers du site tels quels, adresses refusées écartées', async () => {
  const r = await s.request('GET', path() + '/fiche');
  assert.match(r.text, /<img src="\/uploads\/thumbs\/960\/fiche-1\.webp"/);
  assert.match(r.text, /<img src="\/uploads\/fiche-2\.jpg"/);
  assert.doesNotMatch(r.text, /javascript:/);
  assert.doesNotMatch(r.text, /evil\.example/);
  assert.equal((r.text.match(/<img /g) || []).length, 2, 'la photo principale n\'est pas répétée');
});

test('jamais indexée, aucun style ni script en ligne, pas de Referer', async () => {
  const r = await s.request('GET', path() + '/fiche');
  assert.match(r.text, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.match(r.text, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(r.text, /<style/i);
  assert.doesNotMatch(r.text, /<script(?![^>]*\ssrc=)/i, 'seul un script externe');
  assert.doesNotMatch(r.text, /\son[a-z]+=/i, 'aucun gestionnaire en ligne');
  const sitemap = await s.request('GET', '/sitemap-pages.xml');
  assert.doesNotMatch(sitemap.text, /\/fiche/, 'absente du sitemap');
});

test('fiche en arabe : /ar/…/fiche, langue et direction, textes arabes, lien de retour et QR vers la version arabe', async () => {
  const r = await s.request('GET', '/ar' + path() + '/fiche');
  assert.equal(r.status, 200);
  assert.match(r.text, /<html lang="ar" dir="rtl">/);
  assert.match(r.headers.get('content-language'), /ar/);
  assert.match(r.text, /بطاقة العقار/);
  assert.match(r.text, /امسح الرمز/);
  assert.match(r.text, /48\D000\D000 دج/);
  assert.match(r.text, /حمّامات/);
  assert.match(r.text, /الطابق الأرضي/);
  assert.match(r.text, ARABIC);
  assert.match(r.text, new RegExp(`dir="ltr">${BASE}/ar${path()}</p>`));
  assert.match(r.text, /href="\/ar\/annonce\/\d+-/);
});

test('mauvais slug : redirection 301 vers l\'adresse canonique, dans la même langue', async () => {
  const fr = await s.request('GET', `/annonce/${id}-n-importe-quoi/fiche`);
  assert.equal(fr.status, 301);
  assert.equal(fr.headers.get('location'), path() + '/fiche');
  const ar = await s.request('GET', `/ar/annonce/${id}/fiche`);
  assert.equal(ar.status, 301);
  assert.equal(ar.headers.get('location'), '/ar' + path() + '/fiche');
});

test('annonce introuvable ou non publique : vraie 404, noindex ; annonce vendue : fiche avec pastille', async () => {
  assert.equal((await s.request('GET', '/annonce/999999/fiche')).status, 404);
  assert.equal((await s.request('GET', '/annonce/abc/fiche')).status, 404);
  assert.equal((await s.request('GET', '/ar/annonce/999999/fiche')).status, 404);
  for (const status of ['pending', 'rejected', 'archived']) {
    await q('UPDATE properties SET status = $2 WHERE id = $1', [id, status]);
    const r = await s.request('GET', path() + '/fiche');
    assert.equal(r.status, 404, status);
    assert.match(r.text, /noindex/);
    assert.doesNotMatch(r.text, /Rue des Oliviers/, 'rien de l\'annonce ne fuit');
  }
  await q(`UPDATE properties SET status = 'sold' WHERE id = $1`, [id]);
  const sold = await s.request('GET', path() + '/fiche');
  assert.equal(sold.status, 200);
  assert.match(sold.text, /class="status">Vendu</);
  await q(`UPDATE properties SET status = 'active' WHERE id = $1`, [id]);
});

test('champs facultatifs absents : la fiche reste valide (pas de « null », pas de section vide)', async () => {
  const bare = (await q(
    `INSERT INTO properties (owner_id, title, mode, type_bien, price, wilaya, status)
     VALUES ($1, 'Terrain nu', 'vente', 'terrain', 9000000, 'Blida', 'active') RETURNING id`, [owner.id])).rows[0].id;
  const r = await s.request('GET', `/annonce/${bare}-terrain-nu/fiche`);
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.text, /null|undefined|NaN/);
  assert.doesNotMatch(r.text, /class="facts"|class="photos|<h2>Description|<h2>Équipements/);
  assert.match(r.text, /<svg/);
});

test('la fiche publique porte le lien « Imprimer la fiche »', async () => {
  const app = require('../helpers/front').read('app.js');
  assert.match(app, /href="\$\{esc\(annonceUrl\(p\.id, p\.title\)\)\}\/fiche" target="_blank" rel="noopener"/);
});
