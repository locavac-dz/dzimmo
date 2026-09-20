// Connexion avec Google, côté site : le bouton n'existe que si le serveur est configuré, le jeton part au serveur, les erreurs
// s'affichent dans la bonne fenêtre. Le code testé est celui de public/index.html, extrait et exécuté tel quel.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');
const { readFront } = require('../helpers/front');

const html = readFront();
const fn = name => html.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
function translations() {
  const start = html.indexOf('const TRANSLATIONS = {'), end = html.indexOf('function T(key)');
  return vm.runInNewContext('(' + html.slice(start, end).replace(/^const TRANSLATIONS = /, '').trim().replace(/;$/, '') + ')');
}
const T = translations();
const tick = () => new Promise(r => setTimeout(r, 0));

// Contexte : faux DOM, faux Google, api() simulée
function sandbox({ config = { google_client_id: '123.apps.googleusercontent.com' }, google, apiFail = null, scriptFails = false, theme = 'light', modalRegisterHidden = true } = {}) {
  const log = { init: null, rendered: [], scripts: [], toasts: [], errors: [], api: [], closed: [], pages: [], wrapsShown: 0 };
  const wraps = [{ classList: { remove: c => { if (c === 'hidden') log.wrapsShown++; } } }, { classList: { remove: c => { if (c === 'hidden') log.wrapsShown++; } } }];
  const buttons = {};
  const btn = id => (buttons[id] = { id, innerHTML: 'ancien', getBoundingClientRect: () => ({ width: ctx.googleWidth[id === 'g-btn-login' ? 'login' : 'register'] }) });
  const ctx = {
    currentLang: 'fr', token: null, currentUser: null, googleWidth: { login: 340, register: 340 },
    window: {}, localStorage: { setItem() {} }, T: (k) => T.fr[k],
    api: async (p, m, body) => { log.api.push([p, m, body]); if (p === '/auth/config') return config; if (apiFail) throw new Error(apiFail); return { token: 'jwt-1', user: { name: 'Karim' }, created: body && body.credential === 'nouveau' }; },
    toast: m => log.toasts.push(m), showError: (id, m) => log.errors.push([id, m]),
    closeModal: n => log.closed.push(n), showPage: p => log.pages.push(p), loadCurrentUser: async () => {},
    document: {
      documentElement: { getAttribute: k => (k === 'data-theme' ? theme : null) },
      head: { appendChild: sc => { log.scripts.push(sc.src); setTimeout(() => (scriptFails ? sc.onerror() : (ctx.window.google = ctx.google, ctx.google = ctx.google, sc.onload())), 0); } },
      createElement: () => ({}),
      querySelectorAll: sel => (sel === '[data-google]' ? wraps : []),
      getElementById: id => (id === 'modal-register' ? { classList: { contains: () => modalRegisterHidden } }
        : (id === 'g-btn-login' || id === 'g-btn-register') ? (buttons[id] ??= btn(id)) : null),
    },
    google: google === undefined ? { accounts: { id: { initialize: cfg => { log.init = cfg; }, renderButton: (el, o) => log.rendered.push([el.id, o]) } } } : google,
  };
  ctx.buttons = buttons; ctx.log = log;
  vm.createContext(ctx);
  vm.runInContext('let googleReady = false;' + fn('loadGoogleScript') + fn('initGoogle') + fn('renderGoogleButtons') + fn('onGoogleCredential') + fn('goLegal'), ctx);
  // Le vrai script ajoute la bibliothèque Google : ici elle « arrive » au chargement du script
  if (google === undefined) { const g = ctx.google; ctx.google = undefined; ctx.window.google = undefined; ctx.pendingGoogle = g; ctx.google = g; }
  return ctx;
}
const ready = ctx => vm.runInContext('googleReady', ctx);

test('pas d\'identifiant client côté serveur : rien n\'est chargé, les boutons restent masqués', async () => {
  const ctx = sandbox({ config: { google_client_id: null } });
  await ctx.initGoogle();
  assert.equal(ready(ctx), false);
  assert.deepEqual(ctx.log.scripts, [], 'aucun script Google téléchargé');
  assert.equal(ctx.log.wrapsShown, 0);
  assert.equal(ctx.log.init, null);
});

