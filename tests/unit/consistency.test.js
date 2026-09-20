// Garde-fous sur le front et les données dupliquées (aucune base nécessaire).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const inlineScripts = () => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

test('les scripts en ligne de index.html sont du JavaScript valide', () => {
  // Une apostrophe non échappée dans un dictionnaire casse toute la page (déjà arrivé)
  inlineScripts().forEach((code, i) => {
    assert.doesNotThrow(() => new vm.Script(code), `script en ligne n°${i + 1} invalide`);
  });
});

test('contrats.js est du JavaScript valide', () => {
  const code = fs.readFileSync(path.join(ROOT, 'public', 'contrats.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(code));
});

test('les marqueurs SEO de index.html sont présents une seule fois', () => {
  for (const marker of ['<!--SEO_HEAD-->', '<!--SEO_NAV-->', '<!--SEO_LANDING-->']) {
    assert.equal(html.split(marker).length - 1, 1, `${marker} doit apparaître exactement une fois`);
  }
});

// Extrait le dictionnaire TRANSLATIONS de la page pour le comparer
function translations() {
  const start = html.indexOf('const TRANSLATIONS = {');
  const end = html.indexOf('function T(key)');
  const literal = html.slice(start, end).replace(/^const TRANSLATIONS = /, '').trim().replace(/;$/, '');
  return vm.runInNewContext('(' + literal + ')');
}

test('traductions : mêmes clés en français et en arabe, aucune valeur vide', () => {
  const T = translations();
  const fr = Object.keys(T.fr), ar = Object.keys(T.ar);
  assert.deepEqual(fr.filter(k => !(k in T.ar)), [], 'clés absentes de la version arabe');
  assert.deepEqual(ar.filter(k => !(k in T.fr)), [], 'clés absentes de la version française');
  for (const lang of ['fr', 'ar'])
    assert.deepEqual(fr.filter(k => !String(T[lang][k]).trim()), [], `valeurs vides (${lang})`);
});

test('toutes les clés data-i18n utilisées dans le HTML existent dans le dictionnaire', () => {
  const T = translations();
  const used = new Set([...html.matchAll(/data-i18n(?:-html|-title)?="([a-z0-9_]+)"/g)].map(m => m[1]));
  assert.deepEqual([...used].filter(k => !(k in T.fr)), []);
});

test('toutes les clés T(\'…\') utilisées dans le JavaScript existent en français et en arabe', () => {
  const T = translations();
  const contrats = fs.readFileSync(path.join(ROOT, 'public', 'contrats.js'), 'utf8');
  const used = new Set([
    ...inlineScripts().join('\n').matchAll(/\bT\('([a-z0-9_]+)'\)/g),
    ...contrats.matchAll(/\bui\('([a-z0-9_]+)'\)/g),
  ].map(m => m[1]));
  assert.ok(used.size > 100, 'l\'extraction doit trouver les clés utilisées');
  assert.deepEqual([...used].filter(k => !(k in T.fr)), [], 'clés absentes du français');
  assert.deepEqual([...used].filter(k => !(k in T.ar)), [], 'clés absentes de l\'arabe');
  // clés composées dynamiquement : préfixe + valeur
  const dyn = { feat_: ['meuble', 'parking', 'balcon', 'terrasse', 'ascenseur', 'gardien', 'piscine', 'climatisation',
    'chauffage', 'wifi', 'cave', 'jardin', 'alarme', 'interphone', 'eau', 'electricite', 'gaz', 'route', 'fibre'],
    seo_t_: ['appartement', 'villa', 'maison', 'bureau', 'local_commercial', 'terrain', 'ferme', 'entrepot', 'all'],
    seo_m_: ['vente', 'location_longue', 'location_courte'],
    dash_st_: ['active', 'sold', 'rented', 'archived', 'pending', 'rejected', 'expired'],
    // avertissements de qualité à la publication (table QW de la page)
    q_: ['dup_own', 'dup_other', 'price_low', 'price_high'],
    // pluriels : unit(n, base) lit base_one / base_two / base_many
    u_room_: ['one', 'two', 'many'], u_bath_: ['one', 'two', 'many'], u_view_: ['one', 'two', 'many'], st_ad_: ['one', 'two', 'many'],
    u_req_: ['one', 'two', 'many'],
    dash_t_: ['visite', 'offre', 'info'], dash_c_: ['pending', 'confirmed', 'rejected', 'done'],
    // badges de vérification et types de justificatifs
    adv_: ['identity', 'business', 'identity_tip', 'business_tip'], vf_ok_: ['identity', 'business'], vf_kind_: ['identity', 'business'],
    vf_doc_: ['cni', 'passeport', 'permis', 'registre_commerce', 'agrement'] };
  for (const [prefix, list] of Object.entries(dyn))
    for (const v of list) for (const lang of ['fr', 'ar'])
      assert.ok((prefix + v) in T[lang], `${prefix}${v} manquante (${lang})`);
});

test('les fonctions d\'alerte lisent des champs qui existent dans la page', () => {
  // Régression : createAlertFromFilters lisait f-min / f-max, qui n'existent pas (les prix ne partaient jamais)
  const code = inlineScripts().join('\n');
  for (const fn of ['createAlertFromFilters', 'saveAlert']) {
    const body = code.match(new RegExp(`async function ${fn}\\(\\) \\{[\\s\\S]*?\\n\\}`))[0];
    const ids = [...body.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
    assert.ok(ids.length >= 5, `${fn} : champs trouvés`);
    for (const id of ids) assert.ok(html.includes(`id="${id}"`), `${fn} lit #${id}, absent de la page`);
  }
});

test('la bannière d\'accueil ne contient pas de chiffre d\'annonces en dur', () => {
  // « Plus de 50 000 annonces » était faux (7 annonces) : pas de volume annoncé dans un texte statique
  const T = translations();
  const claim = /\d[\d\s.,]*\s*(annonces|إعلان)/i;
  assert.doesNotMatch(T.fr.hero_sub, claim);
  assert.doesNotMatch(T.ar.hero_sub, claim);
  assert.doesNotMatch(html.match(/data-i18n="hero_sub">([^<]*)</)[1], claim);
});

test('listes de prix : montants formatés avec séparateurs insécables (sinon inversés en arabe)', () => {
  // « 50 000 000 » avec de simples espaces s'affichait « 000 000 50 » en écriture de droite à gauche
  const body = html.match(/function rebuildSelects\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(body, /#f-min-price option[\s\S]*#f-max-price option[\s\S]*formatPrice\(o\.value\)/);
  assert.match(html, /function formatPrice\(n\) \{\s*return Number\(n\)\.toLocaleString\('fr-DZ'\);/);
  assert.match(translations().ar.filter_price_min, /السعر/, 'libellé « prix min » : le mot « prix » doit figurer');
  assert.match(translations().ar.filter_price_max, /السعر/, 'libellé « prix max » : le mot « prix » doit figurer');
  // Même piège dans les exemples de champs : plus aucun montant à espaces ordinaires (dictionnaire arabe, gabarits JS)
  const T = translations();
  const spaced = /\d \d{3}/;
  assert.deepEqual(Object.entries(T.ar).filter(([, v]) => spaced.test(v)).map(([k]) => k), [], 'valeurs arabes avec un montant à espaces ordinaires');
  assert.doesNotMatch(inlineScripts().join('\n'), /replace\('\{v\}', '[^']*\d \d{3}/, 'exemple de montant à espaces ordinaires : utiliser formatPrice()');
  assert.match(html, /replace\('\{v\}', formatPrice\(25000000\)\)/, 'exemple du montant de l\'offre (fiche)');
  // « 30 م²+ » : le signe « + » se place mal en écriture de droite à gauche, on écrit « 30 م² فأكثر »
  assert.equal(translations().fr.opt_more, '+');
  assert.match(translations().ar.opt_more, /فأكثر/);
  assert.match(body, /T\('opt_more'\)/);
  // les options de fourchettes n'ont plus de texte français en dur
  assert.match(html, /data-i18n="filter_no_limit">Sans limite/);
});

test('le site envoie sa langue à l\'API (en-tête X-Lang) sur les appels JSON, l\'envoi de photos et de justificatifs', () => {
  const sent = html.match(/'X-Lang': currentLang/g) || [];
  assert.equal(sent.length, 3, 'api(), l\'upload des photos et l\'envoi des justificatifs doivent envoyer X-Lang');
});

test('la liste des wilayas du serveur est identique à celle du front', () => {
  const server = require(path.join(ROOT, 'server', 'wilayas'));
  const literal = html.match(/const WILAYAS = \[([\s\S]*?)\];/)[1];
  // Array.from : un tableau créé dans un autre contexte vm n'a pas le même prototype (deepEqual strict)
  const front = Array.from(vm.runInNewContext('[' + literal + ']'));
  assert.equal(server.length, 69);
  assert.deepEqual(server, front);
});

test('chaque wilaya a un nom arabe (écriture arabe, sans doublon)', () => {
  const list = require(path.join(ROOT, 'server', 'wilayas'));
  const literal = html.match(/const WILAYAS_AR = (\{[\s\S]*?\n\});/)[1];
  const ar = vm.runInNewContext('(' + literal + ')');
  assert.deepEqual(list.filter(w => !ar[w]), [], 'wilayas sans nom arabe');
  assert.deepEqual(Object.keys(ar).filter(w => !list.includes(w)), [], 'noms arabes sans wilaya correspondante');
  const names = list.map(w => ar[w]);
  assert.equal(new Set(names).size, list.length, 'deux wilayas ont le même nom arabe');
  assert.deepEqual(names.filter(n => !/^[؀-ۿ ]+$/.test(n)), [], 'nom arabe contenant autre chose que des lettres arabes');
});

test('les slugs de wilayas sont uniques et ne collisionnent pas avec les mots réservés', () => {
  const { slugify } = require(path.join(ROOT, 'server', 'seo'));
  const slugs = require(path.join(ROOT, 'server', 'wilayas')).map(slugify);
  assert.equal(new Set(slugs).size, slugs.length);
  const reserved = ['vente', 'location', 'location-saisonniere', 'appartements', 'villas', 'maisons',
    'bureaux', 'locaux-commerciaux', 'terrains', 'fermes', 'entrepots', 'annonce'];
  assert.deepEqual(slugs.filter(s => reserved.includes(s) || !s), []);
});

test('la fonction slugify du front produit les mêmes slugs que celle du serveur', () => {
  const src = html.match(/function slugify\(s\) \{[\s\S]*?\n\}/)[0];
  const front = vm.runInNewContext(src + '; slugify');
  const { slugify } = require(path.join(ROOT, 'server', 'seo'));
  for (const s of ['Appartement F4 vue mer à Alger', "M'Sila", 'Béjaïa', 'Local commercial 120m² Annaba', '', 'فيلا'])
    assert.equal(front(s), slugify(s), `divergence pour « ${s} »`);
});
