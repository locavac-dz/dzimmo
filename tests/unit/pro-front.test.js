// Vitrine des agences et des promoteurs (public/pro.js) : adresses identiques à celles du serveur, échappement, contact, complétude du profil.
// Le code testé est celui de public/pro.js et de public/index.html, extrait et exécuté tel quel (aucun navigateur nécessaire).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const pro  = fs.readFileSync(path.join(ROOT, 'public', 'pro.js'), 'utf8');
const fn = name => html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

// Contexte : T() renvoie la clé, les éléments de la page sont remplacés par de petits objets
function sandbox({ els = {}, lang = 'fr' } = {}) {
  const calls = { showPage: [] };
  const ctx = {
    T: k => k, currentLang: lang, currentPage: 'agences', calls, encodeURIComponent, WILAYAS: ['Alger', 'Oran'],
    wilayaName: w => w, formatPrice: n => String(n), token: 't', currentUser: { id: 1 },
    showPage: (...a) => calls.showPage.push(a),
    document: { getElementById: id => els[id] || null, querySelectorAll: () => [] },
  };
  vm.createContext(ctx);
  vm.runInContext([
    fn('esc'), fn('slugify'), fn('unit'), html.match(/const COUNTRY_CODES = \[[\s\S]*?\];/)[0], fn('parsePhone'),
    pro.replace(/^const /gm, 'var '),   // les const de pro.js deviennent visibles depuis le contexte de test
  ].join('\n'), ctx);
  return ctx;
}
const c = sandbox();

test('adresses : /agence, /promoteur et /programme, identiques à celles du serveur (server/seo.js)', () => {
  const seo = require('../../server/seo');
  const names = ['Agence Immobilière Horizon', 'Les Bâtisseurs de la Mitidja', 'Cité El Amel', 'وكالة النور', '', 'A', '  Espaces   Verts  ', '<b>x</b> & Fils', 'x'.repeat(200), 'Éléphant d\'Or'];
  for (const [i, name] of names.entries()) for (const kind of ['agence', 'promoteur']) {
    assert.equal(c.proPath({ id: i + 1, kind, name }), seo.agencyPath({ id: i + 1, kind, name }), `${kind} « ${name.slice(0, 30)} »`);
  }
  for (const [i, name] of names.entries()) assert.equal(c.progPath({ id: i + 1, name }), seo.projectPath({ id: i + 1, name }), name.slice(0, 30));
  assert.equal(c.proPath({ id: 7, kind: 'promoteur', name: 'Cité El Amel' }), '/promoteur/7-cite-el-amel');
  assert.equal(c.proPath({ id: 3, kind: 'autre', name: 'X' }), '/agence/3-x', 'type inconnu : agence');
});

test('proGo : la navigation reste dans la page, sauf Ctrl / Cmd / Maj / clic milieu (ouverture dans un nouvel onglet)', () => {
  const k = sandbox();
  let prevented = 0;
  const ev = over => ({ ctrlKey: false, metaKey: false, shiftKey: false, button: 0, preventDefault: () => prevented++, ...over });
  assert.equal(k.proGo(ev(), 'agency-detail', 5), false);
  assert.deepEqual([prevented, k.calls.showPage.length], [1, 1]);
  assert.deepEqual([...k.calls.showPage[0]], ['agency-detail', 5]);
  for (const over of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) assert.equal(k.proGo(ev(over), 'agences'), true, JSON.stringify(over));
  assert.equal(k.calls.showPage.length, 1, 'aucun changement de page quand le navigateur ouvre le lien');
});

const HOSTILE = { id: 4, name: '<img src=x onerror="window.__x=1">Agence', kind: 'agence', wilaya: 'Alger', commune: '"><script>1</script>', tagline: '<b>slogan</b>',
  logo: '" onerror="alert(1)', cover: '"><svg onload=alert(1)>', verified: true, services: ['vente'], property_count: 2, project_count: 1, rating: 4.5, review_count: 3 };