test('configuration illisible ou Google injoignable : silencieux, l\'email et le mot de passe restent disponibles', async () => {
  const noApi = sandbox(); noApi.api = async () => { throw new Error('réseau'); };
  await noApi.initGoogle();
  assert.equal(ready(noApi), false);
  const blocked = sandbox({ scriptFails: true });         // bloqueur de publicité, pas de réseau
  await blocked.initGoogle();
  assert.equal(ready(blocked), false);
  assert.equal(blocked.log.wrapsShown, 0, 'pas de bouton vide ni de message d\'erreur');
  assert.deepEqual(blocked.log.errors, []);
});

test('avec un identifiant : bibliothèque chargée, initialisée avec notre identifiant, boutons affichés puis dessinés', async () => {
  const ctx = sandbox();
  ctx.window.google = ctx.google;             // bibliothèque déjà présente : pas de second chargement
  await ctx.initGoogle();
  assert.equal(ready(ctx), true);
  assert.equal(ctx.log.init.client_id, '123.apps.googleusercontent.com');
  assert.equal(ctx.log.init.callback.name, 'onGoogleCredential');
  assert.equal(ctx.log.init.ux_mode, 'popup');
  assert.deepEqual(ctx.log.scripts, [], 'déjà là : rien à télécharger');
  assert.equal(ctx.log.wrapsShown, 2, 'les deux cadres (connexion, inscription) sont affichés');
  assert.deepEqual(ctx.log.rendered.map(r => [r[0], r[1].text]), [['g-btn-login', 'signin_with'], ['g-btn-register', 'signup_with']]);
});

test('le script Google est ajouté à la page quand la bibliothèque n\'est pas là', async () => {
  const lib = { accounts: { id: { initialize() {}, renderButton() {} } } };
  const ctx = sandbox({ google: lib });
  await ctx.initGoogle();
  assert.deepEqual(ctx.log.scripts, ['https://accounts.google.com/gsi/client']);
});

test('dessin du bouton : largeur de la fenêtre (bornée à 400), thème, langue et texte ; rien tant que la fenêtre est fermée', () => {
  const ctx = sandbox({ theme: 'dark' });
  vm.runInContext('googleReady = true', ctx);
  ctx.currentLang = 'ar';
  ctx.googleWidth = { login: 0, register: 340 };            // fenêtre de connexion fermée : largeur nulle
  ctx.renderGoogleButtons();
  assert.deepEqual(ctx.log.rendered.map(r => r[0]), ['g-btn-register'], 'la fenêtre fermée n\'est pas dessinée');
  const opts = ctx.log.rendered[0][1];
  assert.deepEqual({ ...opts }, { type: 'standard', theme: 'filled_black', size: 'large', text: 'signup_with', shape: 'rectangular', logo_alignment: 'left', width: 340, locale: 'ar' });
  assert.equal(ctx.buttons['g-btn-register'].innerHTML, '', 'ancien bouton effacé avant le nouveau dessin');
  ctx.googleWidth = { login: 900, register: 199 };
  ctx.log.rendered.length = 0; ctx.renderGoogleButtons();
  assert.equal(ctx.log.rendered.length, 1, '199 px : trop étroit, ignoré');
  assert.equal(ctx.log.rendered[0][1].width, 400, 'largeur plafonnée à 400 px (limite de Google)');
});

test('dessin du bouton : thème clair = « outline » ; sans initialisation, aucun appel à Google', () => {
  const light = sandbox({ theme: 'light' });
  vm.runInContext('googleReady = true', light); light.renderGoogleButtons();
  assert.equal(light.log.rendered[0][1].theme, 'outline');
  const off = sandbox(); off.renderGoogleButtons();
  assert.deepEqual(off.log.rendered, [], 'Google pas prêt : aucun dessin (et pas d\'erreur)');
});

test('jeton reçu : envoyé au serveur, session ouverte, fenêtres fermées, message adapté (compte créé ou retrouvé)', async () => {
  const created = sandbox();
  await created.onGoogleCredential({ credential: 'nouveau' });
  assert.equal(JSON.stringify(created.log.api[0]), JSON.stringify(['/auth/google', 'POST', { credential: 'nouveau' }]));
  assert.equal(created.token, 'jwt-1');
  assert.equal(JSON.stringify(created.currentUser), JSON.stringify({ name: 'Karim' }));
  assert.deepEqual(created.log.closed, ['login', 'register']);
  assert.deepEqual(created.log.toasts, ['Compte créé avec Google. Bienvenue, Karim !']);
  const known = sandbox();
  await known.onGoogleCredential({ credential: 'ancien' });
  assert.deepEqual(known.log.toasts, ['Connecté avec Google : Karim']);
});

