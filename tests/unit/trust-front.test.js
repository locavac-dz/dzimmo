// Interface de confiance des annonces : compteur d'appels/WhatsApp, bandeau de reconfirmation (lien de l'email), textes FR/AR.
// Le code testé est celui de public/index.html, extrait et exécuté tel quel (aucun navigateur nécessaire).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');
const { readFront } = require('../helpers/front');

const html = readFront();
const fn = name => html.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

function translations() {
  const start = html.indexOf('const TRANSLATIONS = {');
  const end = html.indexOf('function T(key)');
  return vm.runInNewContext('(' + html.slice(start, end).replace(/^const TRANSLATIONS = /, '').trim().replace(/;$/, '') + ')');
}

// Contexte minimal : T() renvoie la clé, fetch / api / toast / loadDetail enregistrent leurs appels
function sandbox({ fetchImpl, apiImpl } = {}) {
  const calls = { fetch: [], api: [], toast: [], detail: [] };
  const ctx = {
    API: '/api', calls, JSON, encodeURIComponent, Promise,
    T: key => key,
    fetch: (...a) => { calls.fetch.push(a); return fetchImpl ? fetchImpl(...a) : Promise.resolve({}); },
    api: async (...a) => { calls.api.push(a); if (apiImpl) return apiImpl(...a); return {}; },
    toast: (...a) => calls.toast.push(a),
    loadDetail: id => calls.detail.push(id),
    window: {},
  };
  vm.createContext(ctx);
  vm.runInContext(fn('trackContact') + fn('renewBannerHTML') + fn('confirmListing'), ctx);
  return ctx;
}

test('trackContact : envoie le canal au serveur sans jamais retarder ni faire échouer l\'appel', () => {
  const c = sandbox();
  c.trackContact(12, 'call');
  assert.equal(c.calls.fetch.length, 1);
  const [url, opts] = c.calls.fetch[0];
  assert.equal(url, '/api/properties/12/click');
  assert.equal(opts.method, 'POST');
  assert.equal(opts.keepalive, true, 'la requête doit survivre à la navigation vers l\'application d\'appel');
  assert.deepEqual(JSON.parse(opts.body), { channel: 'call' });
  // fetch qui lève ou qui rejette : aucune exception ne remonte
  const boom = sandbox({ fetchImpl: () => { throw new Error('hors ligne'); } });
  assert.doesNotThrow(() => boom.trackContact(1, 'whatsapp'));
  const rej = sandbox({ fetchImpl: () => Promise.reject(new Error('réseau')) });
  assert.doesNotThrow(() => rej.trackContact(1, 'whatsapp'));
});

test('les boutons Appeler et WhatsApp de la fiche déclenchent le compteur avec le bon canal', () => {
  assert.match(html, /class="qc-call" href="tel:\+\$\{ph\.intl\}" onclick="trackContact\(\$\{p\.id\},'call'\)"/);
  assert.match(html, /class="qc-wa" href="https:\/\/wa\.me\/[^"]*"[^>]*onclick="trackContact\(\$\{p\.id\},'whatsapp'\)"/);
});

test('bandeau de reconfirmation : seulement avec le jeton de l\'email, pour la bonne annonce et un statut renouvelable', () => {
  const c = sandbox();
  const p = { id: 7, status: 'active' };
  assert.equal(c.renewBannerHTML(p), '', 'sans jeton');
  c.window._renewToken = 'abc123'; c.window._renewFor = 8;
  assert.equal(c.renewBannerHTML(p), '', 'jeton destiné à une autre annonce');
  c.window._renewFor = 7;
  for (const status of ['sold', 'rented', 'pending', 'rejected']) assert.equal(c.renewBannerHTML({ id: 7, status }), '', status);
  for (const status of ['active', 'archived']) {
    const out = c.renewBannerHTML({ id: 7, status });
    assert.match(out, /confirmListing\(7, 'available'\)/);
    assert.match(out, /confirmListing\(7, 'closed'\)/);
    assert.match(out, /rn_title/);
    assert.doesNotMatch(out, /abc123/, 'le jeton ne s\'écrit jamais dans la page');
  }
});

