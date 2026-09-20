// En-tête sur mobile : tient dans l'écran (avant, Connexion / S'inscrire sortaient de l'écran), menu ☰ avec la navigation,
// le thème, la langue et l'inscription. Le code testé est celui de public/index.html, extrait tel quel.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
const fn = name => html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const header = html.match(/<header id="header">[\s\S]*?<\/header>/)[0];
// Premier bloc @media mobile de la feuille de style (celui de l'en-tête)
const mobileCss = html.match(/@media \(max-width: 768px\) \{\s*#search-box[\s\S]*?\n    \}\n/)[0];

test('mobile : la navigation et les boutons secondaires quittent l\'en-tête, le bouton ☰ apparaît', () => {
  assert.match(mobileCss, /\.nav, \.logo-flag, #theme-toggle, \.header-actions > \.lang-toggle, #auth-btns \.btn-primary \{ display: none; \}/);
  assert.match(mobileCss, /\.menu-btn \{ display: inline-flex; \}/);
  assert.match(mobileCss, /#mobile-menu\.open \{ display: block; \}/);
  assert.match(html, /\.menu-btn \{\s*display: none;/, 'masqué sur ordinateur');
  assert.match(html, /#mobile-menu \{\s*display: none; position: absolute; top: 100%;/, 'panneau sous l\'en-tête, fermé par défaut');
});

test('mobile : « + Publier » devient « + » sans perdre son texte pour les lecteurs d\'écran', () => {
  assert.match(mobileCss, /#btn-publier \{ font-size: 0;/);
  assert.match(mobileCss, /#btn-publier::before \{ content: '\+';/);
  assert.match(header, /id="btn-publier"[^>]*data-i18n="btn_publier"/, 'le texte reste dans le DOM');
});

test('petits téléphones : le nom du site disparaît (l\'icône reste), sinon cloche + messages + avatar ne tiennent pas', () => {
  assert.match(html, /@media \(max-width: 420px\) \{ \.logo-text \{ display: none; \} \}/);
  assert.match(header, /<img class="logo-mark"/);
});

test('régression : la règle qui masquait TOUS les liens de navigation sur mobile ne doit plus exister (elle viderait le menu)', () => {
  assert.doesNotMatch(mobileCss, /^\s*\.nav-link \{ display: none; \}/m);
  assert.match(html, /#mobile-menu \.nav-link \{ display: block;/);
});

test('le menu reprend toute la navigation de l\'en-tête, dans le même ordre', () => {
  const pages = block => [...block.matchAll(/data-page="([a-z-]+)"/g)].map(m => m[1]);
  const desktop = pages(header.match(/<nav class="nav">[\s\S]*?<\/nav>/)[0]);
  const menu = pages(header.match(/<nav id="mobile-menu">[\s\S]*?<\/nav>/)[0]);
  assert.deepEqual(desktop, ['home', 'annonces', 'agences', 'carte', 'admin']);
  assert.deepEqual(menu, desktop);
  // Le lien administrateur est repérable par sa classe (les deux exemplaires sont affichés / retirés ensemble)
  assert.equal((header.match(/class="nav-link nav-admin hidden"/g) || []).length, 2);
  // Chaque lien a son libellé traduit
  for (const key of ['nav_home', 'nav_annonces', 'nav_agences', 'nav_carte', 'nav_admin']) assert.ok(header.includes(`data-i18n="${key}"`), key);
});

test('menu : outils (thème, langue) et inscription, bouton ☰ accessible et traduit', () => {
  const menu = header.match(/<nav id="mobile-menu">[\s\S]*?<\/nav>/)[0];
  assert.match(menu, /class="theme-btn"/);
  assert.match(menu, /data-lang="fr"[\s\S]*data-lang="ar"/);
  assert.match(menu, /id="menu-register"[^>]*onclick="toggleMenu\(false\);openModal\('register'\)"/, 'referme le menu puis ouvre l\'inscription');
  const btn = header.match(/<button id="menu-btn"[\s\S]*?<\/button>/)[0];
  assert.match(btn, /aria-expanded="false"/);
  assert.match(btn, /aria-controls="mobile-menu"/);
  assert.match(btn, /data-i18n="menu_label" data-i18n-attr="aria-label"/, 'nom accessible traduit à chaque changement de langue');
  const start = html.indexOf('const TRANSLATIONS = {'), end = html.indexOf('function T(key)');
  const T = vm.runInNewContext('(' + html.slice(start, end).replace(/^const TRANSLATIONS = /, '').trim().replace(/;$/, '') + ')');
  assert.equal(T.fr.menu_label, 'Menu');
  assert.match(T.ar.menu_label, /[؀-ۿ]/);
});

// Faux DOM minimal : classes, attributs, texte
const el = (init = {}) => { const cls = new Set(init.classes || []); return { textContent: init.text || '', attrs: {}, classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c) },
  setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, cls }; };

test('toggleMenu : ouvre, referme, ou force un état ; icône et aria-expanded suivent', () => {
  const menu = el(), btn = el({ text: '☰' });
  const ctx = { document: { getElementById: id => ({ 'mobile-menu': menu, 'menu-btn': btn })[id] }, String };
  vm.createContext(ctx); vm.runInContext(fn('toggleMenu'), ctx);
  ctx.toggleMenu();
  assert.deepEqual([menu.cls.has('open'), btn.getAttribute('aria-expanded'), btn.textContent], [true, 'true', '✕']);
  ctx.toggleMenu();
  assert.deepEqual([menu.cls.has('open'), btn.getAttribute('aria-expanded'), btn.textContent], [false, 'false', '☰']);
  ctx.toggleMenu(true); ctx.toggleMenu(true);
  assert.equal(menu.cls.has('open'), true, 'forcer « ouvert » deux fois : reste ouvert');
  ctx.toggleMenu(false); ctx.toggleMenu(false);
  assert.deepEqual([menu.cls.has('open'), btn.textContent], [false, '☰']);
});

test('le menu se referme : changement de page, clic ailleurs, Échap, passage en mode ordinateur', () => {
  assert.match(html, /function showPage\(page, data = null\) \{\s*toggleMenu\(false\);/);
  assert.match(html, /document\.addEventListener\('click', e => \{\s*if \(!e\.target\.closest\('#mobile-menu, #menu-btn'\)\) toggleMenu\(false\);/);
  assert.match(html, /document\.addEventListener\('keydown', e => \{ if \(e\.key === 'Escape'\) toggleMenu\(false\); \}\);/);
  assert.match(html, /matchMedia\('\(max-width: 768px\)'\)\.addEventListener\('change', e => \{ if \(!e\.matches\) toggleMenu\(false\); \}\);/);
});

test('thème : les deux boutons (en-tête et menu) montrent la même icône', () => {
  const btns = [el({ text: '🌙' }), el({ text: '🌙' })];
  const root = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const ctx = { document: { documentElement: root, querySelectorAll: sel => (sel === '.theme-btn' ? btns : []) }, localStorage: { setItem() {} }, renderGoogleButtons() {} };
  vm.createContext(ctx); vm.runInContext(fn('applyTheme'), ctx);
  ctx.applyTheme('dark');
  assert.deepEqual(btns.map(b => b.textContent), ['☀️', '☀️']);
  assert.equal(root.attrs['data-theme'], 'dark');
  ctx.applyTheme('light');
  assert.deepEqual(btns.map(b => b.textContent), ['🌙', '🌙']);
  assert.equal((header.match(/class="theme-btn"/g) || []).length, 2, 'un bouton dans l\'en-tête, un dans le menu');
});

test('connexion / déconnexion : « S\'inscrire » du menu et lien Admin suivent l\'état du compte', () => {
  const login = fn('loadCurrentUser'), logout = fn('logout');
  assert.match(login, /getElementById\('menu-register'\)\.classList\.add\('hidden'\)/, 'connecté : plus d\'inscription dans le menu');
  assert.match(login, /if \(r\.is_admin\) document\.querySelectorAll\('\.nav-admin'\)\.forEach\(l => l\.classList\.remove\('hidden'\)\)/, 'les deux liens Admin');
  assert.match(logout, /getElementById\('menu-register'\)\.classList\.remove\('hidden'\)/);
  assert.match(logout, /querySelectorAll\('\.nav-admin'\)\.forEach\(l => l\.classList\.add\('hidden'\)\)/, 'le lien Admin ne survit plus à la déconnexion');
});

test('panneau de notifications : pleine largeur sous l\'en-tête sur mobile (ancré à la cloche il sortait de l\'écran)', () => {
  assert.match(mobileCss, /#notif-panel \{ position: fixed; top: 63px; left: \.5rem; right: \.5rem; width: auto;/);
  assert.match(html, /#notif-panel \{\s*position: absolute; top: calc\(100% \+ \.5rem\); right: 0;\s*width: 320px;/, 'inchangé sur ordinateur');
});

test('onglets (tableau de bord, administration) : ils défilent dans leur rangée au lieu d\'élargir la page', () => {
  assert.match(mobileCss, /\.tabs \{ overflow-x: auto; border-bottom: none; box-shadow: inset 0 -2px 0 var\(--border\);/, 'filet du bas en ombre interne (un overflow couperait le soulignement)');
  assert.match(mobileCss, /\.tab-btn \{ flex-shrink: 0; white-space: nowrap; margin-bottom: 0; \}/);
  assert.match(html, /\.tabs \{ display: flex; gap: 0\.25rem; margin-bottom: 1\.25rem; border-bottom: 2px solid var\(--border\); \}/, 'inchangé sur ordinateur');
});

test('onglets : l\'onglet choisi est ramené dans la zone visible', () => {
  assert.match(fn('dashTab'), /querySelector\('#page-dashboard \.tab-btn\.active'\)\?\.scrollIntoView\(\{ inline: 'nearest', block: 'nearest' \}\)/);
  assert.match(fn('adminTab'), /querySelector\('#admin-tabs \.tab-btn\.active'\)\?\.scrollIntoView\(\{ inline: 'nearest', block: 'nearest' \}\)/);
});