test('jeton refusé par le serveur : l\'erreur s\'affiche dans la fenêtre ouverte, sans session', async () => {
  const login = sandbox({ apiFail: 'Jeton Google invalide.', modalRegisterHidden: true });
  await login.onGoogleCredential({ credential: 'x' });
  assert.deepEqual(login.log.errors, [['login-error', 'Jeton Google invalide.']]);
  assert.equal(login.token, null);
  assert.deepEqual(login.log.toasts, []);
  const reg = sandbox({ apiFail: 'Adresse Google non vérifiée.', modalRegisterHidden: false });
  await reg.onGoogleCredential({ credential: 'x' });
  assert.deepEqual(reg.log.errors, [['register-error', 'Adresse Google non vérifiée.']]);
});

test('liens des conditions et de la confidentialité : ferment les fenêtres et ouvrent la page', () => {
  const ctx = sandbox();
  assert.equal(ctx.goLegal({ dataset: { p: 'cgu' } }), false, 'le lien ne recharge pas la page');
  assert.deepEqual(ctx.log.closed, ['login', 'register']);
  assert.deepEqual(ctx.log.pages, ['cgu']);
  const pages = html.match(/const PAGES = \[([^\]]*)\]/)[1];
  for (const p of ['cgu', 'confidentialite']) assert.match(pages, new RegExp(`'${p}'`), `page « ${p} » existante`);
});

test('fenêtres : chaque bouton Google est dans un cadre masqué par défaut, avec le séparateur « ou »', () => {
  for (const [modal, id] of [['modal-login', 'g-btn-login'], ['modal-register', 'g-btn-register']]) {
    const block = html.match(new RegExp(`id="${modal}"[\\s\\S]*?</div>\\s*</div>\\s*</div>`))[0];
    assert.match(block, new RegExp(`<div class="google-wrap hidden" data-google>\\s*<div class="google-btn" id="${id}"></div>`), modal);
  }
  assert.match(html, /<div class="field-hint google-terms" data-i18n-html="g_terms"><\/div>/, 'mention des conditions sous le bouton d\'inscription');
});

test('le bouton se redessine à l\'ouverture d\'une fenêtre, au changement de thème et de langue', () => {
  assert.match(fn('openModal'), /if \(name === 'login' \|\| name === 'register'\) renderGoogleButtons\(\);/);
  assert.match(fn('applyTheme'), /renderGoogleButtons\(\);/);
  assert.match(html, /querySelectorAll\('\.lang-btn'\)\.forEach\([^\n]*\n\s*renderGoogleButtons\(\);/);
  assert.match(html, /populateWilayas\(\);\s*initGoogle\(\);/, 'initialisation au démarrage, sans bloquer la page');
});

test('textes : français et arabe, avec les liens vers les conditions', () => {
  for (const lang of ['fr', 'ar']) {
    for (const k of ['g_terms', 'g_created', 'g_connected', 'priv_h9', 'priv_p9']) assert.ok(T[lang][k], `${k} (${lang})`);
    assert.match(T[lang].g_created, /\{name\}/);
    assert.match(T[lang].g_connected, /\{name\}/);
    assert.match(T[lang].g_terms, /data-p="cgu"/);
    assert.match(T[lang].g_terms, /data-p="confidentialite"/);
    assert.match(T[lang].g_terms, /onclick="return goLegal\(this\)"/);
  }
  assert.match(T.ar.g_created, /[؀-ۿ]/);
  assert.match(T.ar.g_terms, /[؀-ۿ]/);
});

test('politique de confidentialité : section 9 sur Google (données reçues, ce qui n\'est pas reçu, rattachement, alternative)', () => {
  assert.match(html, /data-i18n="priv_h9"/);
  assert.match(html, /data-i18n="priv_p9"/);
  assert.match(T.fr.priv_p9, /nom, votre adresse email .* votre photo de profil/);
  assert.match(T.fr.priv_p9, /ne recevons pas votre mot de passe Google/);
  assert.match(T.fr.priv_p9, /rattacher à votre compte/);
  assert.match(T.fr.priv_p9, /email et un mot de passe à la place/);
  assert.match(T.ar.priv_p9, /كلمة مرور Google/);
  assert.match(T.ar.priv_p9, /ربطه بحسابك/);
});

test('aucun secret ni identifiant client dans la page : l\'identifiant vient du serveur', () => {
  assert.doesNotMatch(html, /apps\.googleusercontent\.com/);
  assert.doesNotMatch(html, /client_secret|GOCSPX-/i);
});
