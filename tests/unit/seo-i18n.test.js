// SEO bilingue : les textes rendus par le serveur (server/seo-text.js) suivent ceux du site (TRANSLATIONS de public/app.js),
// et le front garde l'adresse et la langue d'accord (préfixe /ar).
const test   = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const path   = require('node:path');
const { read } = require('../helpers/front');

const { TEXT } = require(path.join('..', '..', 'server', 'seo-text'));
const app = read('app.js');

// Bloc de traductions d'une langue (jusqu'à la langue suivante ou la fin de l'objet)
function block(lang) {
  const start = app.indexOf(`\n  ${lang}: {`);
  assert.ok(start > 0, `bloc ${lang}`);
  const next = lang === 'fr' ? app.indexOf('\n  ar: {') : app.indexOf('\n};', start);
  return app.slice(start, next);
}
const value = (src, key) => {
  const m = src.match(new RegExp(String.raw`\b${key}:\s*(['"])((?:\\.|(?!\1).)*)\1`));
  assert.ok(m, `clé ${key}`);
  return m[2].replace(/\\(['"\\])/g, '$1');
};

for (const lang of ['fr', 'ar']) {
  test(`libellés serveur (${lang}) identiques à ceux du site : types, modes, « dans », « tous »`, () => {
    const src = block(lang), t = TEXT[lang];
    for (const type of Object.keys(t.typePlural)) assert.equal(t.typePlural[type], value(src, 'seo_t_' + type), type);
    for (const mode of Object.keys(t.mode)) assert.equal(t.mode[mode], value(src, 'seo_m_' + mode), mode);
    assert.equal(t.in, value(src, 'seo_in'));
    assert.equal(t.all, value(src, 'seo_t_all'));
  });
}

test('les deux langues du serveur définissent exactement les mêmes textes', () => {
  assert.deepEqual(Object.keys(TEXT.fr).sort(), Object.keys(TEXT.ar).sort());
  for (const k of ['type', 'typePlural', 'mode', 'directories', 'directoryCrumb', 'projectStatus'])
    assert.deepEqual(Object.keys(TEXT.fr[k]).sort(), Object.keys(TEXT.ar[k]).sort(), k);
  assert.equal(TEXT.ar.dir, 'rtl');
  assert.equal(TEXT.fr.dir, 'ltr');
  for (const v of Object.values(TEXT.ar.directories).flat()) assert.match(v, /[؀-ۿ]/);
});

test('prix : DZD en français, دج en arabe, /mois hors vente', () => {
  assert.match(TEXT.fr.price(1500000, 'vente'), /^1\s?500\s?000 DZD$/);
  assert.match(TEXT.fr.price(80000, 'location_longue'), /DZD\/mois$/);
  assert.match(TEXT.ar.price(80000, 'location_longue'), /دج\/شهر$/);
  assert.doesNotMatch(TEXT.ar.price(1500000, 'vente'), /شهر/);
});

// Les fonctions d'adresse du front, exécutées avec une fausse « location »
function frontWith(pathname, stored) {
  const src = app.slice(app.indexOf('const AR_PATH'), app.indexOf('const TRANSLATIONS'));
  const replaced = [];
  const sandbox = {
    location: { pathname, search: '?page=2', hash: '' },
    localStorage: { getItem: () => stored || null },
    history: { replaceState: (a, b, url) => replaced.push(url) },
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.api = { routePath, langPath, syncLangUrl, lang: () => currentLang, setLang: l => { currentLang = l; } };', sandbox);
  return { ...sandbox.api, replaced, sandbox };
}

test('front : l\'adresse /ar impose l\'arabe, sinon la langue mémorisée', () => {
  assert.equal(frontWith('/ar/vente/oran').lang(), 'ar');
  assert.equal(frontWith('/ar').lang(), 'ar');
  assert.equal(frontWith('/vente/oran', 'ar').lang(), 'ar');
  assert.equal(frontWith('/vente/oran', 'fr').lang(), 'fr');
  assert.equal(frontWith('/arabe').lang(), 'fr', '« /arabe » n\'est pas la version arabe');
});

test('front : routePath retire le préfixe, langPath l\'ajoute selon la langue affichée', () => {
  const ar = frontWith('/ar/annonce/12-villa');
  assert.equal(ar.routePath(), '/annonce/12-villa');
  assert.equal(ar.langPath('/agences'), '/ar/agences');
  assert.equal(ar.langPath('/'), '/ar');
  assert.equal(frontWith('/ar').routePath(), '/');
  const fr = frontWith('/annonce/12-villa');
  assert.equal(fr.routePath(), '/annonce/12-villa');
  assert.equal(fr.langPath('/agences'), '/agences');
  assert.equal(fr.langPath('/'), '/');
});

test('front : syncLangUrl réécrit l\'adresse sans toucher aux pages de la newsletter ni à la recherche', () => {
  const f = frontWith('/vente/oran', 'ar');
  f.syncLangUrl();
  assert.deepEqual(f.replaced, ['/ar/vente/oran?page=2']);
  const back = frontWith('/ar/vente/oran', 'fr');
  back.setLang('fr');
  back.syncLangUrl();
  assert.deepEqual(back.replaced, ['/vente/oran?page=2']);
  const news = frontWith('/newsletter/confirmation', 'ar');
  news.syncLangUrl();
  assert.deepEqual(news.replaced, []);
  const same = frontWith('/ar/vente/oran');
  same.syncLangUrl();
  assert.deepEqual(same.replaced, [], 'déjà à la bonne adresse');
});

test('front : le routage passe par routePath (jamais location.pathname brut) et applyLang resynchronise l\'adresse', () => {
  const pro = read('pro.js');
  const raw = [...(app + '\n' + pro).matchAll(/location\.pathname/g)].length;
  // seules occurrences permises : la définition (AR_PATH, routePath, syncLangUrl) et les liens de partage
  assert.ok(raw <= 5, `location.pathname brut : ${raw} occurrences`);
  const init = app.match(/async function init\(\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(init, /location\.pathname/);
  assert.match(init, /routePath\(\)/);
  const apply = app.match(/function applyLang\([^)]*\) \{[\s\S]*?\n\}/)[0];
  assert.match(apply, /syncLangUrl\(\)/);
});
