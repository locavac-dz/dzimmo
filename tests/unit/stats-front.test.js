// Statistiques de l'annonceur côté front (public/app.js) : traductions FR/AR des conseils, panneau (3 séries, totaux), échappement.
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const { read } = require('../helpers/front');
const { CODES } = require('../../server/advice');

const app = read('app.js');

// Bloc de traductions d'une langue
function block(lang) {
  const a = app.indexOf(`\n  ${lang}: {`);
  assert.ok(a > 0, `bloc ${lang}`);
  const b = lang === 'fr' ? app.indexOf('\n  ar: {') : app.indexOf('\n};', a);
  return app.slice(a, b);
}
// Texte d'une clé dans une langue (chaîne entre apostrophes ou guillemets)
function text(lang, key) {
  const m = block(lang).match(new RegExp(String.raw`\b${key}:\s*(['"])((?:\\.|(?!\1).)*)\1`));
  return m ? m[2] : null;
}

// Paramètres que le serveur envoie pour chaque code (server/advice.js)
const PARAMS = { price_high: ['pct'], few_photos: ['n', 'min'], no_engagement: ['views'], views_drop: ['pct'], low_visibility: ['n'], short_description: ['n', 'min'], low_conversion: ['views', 'contacts'] };

test('chaque conseil du serveur a son texte en français et en arabe, avec ses paramètres', () => {
  for (const code of CODES) {
    for (const lang of ['fr', 'ar']) {
      const t = text(lang, 'adv_' + code);
      assert.ok(t, `${lang}.adv_${code}`);
      if (lang === 'ar') assert.match(t, /[؀-ۿ]/, `adv_${code} en arabe`);
      for (const p of PARAMS[code] || []) assert.ok(t.includes(`{${p}}`), `${lang}.adv_${code} garde {${p}}`);
    }
  }
});

test('les autres textes du panneau existent dans les deux langues', () => {
  for (const key of ['dash_stats_title', 'st_views', 'st_favs', 'st_clicks', 'st_calls', 'st_wa', 'st_contacts', 'st_conversion', 'st_favs_total', 'st_no_data', 'st_advice', 'st_advice_tip']) {
    for (const lang of ['fr', 'ar']) {
      const t = text(lang, key);
      assert.ok(t, `${lang}.${key}`);
      if (lang === 'ar') assert.match(t, /[؀-ۿ]/, `${key} en arabe`);
    }
  }
  assert.ok(text('fr', 'st_favs_total').includes('{n}') && text('ar', 'st_favs_total').includes('{n}'));
});

// Panneau exécuté avec de vraies traductions extraites de la page
function panel(stats, lang = 'fr') {
  const keys = ['dash_stats_title', 'st_views', 'st_favs', 'st_clicks', 'st_calls', 'st_wa', 'st_contacts', 'st_conversion', 'st_favs_total', 'st_no_data', 'st_advice', 'st_advice_tip',
                ...CODES.map(c => 'adv_' + c)];
  const tr = { fr: {}, ar: {} };
  for (const l of ['fr', 'ar']) for (const k of keys) tr[l][k] = text(l, k);
  const src = app.slice(app.indexOf('const STAT_COLORS'), app.indexOf('async function showPropertyStats'));
  const esc = app.slice(app.indexOf('function esc(s)'), app.indexOf('function toast('));
  const ctx = { currentLang: lang, TRANSLATIONS: tr, T: k => (tr[ctx.currentLang][k] || tr.fr[k] || k) };
  vm.createContext(ctx);
  vm.runInContext(`${esc}\n${src}\nthis.statsPanelHTML = statsPanelHTML;`, ctx);
  return ctx.statsPanelHTML(stats);
}

const days = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
const totals = { views_30d: 42, views_7d: 10, favorites_30d: 3, favorites_total: 7, calls_30d: 4, whatsapps_30d: 2, contacts_30d: 1, conversion_rate: 2.4 };
const base = { days, views: [{ day: days[29], views: 6 }, { day: days[20], views: 2 }], favorites: [{ day: days[25], n: 1 }], clicks: [{ day: days[29], channel: 'call', n: 2 }, { day: days[29], channel: 'whatsapp', n: 1 }], totals, advice: [] };

