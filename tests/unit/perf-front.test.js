// Vitesse des pages côté navigateur : miniatures (srcset), chargement différé de Leaflet, code hors de la page.
// Le code testé est celui de public/app.js et de public/pro.js, extrait et exécuté tel quel (aucun navigateur nécessaire).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');
const { readFront } = require('../helpers/front');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const html = readFront();
const page = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const pro  = fs.readFileSync(path.join(PUBLIC, 'pro.js'), 'utf8');
const fn = name => html.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

const ctx = {};
vm.createContext(ctx);
vm.runInContext([fn('esc'), html.match(/const UPLOAD_IMG = [^\n]*/)[0], fn('thumbUrl'), fn('imgAttrs')].join('\n'), ctx);

test('thumbUrl : les photos du site deviennent des miniatures ; toute autre adresse est laissée telle quelle', () => {
  assert.equal(ctx.thumbUrl('/uploads/1700-abc.webp'), '/uploads/thumbs/480/1700-abc.webp');
  assert.equal(ctx.thumbUrl('/uploads/1700-abc.webp', 960), '/uploads/thumbs/960/1700-abc.webp');
  assert.equal(ctx.thumbUrl('/UPLOADS/A.WEBP'), '/uploads/thumbs/480/A.WEBP', 'casse tolérée comme côté serveur');
  for (const other of ['https://images.unsplash.com/photo-1?w=800', 'https://evil.example/a.webp', '/uploads/thumbs/480/a.webp', '/uploads/a.jpg', '/uploads/../x.webp', '/uploads/a/b.webp', 'uploads/a.webp', '', null, undefined])
    assert.equal(ctx.thumbUrl(other), other, String(other));
});

test('imgAttrs : src + srcset + sizes pour une photo du site (l\'original 1920 px reste la plus grande variante), src seul sinon', () => {
  const a = ctx.imgAttrs('/uploads/x.webp', '(max-width: 640px) 100vw, 320px');
  assert.match(a, /^src="\/uploads\/thumbs\/960\/x\.webp" /, 'src de repli : la plus grande miniature');
  assert.match(a, /srcset="\/uploads\/thumbs\/480\/x\.webp 480w, \/uploads\/thumbs\/960\/x\.webp 960w, \/uploads\/x\.webp 1920w"/);
  assert.match(a, /sizes="\(max-width: 640px\) 100vw, 320px"/);
  assert.match(a, /decoding="async"/);
  const hero = ctx.imgAttrs('/uploads/x.webp', '800px', [960]);
  assert.match(hero, /srcset="\/uploads\/thumbs\/960\/x\.webp 960w, \/uploads\/x\.webp 1920w"/);
  assert.equal(ctx.imgAttrs('https://images.unsplash.com/p?w=800&q=80', '320px'), 'src="https://images.unsplash.com/p?w=800&amp;q=80"', 'adresse externe : un src, échappé');
  assert.equal(ctx.imgAttrs('', '320px'), 'src=""');
  assert.equal(ctx.imgAttrs(undefined, '320px'), 'src=""');
});

