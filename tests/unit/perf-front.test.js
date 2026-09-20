// Vitesse des pages côté navigateur : miniatures (srcset), chargement différé de Leaflet, code hors de la page.
// Le code testé est celui de public/index.html et de public/pro.js, extrait et exécuté tel quel (aucun navigateur nécessaire).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
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
