// Génère les icônes et images de marque servies par le site (public/) à partir des sources SVG (brand/).
//   npm run build-brand
// Les fichiers générés sont versionnés : le déploiement n'a pas d'étape de build.
const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT   = path.join(__dirname, '..');
const BRAND  = path.join(ROOT, 'brand');
const PUBLIC = path.join(ROOT, 'public');

const src = name => fs.readFileSync(path.join(BRAND, name));
const out = name => path.join(PUBLIC, name);

async function png(svg, size, file, extra = {}) {
  const [w, h] = Array.isArray(size) ? size : [size, size];
  // density élevée : les SVG (64 px de base) sont rastérisés nets à toutes les tailles
  await sharp(svg, { density: Math.max(72, Math.round(72 * Math.max(w, h) / 64)) })
    .resize(w, h).png().toFile(out(file));
  console.log('✔', file, `${w}×${h}`, extra.note || '');
}

(async () => {
  // Copies SVG servies telles quelles (favicon, en-tête, pied de page, téléchargement du logo)
  fs.copyFileSync(path.join(BRAND, 'icon.svg'), out('favicon.svg'));
  fs.copyFileSync(path.join(BRAND, 'icon.svg'), out('logo-icon.svg'));
  fs.copyFileSync(path.join(BRAND, 'icon-light.svg'), out('logo-icon-light.svg'));
  fs.mkdirSync(out('brand'), { recursive: true });
  for (const f of ['logo-light.svg', 'logo-dark.svg']) fs.copyFileSync(path.join(BRAND, f), out(path.join('brand', f)));
  console.log('✔ favicon.svg, logo-icon.svg, logo-icon-light.svg, brand/logo-*.svg');

  await png(src('icon.svg'), 32, 'favicon-32.png');
  await png(src('icon.svg'), 192, 'icon-192.png');
  await png(src('icon.svg'), 512, 'icon-512.png');
  await png(src('icon-maskable.svg'), 512, 'icon-maskable-512.png', { note: '(zone de sécurité Android)' });
  await png(src('icon-maskable.svg'), 180, 'apple-touch-icon.png', { note: '(carré plein, iOS arrondit lui-même)' });
  await png(src('og.svg'), [1200, 630], 'og-default.png', { note: '(aperçu de partage)' });
})().catch(e => { console.error('Erreur :', e.message); process.exit(1); });