// Balises et attributs réellement produits : la valeur d'un attribut ne contient jamais de guillemet ni de « < » (esc), donc [^>]* suffit
function structure(out) {
  const tags = new Set(), attrs = [];
  for (const m of out.matchAll(/<(\w+)((?:\s[^>]*)?)>/g)) {
    tags.add(m[1].toLowerCase());
    for (const a of m[2].matchAll(/\s([\w:-]+)="[^"]*"/g)) attrs.push(a[1].toLowerCase());
  }
  return { tags, attrs };
}

test('cartes : nom, slogan, commune, logo et couverture sont échappés (aucune balise ni attribut injecté)', () => {
  const outs = [c.proCardHTML(HOSTILE), c.proLogoHTML(HOSTILE, 'x'),
    c.progCardHTML({ id: 1, name: '<i>P</i>', status: 'livre', wilaya: 'Oran', image: '"><script>', agency_name: '<b>A</b>', agency_logo: '" onerror="x', available_count: 1, sold_count: 0, price_from: 5 }),
    c.proLogoHTML({ name: '<script>' })];
  for (const out of outs) {
    const { tags, attrs } = structure(out);
    for (const t of tags) assert.ok(['a', 'img', 'div', 'span', 'p', 'b', 'small'].includes(t), `balise inattendue <${t}> dans ${out.slice(0, 160)}`);
    for (const a of attrs) assert.ok(!/^on/.test(a) || a === 'onclick', `attribut injecté « ${a} »`);
    assert.doesNotMatch(out, /<script|<svg|<i>|<b>(?:slogan|A|gras)/i);
  }
  assert.match(outs[0], /&lt;img src=x onerror=&quot;window\.__x=1&quot;&gt;Agence/, 'le nom s\'affiche tel quel, en texte');
  assert.equal([...outs[0].matchAll(/onclick=/g)].length, 1, 'un seul gestionnaire : celui de la carte');
});

test('aucune donnée de la page dans un attribut onclick : seuls des nombres et des constantes y sont insérés', () => {
  const handlers = [...pro.matchAll(/onclick="([^"]*)"/g)].map(m => m[1]);
  assert.ok(handlers.length > 20, 'extraction : ' + handlers.length);
  const allowed = /^(Number\([\w.]+\)|[a-z]\.(?:id|agency_id|property_id)|i|v|k|which|id|r\.page \+ 1|_\w+\.\w+ \+ 1)$/;
  for (const h of handlers) for (const m of h.matchAll(/\$\{([^}]*)\}/g))
    assert.match(m[1], allowed, `interpolation inattendue dans onclick : ${m[1]}\n${h}`);
  // Les chaînes du visiteur passent par data-* (valeurs échappées), jamais par le JavaScript en ligne
  assert.match(pro, /data-name="\$\{esc\(a\.name\)\}" onclick="proProgrammesOf\(Number\(this\.dataset\.id\), this\.dataset\.name\)"/);
  assert.doesNotMatch(pro, /JSON\.stringify\([^)]*\)\.replace\(\/'\/g/, 'plus de JSON dans un onclick');
});

test('contact : Appeler pour tout numéro valide, WhatsApp seulement pour un mobile, message encodé', () => {
  assert.equal(c.proContactHTML({ phone: '' }, 'x'), '');
  assert.equal(c.proContactHTML({ phone: 'abc' }, 'x'), '');
  const fixe = c.proContactHTML({ phone: '021 12 34 56' }, 'x');
  assert.match(fixe, /href="tel:\+21321123456"/);
  assert.doesNotMatch(fixe, /wa\.me/);
  const mobile = c.proContactHTML({ phone: '0555 12 34 56' }, 'Bonjour & merci : https://dzimmo.dz/x?a=1');
  assert.match(mobile, /href="tel:\+213555123456"/);
  assert.match(mobile, /href="https:\/\/wa\.me\/213555123456\?text=Bonjour%20%26%20merci%20%3A%20https%3A%2F%2Fdzimmo\.dz%2Fx%3Fa%3D1"/);
  assert.match(mobile, /rel="noopener"/);
});

test('livraison d\'un programme : trimestre et année, « livré en » pour un programme terminé', () => {
  assert.equal(c.deliveryText({ status: 'en_construction', delivery_year: 2027, delivery_quarter: 2 }), 'pg_delivery_at');   // T() du test renvoie la clé
  const real = sandbox();
  real.T = k => ({ pg_delivery_at: 'Livraison {when}', pg_delivered: 'Livré en {y}', pg_q_short: 'T' })[k] || k;
  assert.equal(real.deliveryText({ status: 'en_construction', delivery_year: 2027, delivery_quarter: 2 }), 'Livraison T2 2027');
  assert.equal(real.deliveryText({ status: 'sur_plan', delivery_year: 2029 }), 'Livraison 2029');
  assert.equal(real.deliveryText({ status: 'livre', delivery_year: 2024, delivery_quarter: 1 }), 'Livré en 2024');
  assert.equal(real.deliveryText({ status: 'sur_plan' }), '');
});

test('complétude du profil : pourcentage et au plus trois suggestions, dans l\'ordre', () => {
  assert.deepEqual({ ...c.vtCompleteness({}) }.pct, 0);
  const none = c.vtCompleteness({});
  assert.deepEqual([...none.todo], ['vt_todo_logo', 'vt_todo_cover', 'vt_todo_tagline']);
  const full = { logo: '/uploads/a.webp', cover: '/uploads/b.webp', tagline: 't', description: 'x'.repeat(100), phone: '0555', website: 'https://a.dz', hours: 'h',
    services: ['vente'], coverage: [], commune: 'Hydra', founded_year: 2000 };
  assert.deepEqual([c.vtCompleteness(full).pct, [...c.vtCompleteness(full).todo]], [100, []]);
  assert.equal(c.vtCompleteness({ ...full, description: 'x'.repeat(99) }).pct, 90, 'description de moins de 100 caractères : non comptée');
  assert.equal(c.vtCompleteness({ ...full, website: '', instagram: '@a' }).pct, 100, 'un réseau social remplace le site');
  assert.equal(c.vtCompleteness({ ...full, coverage: [], commune: '' }).pct, 90, 'ni zone ni commune');
});

test('publication : agency_id et project_id joints seulement si le bloc « Publier au nom de » est visible', () => {
  const el = (over = {}) => ({ value: '', classList: { contains: cls => !!over.hidden && cls === 'hidden' }, ...over });
  const build = (asVal, wrapHidden, projVal, rowHidden) => sandbox({ els: {
    'pub-as': el({ value: asVal }), 'pub-as-wrap': el({ hidden: wrapHidden }), 'pub-project': el({ value: projVal }), 'pub-project-row': el({ hidden: rowHidden }) } });
  assert.deepEqual({ ...build('5', false, '9', false).publishAffiliation() }, { agency_id: 5, project_id: 9 });
  assert.deepEqual({ ...build('5', false, '', false).publishAffiliation() }, { agency_id: 5 }, 'pas de programme choisi');
  assert.deepEqual({ ...build('', false, '9', false).publishAffiliation() }, {}, 'annonce de particulier : pas de programme non plus');
  assert.deepEqual({ ...build('5', true, '9', false).publishAffiliation() }, {}, 'bloc masqué (compte sans vitrine)');
  assert.deepEqual({ ...build('5', false, '9', true).publishAffiliation() }, { agency_id: 5 }, 'sélecteur de programme masqué');
  assert.deepEqual({ ...sandbox().publishAffiliation() }, {}, 'page sans le bloc');
});

test('câblage dans index.html : pro.js chargé avant le script principal, pages, adresses et onglet du tableau de bord', () => {
  assert.ok(html.indexOf('<script src="/pro.js"></script>') > 0 && html.indexOf('<script src="/pro.js"></script>') < html.indexOf('<script>\nconst API'),
    'pro.js doit précéder le script principal (les liens directs appellent showPage dès init)');
  for (const p of ['agences', 'agency-detail', 'programmes', 'programme-detail']) {
    assert.match(html, new RegExp(`id="page-${p}"`), `page-${p}`);
    assert.ok(html.match(/const PAGES = \[([^\]]*)\]/)[1].includes(`'${p}'`), `${p} dans PAGES`);
    assert.ok(html.match(/const PRO_PAGES = \[([^\]]*)\]/)[1].includes(`'${p}'`), `${p} dans PRO_PAGES : showPage ne remet pas l'adresse à /`);
  }
  // Liens directs
  assert.match(html, /path === '\/agences' \|\| path === '\/promoteurs'/);
  assert.match(html, /\/\^\\\/\(\?:agence\|promoteur\)\\\/\(\\d\+\)\//);
  assert.match(html, /\/\^\\\/programme\\\/\(\\d\+\)\//);
  // L'onglet actif du tableau de bord se retrouve par position : la liste doit suivre exactement les boutons
  const dash = html.match(/<div id="page-dashboard"[\s\S]*?<div class="tabs">([\s\S]*?)<\/div>/)[1];
  const buttons = [...dash.matchAll(/dashTab\('([a-z-]+)'\)/g)].map(m => m[1]);
  const order = html.match(/\[('mes-annonces'[^\]]*)\]\[i\] === tab/)[1].match(/'([a-z-]+)'/g).map(x => x.slice(1, -1));
  assert.deepEqual(order, buttons, 'ordre des onglets du tableau de bord');
  assert.ok(buttons.includes('vitrine'));
  // Chaque page de la vitrine a son chargeur, rejoué au changement de langue
  for (const l of ['loadAgences()', 'loadProgrammes()', 'loadProgrammeDetail(window._programmeId)', 'loadAgencyDetail(window._agencyId)'])
    assert.ok(html.includes(l), l);
});

test('api() transmet le statut HTTP de l\'erreur (« pas de vitrine » ≠ panne)', () => {
  assert.match(html, /throw Object\.assign\(new Error\(d\.error \|\| T\('err_server'\)\), \{ status: r\.status \}\)/);
  assert.match(pro, /catch \(e\) \{ if \(e\.status !== 404\)/);
});
