// Identité visuelle : les fichiers référencés existent, avec les bonnes dimensions.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const sharp  = require('sharp');

const ROOT   = path.join(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const read   = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

test('les icônes du manifest existent avec la taille annoncée', async () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.icons.length >= 3);
  assert.ok(manifest.icons.some(i => i.purpose === 'maskable'), 'une icône « maskable » est attendue (Android)');
  for (const icon of manifest.icons) {
    const file = path.join(PUBLIC, icon.src);
    assert.ok(fs.existsSync(file), `${icon.src} introuvable`);
    const [w, h] = icon.sizes.split('x').map(Number);
    const meta = await sharp(file).metadata();
    assert.deepEqual([meta.width, meta.height], [w, h], `${icon.src} : dimensions`);
  }
});

test('les <link rel="icon"> des pages pointent vers des fichiers existants', () => {
  for (const page of ['index.html', '404.html']) {
    const html = read(page);
    const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g)].map(m => m[1]);
    assert.ok(hrefs.length >= 3, `${page} : favicon SVG, PNG 32 et apple-touch-icon attendus`);
    for (const href of hrefs) assert.ok(fs.existsSync(path.join(PUBLIC, href)), `${page} → ${href} introuvable`);
  }
});

test('le logo de l\'en-tête et du pied de page existe', () => {
  const html = read('index.html');
  for (const src of [...html.matchAll(/<img[^>]+src="(\/logo-[^"]+)"/g)].map(m => m[1]))
    assert.ok(fs.existsSync(path.join(PUBLIC, src)), src);
  assert.match(html, /class="logo-mark" src="\/logo-icon\.svg"/);
});

test('image de partage par défaut : 1200 × 630 px', async () => {
  const meta = await sharp(path.join(PUBLIC, 'og-default.png')).metadata();
  assert.deepEqual([meta.width, meta.height], [1200, 630]);
});

test('apple-touch-icon : 180 × 180 px, sans transparence (iOS)', async () => {
  const meta = await sharp(path.join(PUBLIC, 'apple-touch-icon.png')).metadata();
  assert.deepEqual([meta.width, meta.height], [180, 180]);
  const { channels } = await sharp(path.join(PUBLIC, 'apple-touch-icon.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true }).then(r => r.info);
  assert.equal(channels, 3);
});

test('les sources de la marque et les fichiers générés sont cohérents', () => {
  for (const f of ['icon.svg', 'icon-light.svg', 'icon-maskable.svg', 'logo-light.svg', 'logo-dark.svg', 'og.svg'])
    assert.ok(fs.existsSync(path.join(ROOT, 'brand', f)), `brand/${f} manquant`);
  // les copies SVG servies doivent être identiques à leur source (relancer `npm run build-brand` sinon)
  assert.equal(read('favicon.svg'), fs.readFileSync(path.join(ROOT, 'brand', 'icon.svg'), 'utf8'));
  assert.equal(read('logo-icon-light.svg'), fs.readFileSync(path.join(ROOT, 'brand', 'icon-light.svg'), 'utf8'));
});