test('confirmListing : envoie jeton et action, puis recharge la fiche ; le jeton est oublié après un succès', async () => {
  const c = sandbox();
  c.window._renewToken = 'tok'; c.window._renewFor = 5;
  await c.confirmListing(5, 'available');
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls.api[0])), ['/properties/5/confirm', 'POST', { token: 'tok', action: 'available' }]);
  assert.equal(c.window._renewToken, null);
  assert.deepEqual([...c.calls.detail], [5]);
  assert.equal(c.calls.toast[0][0], 'rn_done');
  c.window._renewToken = 'tok2';
  await c.confirmListing(5, 'closed');
  assert.equal(c.calls.toast[1][0], 'rn_closed');
});

test('confirmListing : lien invalide → message du serveur affiché, jeton conservé, fiche non rechargée', async () => {
  const c = sandbox({ apiImpl: async () => { throw new Error('Ce lien de confirmation est invalide ou a expiré.'); } });
  c.window._renewToken = 'périmé';
  await c.confirmListing(5, 'available');
  assert.match(c.calls.toast[0][0], /invalide ou a expiré/);
  assert.equal(c.window._renewToken, 'périmé');
  assert.deepEqual([...c.calls.detail], []);
});

test('le jeton du lien est mémorisé avant que la fiche ne réécrive l\'adresse', () => {
  const start = html.indexOf('const annonceMatch');
  const block = html.slice(start, start + 700);
  assert.ok(block.indexOf("params.get('renew')") !== -1 && block.indexOf("params.get('renew')") < block.indexOf("showPage('detail'"),
    'lecture de ?renew= avant showPage(\'detail\')');
});

test('les toasts d\'erreur n\'ont plus de durée invalide (une chaîne annulait l\'affichage aussitôt)', () => {
  assert.doesNotMatch(html, /toast\([^\n]*, 'error'\)/);
});

test('textes de confiance : présents en français et en arabe, avec les mêmes paramètres {…}', () => {
  const T = translations();
  const keys = ['dash_st_expired', 'dash_calls', 'dash_whatsapps', 'dash_confirmed', 'dash_expires', 'dash_expired_note', 'dash_still', 'dash_renew',
    'dash_renewed', 'dash_clicks_tip', 'det_confirmed', 'rn_title', 'rn_yes', 'rn_no', 'rn_done', 'rn_closed',
    'q_price_low', 'q_price_high', 'q_dup_own', 'q_dup_other', 'q_held', 'q_pending_flag'];
  const params = s => (String(s).match(/\{[a-z]+\}/g) || []).sort().join();
  for (const k of keys) {
    assert.ok(T.fr[k] && T.ar[k], `${k} manquante`);
    assert.equal(params(T.fr[k]), params(T.ar[k]), `${k} : paramètres différents entre FR et AR`);
  }
  assert.equal(params(T.fr.dash_confirmed), '{date}');
  assert.equal(params(T.fr.dash_expires), '{date}');
  assert.equal(params(T.fr.q_dup_own), '{title}');
});

test('les codes d\'avertissement renvoyés par l\'API ont chacun un texte à la publication', () => {
  const codes = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'quality.js'), 'utf8').match(/BLOCKING\s*=\s*\[([^\]]*)\]/)[1].match(/[a-z_]+/g);
  const map = html.match(/const QW = \{([^}]*)\}/)[1];
  for (const code of [...codes, 'duplicate_own']) assert.match(map, new RegExp(`\\b${code}:`), `avertissement « ${code} » sans texte`);
  const T = translations();
  for (const key of map.match(/'(q_[a-z_]+)'/g).map(x => x.slice(1, -1))) assert.ok(key in T.fr && key in T.ar, key);
});