test('imgAttrs : jamais d\'attribut injecté, quelle que soit la valeur', () => {
  for (const hostile of ['" onerror="alert(1)', '"><script>1</script>', '/uploads/x.webp" onerror="1', "x' onerror='1", 'javascript:alert(1)']) {
    const out = ctx.imgAttrs(hostile, '"><b>');
    const attrs = [...out.matchAll(/\s?([\w-]+)="[^"]*"/g)].map(m => m[1]);
    assert.deepEqual(attrs.filter(x => !['src', 'srcset', 'sizes', 'decoding'].includes(x)), [], hostile);
    assert.doesNotMatch(out, /<script|<b>/);
  }
});

test('cartes et fiche : les photos passent par imgAttrs / thumbUrl ; en cas d\'échec de chargement, srcset est retiré avant le repli', () => {
  assert.match(html, /<img class="card-img" \$\{imgAttrs\(/);
  assert.match(html, /onerror="this\.removeAttribute\('srcset'\);this\.src='https:\/\/images\.unsplash\.com/g, 'repli : sans srcset, sinon le src de repli est ignoré');
  assert.match(html, /<img \$\{imgAttrs\(photos\[0\] \|\| '', '[^']*', \[960\]\)\}/, 'photo principale de la fiche');
  // Aucune photo de l'annonce n'est plus insérée en pleine taille dans une vignette
  assert.doesNotMatch(html, /src="\$\{esc\((?:p\.image|photos\[[12]\]|u|src|d\.property_image|c\.property_img|img)(?: \|\| ''|\|\|'')?\)\}"/);
  assert.match(pro, /imgAttrs\(a\.cover,/);
  assert.match(pro, /thumbUrl\(a\.logo, 480\)/);
});

test('visionneuse : bande de vignettes en miniatures, image affichée en 960 px sur petit écran', () => {
  const body = fn('lbRender');
  assert.match(body, /thumbUrl\(src, 480\)/);
  assert.match(body, /window\.innerWidth <= 900 \? thumbUrl\(big, 960\) : big/);
});

test('Leaflet : plus dans la page, chargé à la première ouverture de la carte (échec réseau : nouvel essai possible)', () => {
  assert.doesNotMatch(page, /leaflet|cdnjs/i);
  assert.match(html, /async function initMap\(\)/);
  assert.match(fn('initMap'), /await loadLeaflet\(\)/);
  const load = fn('loadLeaflet');
  assert.match(load, /leaflet\/1\.9\.4\/leaflet\.min\.js'\)\.then\(\(\) => js\('leaflet\.markercluster/, 'le plugin attend Leaflet');
  assert.match(load, /catch\(e => \{ _leafletLoading = null; throw e; \}\)/);
  assert.match(load, /if \(window\.L && window\.L\.markerClusterGroup\) return Promise\.resolve\(\)/, 'déjà chargé : rien à faire');
});

test('Leaflet : chargement mémorisé (une seule série de balises), nouvel essai après un échec', async () => {
  const added = [];
  const doc = { head: { appendChild: el => added.push(el) }, createElement: tag => ({ tag }) };
  const sandbox = { window: {}, document: doc, Promise };
  vm.createContext(sandbox);
  vm.runInContext(fn('loadLeaflet').replace('function loadLeaflet', 'var _leafletLoading = null; function loadLeaflet'), sandbox);
  const p1 = sandbox.loadLeaflet(), p2 = sandbox.loadLeaflet();
  assert.equal(p1, p2, 'deux ouvertures pendant le chargement : la même promesse');
  assert.deepEqual(added.map(e => e.tag), ['link', 'link', 'link', 'script'], 'feuilles de style et Leaflet ; le plugin vient après');
  added.filter(e => e.tag === 'link').forEach(e => e.onload());
  added.find(e => e.tag === 'script').onload();
  await new Promise(r => setImmediate(r));
  assert.equal(added.at(-1).src, 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js');
  added.at(-1).onload();   // le plugin est chargé à son tour : la promesse peut se résoudre
  sandbox.window.L = { markerClusterGroup() {} };
  await p1;
  assert.equal(await sandbox.loadLeaflet(), undefined, 'chargé : résolu aussitôt, sans nouvelle balise');
  assert.equal(added.length, 5);
  // Échec : la promesse mémorisée est oubliée
  const bad = { window: {}, document: { head: { appendChild: el => setImmediate(() => el.onerror(new Error('hors ligne'))) }, createElement: tag => ({ tag }) }, Promise };
  vm.createContext(bad);
  vm.runInContext(fn('loadLeaflet').replace('function loadLeaflet', 'var _leafletLoading = null; function loadLeaflet'), bad);
  await assert.rejects(bad.loadLeaflet(), /hors ligne/);
  assert.notEqual(bad.loadLeaflet(), null, 'nouvel essai possible');
  bad.loadLeaflet().catch(() => {});
});

test('code hors de la page : index.html ne contient ni CSS ni JS en ligne, app.css / app.js / pro.js / contrats.js sont référencés dans l\'ordre', () => {
  assert.doesNotMatch(page, /<style>|<script>/);
  assert.match(page, /<link rel="stylesheet" href="\/app\.css">/);
  const order = [...page.matchAll(/<script src="\/([\w.]+)"><\/script>/g)].map(m => m[1]);
  assert.deepEqual(order, ['pro.js', 'app.js', 'contrats.js'], 'pro.js avant app.js (liens directs), contrats.js après');
  for (const f of ['app.js', 'app.css', 'pro.js', 'contrats.js']) assert.ok(fs.existsSync(path.join(PUBLIC, f)), f);
  assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8')), 'app.js : JavaScript valide');
});

test('démarrage : la page d\'accueil n\'est chargée qu\'une fois (applyLang ne recharge pas la page au premier appel)', () => {
  const app = fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
  assert.match(app, /function applyLang\(lang, reload = true\)/);
  assert.match(app, /^applyLang\(currentLang, false\);\ninit\(\);$/m, 'démarrage : applyLang sans rechargement, puis init()');
  const body = fn('applyLang');
  assert.match(body, /if \(!reload\) \{ \/\* démarrage \*\/ \}\n\s+else if \(currentPage === 'home'\)/);
  // Le changement de langue par l'utilisateur (boutons FR / ع) recharge, lui, la page en cours : reload vaut true par défaut
  assert.equal((page.match(/onclick="applyLang\('(?:fr|ar)'\)"/g) || []).length, 4, 'boutons de langue : appel sans second argument');
});
