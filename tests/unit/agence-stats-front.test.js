// Statistiques d'agence : clés i18n présentes, câblage dans dashVitrine et agenceStatsHTML.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');

const app = read('app.js');
const pro = read('pro.js');
const ARABIC = /[؀-ۿ]/;

test('i18n : vt_stats_title, vt_stats_listings, vt_stats_top existent en français et en arabe', () => {
  for (const key of ['vt_stats_title', 'vt_stats_listings', 'vt_stats_top']) {
    const matches = [...app.matchAll(new RegExp(`\\b${key}:\\s*'((?:\\\\.|[^'\\\\])*)'`, 'g'))].map(m => m[1]);
    assert.equal(matches.length, 2, `${key} doit être défini deux fois (FR et AR)`);
    assert.match(matches[1], ARABIC, `${key} en arabe doit contenir des caractères arabes`);
  }
});

test('agenceStatsHTML : définie dans pro.js, référencée dans vtRender et dashVitrine', () => {
  assert.match(pro, /function agenceStatsHTML\(stats\)/, 'agenceStatsHTML définie');
  assert.match(pro, /agenceStatsHTML\(agStats\)/, 'appelée dans vtRender');
  assert.match(pro, /\/agencies\/me\/stats/, 'appel API présent dans dashVitrine');
});

test('agenceStatsHTML utilise esc() pour toutes les données utilisateur', () => {
  // La section qui construit le topHTML avec le titre de l'annonce doit passer par esc()
  const top = pro.match(/topItems\.map\(p => `[\s\S]*?`\)/);
  assert.ok(top, 'section top trouvée');
  assert.match(top[0], /esc\(p\.title\)/, 'titre de l\'annonce échappé');
});

test('onclick dans agenceStatsHTML : seul Number(p.id) est interpolé', () => {
  const handlers = [...pro.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
  const allowed = /^(Number\([\w.]+\)|[a-z]\.(?:id|agency_id|property_id)|i|v|k|which|id|r\.page \+ 1|_\w+\.\w+ \+ 1)$/;
  for (const h of handlers) for (const m of h.matchAll(/\$\{([^}]*)\}/g))
    assert.match(m[1], allowed, `interpolation inattendue dans onclick : ${m[1]}\n${h}`);
});

test('vtRender accepte agStats en second paramètre', () => {
  assert.match(pro, /function vtRender\(c\s*=\s*document\.getElementById\('dash-tab-content'\),\s*agStats\s*=\s*null\)/);
});
