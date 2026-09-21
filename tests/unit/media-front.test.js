// Vidéo et visite virtuelle côté front (public/app.js + index.html) : textes FR/AR, façade au clic, iframe isolé, aucune donnée dans un onclick.
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const { read, readFront } = require('../helpers/front');

const app  = read('app.js');
const html = readFront();
const css  = read('app.css');

const start = app.indexOf('const MEDIA_NAMES');
const end   = app.indexOf('// ── Détail annonce');
const media = app.slice(start, end);

function block(lang) {
  const a = app.indexOf(`\n  ${lang}: {`);
  assert.ok(a > 0, `bloc ${lang}`);
  const b = lang === 'fr' ? app.indexOf('\n  ar: {') : app.indexOf('\n};', a);
  return app.slice(a, b);
}

const KEYS = ['pub_media', 'pub_video', 'pub_tour', 'pub_video_ph', 'pub_tour_ph', 'pub_media_hint', 'media_video', 'media_tour', 'media_load_video',
              'media_load_tour', 'media_privacy', 'media_open', 'media_badge_video', 'media_badge_tour'];

test('vidéo : chaque texte existe en français et en arabe (l\'arabe contient de l\'arabe, les trous {p} sont conservés)', () => {
  for (const lang of ['fr', 'ar']) {
    const src = block(lang);
    for (const k of KEYS) {
      const m = src.match(new RegExp(String.raw`\b${k}:\s*(['"])((?:\.|(?!\1).)*)\1`));
      assert.ok(m, `${lang}.${k}`);
      if (lang === 'ar' && !k.endsWith('_ph')) assert.match(m[2], /[؀-ۿ]/, `${k} en arabe`);
      if (k === 'media_privacy' || k === 'media_open') assert.match(m[2], /\{p\}/, `${lang}.${k}`);
    }
  }
});

test('formulaire : les deux champs existent, sont traduits et envoyés avec l\'annonce', () => {
  for (const [id, key, ph] of [['pub-video', 'pub_video', 'pub_video_ph'], ['pub-tour', 'pub_tour', 'pub_tour_ph']]) {
    assert.match(html, new RegExp(`id="${id}" type="url"[^>]*data-i18n="${ph}"`), id);
    assert.ok(html.includes(`data-i18n="${key}"`), key);
  }
  assert.match(app, /video_url:\s+val\('pub-video'\)\.trim\(\) \|\| null/);
  assert.match(app, /tour_url:\s+val\('pub-tour'\)\.trim\(\) \|\| null/);
});

test('fiche : rien ne se charge avant le clic, aucune donnée dans un onclick, tout ce qui vient du serveur est échappé', () => {
  const clicks = [...media.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(clicks, ['loadMedia(this)']);
  assert.doesNotMatch(media.slice(0, media.indexOf('function loadMedia')), /<iframe|<img|<script/i, 'la façade n\'ouvre aucun cadre ni image d\'un tiers');
  const tpl = media.slice(media.indexOf('function mediaHTML'), media.indexOf('function loadMedia'));
  for (const m of tpl.matchAll(/\$\{([^}]*)\}/g)) {
    const expr = m[1];
    if (/^(esc\(|kind === 'tour' \? '🧭' : '🎬'$|kind$|T\('media_(load_)?' \+ kind\)$)/.test(expr)) continue;
    assert.fail(`valeur non échappée dans la fiche : \${${expr}}`);
  }
  assert.match(tpl, /target="_blank" rel="noopener noreferrer"/);
});

test('lecteur : iframe isolé (sandbox), sans autre origine que l\'adresse reconstruite par le serveur, et https seulement', () => {
  const load = media.slice(media.indexOf('function loadMedia'));
  assert.match(load, /if \(!m \|\| !isHttps\(m\.embed\)\) return/);
  assert.match(load, /f\.src = m\.embed/);
  assert.match(load, /setAttribute\('sandbox', '[^']*allow-scripts[^']*'\)/);
  assert.doesNotMatch(load, /allow-top-navigation|allow-forms|allow-modals/);
  assert.match(load, /referrerPolicy/);
  assert.doesNotMatch(load, /innerHTML/);
});

test('lecteur exécuté : la façade est remplacée par un iframe isolé ; une adresse qui n\'est pas en https est ignorée', () => {
  const made = [];
  const iframe = { setAttribute(k, v) { this[k] = v; }, replaced: false };
  const ctx = {
    T: k => k, esc: s => String(s),
    window: { _detailMedia: { video: { provider: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embed: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0' },
                              tour: { provider: 'kuula', url: 'x', embed: 'http://kuula.co/share/abcde' } } },
    document: { createElement: tag => { assert.equal(tag, 'iframe'); made.push(iframe); return iframe; } },
  };
  vm.createContext(ctx);
  vm.runInContext(media + '\nthis.loadMedia = loadMedia; this.mediaHTML = mediaHTML;', ctx);

  const btn = { dataset: { kind: 'video' }, replaceWith(el) { this.done = el; } };
  ctx.loadMedia(btn);
  assert.equal(btn.done, iframe);
  assert.equal(iframe.src, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
  assert.match(iframe.sandbox, /allow-scripts/);

  const bad = { dataset: { kind: 'tour' }, replaceWith() { assert.fail('ne doit pas remplacer'); } };
  ctx.loadMedia(bad);                                                   // http : ignoré
  ctx.loadMedia({ dataset: { kind: 'inconnu' }, replaceWith() { assert.fail('ne doit pas remplacer'); } });
  assert.equal(made.length, 1);

  // mediaHTML : rien pour une annonce sans vidéo, un fournisseur inconnu ou une adresse http
  assert.equal(ctx.mediaHTML({}).trim(), '');
  assert.equal(ctx.mediaHTML({ video: { provider: 'evil', url: 'https://x.y', embed: 'https://x.y' } }).trim(), '');
  assert.equal(ctx.mediaHTML({ tour: { provider: 'kuula', url: 'https://kuula.co/share/abcde', embed: 'http://kuula.co/share/abcde' } }).trim(), '');
  const out = ctx.mediaHTML({ video: { provider: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embed: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' } });
  assert.match(out, /data-kind="video" onclick="loadMedia\(this\)"/);
  assert.match(out, /href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
});

test('carte d\'annonce : pastille vidéo / visite ; fiche : la section est insérée après la description', () => {
  assert.match(app, /p\.video_url \|\| p\.tour_url \? '<span class="media-badge">'/);
  assert.match(app, /\$\{esc\(p\.description \|\| T\('det_no_desc'\)\)\}<\/div>\n\s+\$\{mediaHTML\(p\)\}/);
  assert.match(app, /window\._detailMedia = \{ video: p\.video \|\| null, tour: p\.tour \|\| null \}/);
  assert.match(css, /\.media-badge\s*\{/);
  assert.match(css, /\.media-facade, \.media-frame\s*\{/);
});