test('panneau : trois courbes (vues, favoris, clics), les totaux et la légende', () => {
  const html = panel(base);
  assert.equal((html.match(/<path /g) || []).length, 3);
  for (const c of ['#0C6E4F', '#e11d48', '#f59e0b']) assert.ok(html.includes(c), c);
  for (const label of ['Vues', 'Favoris', 'Clics', 'Appels', 'WhatsApp', 'Demandes', 'Taux de contact']) assert.ok(html.includes(label), label);
  assert.ok(html.includes('7 au total'));
  assert.ok(html.includes('>42<'), 'vues sur 30 jours');
  assert.ok(!html.includes('adv_'), 'aucune clé de traduction brute');
  // les clics des deux canaux s'additionnent sur la même journée : 3 clics le dernier jour, courbe la plus haute = 6 vues
  assert.ok(html.includes('<svg'));
});

test('panneau : sans aucune activité, un message plutôt qu\'un graphique vide ; les totaux restent affichés', () => {
  const html = panel({ days, views: [], favorites: [], clicks: [], totals: { views_30d: 0, views_7d: 0, favorites_30d: 0, favorites_total: 0, calls_30d: 0, whatsapps_30d: 0, contacts_30d: 0 }, advice: [] });
  assert.ok(!html.includes('<svg'));
  assert.ok(html.includes('Pas encore de visite'));
  assert.ok(html.includes('Vues'));
});

test('panneau en arabe : textes arabes et libellés de dates arabes', () => {
  const html = panel({ ...base, advice: [{ code: 'few_photos', level: 'warn', params: { n: 2, min: 5 } }] }, 'ar');
  assert.match(html, /المشاهدات/);
  assert.match(html, /المفضّلة/);
  assert.match(html, /نصائح/);
  assert.ok(!html.includes('{n}') && !html.includes('{min}'));
});

test('conseils : paramètres remplacés, icône selon le niveau, jamais de clé brute pour un code inconnu', () => {
  const html = panel({ ...base, advice: [
    { code: 'few_photos', level: 'warn', params: { n: 2, min: 5 } },
    { code: 'no_media', level: 'tip', params: {} },
    { code: 'all_good', level: 'good', params: {} },
    { code: 'code_inconnu', level: 'warn', params: {} },
  ] });
  assert.ok(html.includes('n\'a que 2 photo(s)'));
  assert.ok(html.includes('au moins 5'));
  assert.ok(html.includes('⚠️') && html.includes('💡') && html.includes('✅'));
  assert.ok(!html.includes('code_inconnu') && !html.includes('adv_code'));
  assert.equal((html.match(/<li /g) || []).length, 3);
});

test('échappement : ni HTML ni balise ne passe depuis les paramètres ou les jours', () => {
  const html = panel({
    ...base,
    days: [...days.slice(0, 29), '<img src=x onerror=alert(1)>'],
    totals: { ...totals, views_30d: '<script>alert(1)</script>', favorites_total: '"><b>' },
    advice: [{ code: 'few_photos', level: '<script>', params: { n: '<img src=x onerror=alert(2)>', min: '"onmouseover="x' } }],
  });
  assert.doesNotMatch(html, /<script|<img|onerror=alert|<b>/i);
  assert.ok(html.includes('n\'a que 0 photo(s)'), 'un paramètre non numérique devient 0');
});

test('le panneau se ferme au deuxième clic et n\'insère aucune donnée dans un onclick', () => {
  const fn = app.slice(app.indexOf('async function showPropertyStats'), app.indexOf('\n}\n', app.indexOf('async function showPropertyStats')));
  assert.match(fn, /existing\.remove\(\)/);
  assert.match(fn, /statsPanelHTML\(await api\('\/properties\/' \+ id \+ '\/stats'\)\)/);
  const html = panel({ ...base, advice: [{ code: 'no_phone', level: 'warn', params: {} }] });
  assert.doesNotMatch(html, /onclick=/);
});
