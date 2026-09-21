// Double authentification côté page : seconde étape de la connexion, onglet Sécurité de l'administration, traductions.
// Contrôles de structure sur le code de la page (le comportement du serveur est dans tests/api/two-factor.test.js).
const test   = require('node:test');
const assert = require('node:assert/strict');
const { readFront, read } = require('../helpers/front');

const html = readFront();
const js   = read('app.js');

test('connexion : la fenêtre a une seconde étape, et la réponse « mfa_required » ne crée aucune session', () => {
  assert.match(html, /id="login-step1"/);
  assert.match(html, /id="login-step2"/);
  assert.match(html, /id="login-code"[^>]*autocomplete="one-time-code"/);
  // doLogin et Google : le défi est affiché avant que le jeton de session ne soit enregistré
  for (const fn of ['doLogin', 'onGoogleCredential']) {
    const body = js.match(new RegExp(`async function ${fn}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
    const i = body.indexOf('mfa_required'), j = body.indexOf('localStorage.setItem');
    assert.ok(i > 0 && j > i, `${fn} : mfa_required doit être traité avant l'enregistrement du jeton`);
  }
  assert.match(js, /api\('\/auth\/2fa\/login', 'POST', \{ mfa_token: _mfaToken, code \}\)/);
});

test('connexion : le jeton de défi ne survit pas à la fermeture de la fenêtre', () => {
  const close = js.match(/function closeModal\([^)]*\) \{[\s\S]*?\n\}/)[0];
  assert.match(close, /resetMfaStep\(\)/);
  const reset = js.match(/function resetMfaStep\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(reset, /_mfaToken = null/);
});

test('administration : l\'onglet Sécurité est en dernière position, aligné sur ADMIN_TABS', () => {
  const tabs = JSON.parse(js.match(/const ADMIN_TABS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  const buttons = [...html.matchAll(/<button class="tab-btn[^"]*"[^>]*onclick="adminTab\('(\w+)'\)"/g)].map(m => m[1]);
  assert.deepEqual(buttons.slice(0, tabs.length), tabs);
  assert.equal(tabs[tabs.length - 1], 'security');
  assert.match(js, /security: adminLoadSecurity/);
});

test('administration : un administrateur sans double authentification obligatoire arrive sur l\'onglet Sécurité', () => {
  const load = js.match(/async function loadAdmin\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(load, /two_factor_required\) \{ adminTab\('security'\); return; \}/);
});

test('onglet Sécurité : image du QR en data:, codes de secours et clé échappés, aucune donnée dans un onclick', () => {
  const block = js.slice(js.indexOf('// ── Sécurité : double authentification'), js.indexOf('// ── Listes d\'administration paginées'));
  assert.match(block, /data:image\/svg\+xml;charset=utf-8,\$\{encodeURIComponent\(r\.qr_svg\)\}/);
  assert.match(block, /esc\(r\.secret\)/);
  assert.match(block, /_secCodes\.map\(k => `<span>\$\{esc\(k\)\}<\/span>`\)/);
  for (const m of block.matchAll(/onclick="([^"]*)"/g)) assert.match(m[1], /^\w+\(\)$/, `onclick sans donnée : ${m[1]}`);
});

test('traductions : les textes de la seconde étape existent en français et en arabe', () => {
  const keys = ['mfa_title', 'mfa_help', 'mfa_code', 'mfa_verify', 'mfa_back', 'mfa_need_code', 'mfa_recovery_low'];
  for (const k of keys) assert.equal(js.split(new RegExp(`\\b${k}:`)).length - 1, 2, `${k} : une entrée fr et une entrée ar`);
  for (const k of ['mfa_title', 'mfa_help', 'mfa_code', 'mfa_verify', 'mfa_back'])
    assert.match(html, new RegExp(`data-i18n="${k}"`));
});

test('api() transmet aussi le code d\'erreur du serveur (mfa_setup_required)', () => {
  assert.match(js, /\{ status: r\.status, code: d\.code \}/);
});
