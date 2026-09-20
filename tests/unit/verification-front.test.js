// Vérification des annonceurs, côté site : badges, formulaire, cohérence avec le serveur. Le code testé est celui de
// public/index.html, extrait et exécuté tel quel (aucun navigateur nécessaire).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');
const { readFront } = require('../helpers/front');

const ROOT = path.join(__dirname, '..', '..');
const html = readFront();
const V    = require(path.join(ROOT, 'server', 'verification'));
const { REASONS_AR } = require(path.join(ROOT, 'server', 'messages'));

const fn = name => html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const literal = re => vm.runInNewContext('(' + html.match(re)[1] + ')');
function translations() {
  const start = html.indexOf('const TRANSLATIONS = {'), end = html.indexOf('function T(key)');
  return vm.runInNewContext('(' + html.slice(start, end).replace(/^const TRANSLATIONS = /, '').trim().replace(/;$/, '') + ')');
}
const T = translations();

// Contexte minimal pour advKind / advBadgeHTML
function badges(lang = 'fr') {
  const ctx = { T: k => T[lang][k], esc: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') };
  vm.createContext(ctx);
  vm.runInContext(fn('advKind') + fn('advBadgeHTML'), ctx);
  return ctx;
}

test('badge : « professionnel » l\'emporte, l\'identité seule donne « identité », sinon rien', () => {
  const { advKind } = badges();
  assert.equal(advKind({ owner_verified_kind: 'business' }), 'business');
  assert.equal(advKind({ agency_verified: true }), 'business');
  assert.equal(advKind({ agency_verified: true, owner_verified_kind: 'identity' }), 'business');
  assert.equal(advKind({ owner_verified_kind: 'identity' }), 'identity');
  assert.equal(advKind({ owner_verified_kind: null, agency_verified: false }), null);
  assert.equal(advKind({}), null);
  assert.equal(advKind({ owner_verified_kind: 'inconnu' }), null, 'valeur inattendue : pas de badge');
});

test('badge : libellé et infobulle dans la langue du site, rien si non vérifié', () => {
  for (const lang of ['fr', 'ar']) {
    const { advBadgeHTML } = badges(lang);
    assert.equal(advBadgeHTML(null), '');
    for (const kind of ['identity', 'business']) {
      const h = advBadgeHTML(kind);
      assert.match(h, new RegExp(`class="adv-badge adv-${kind}"`));
      assert.ok(h.includes(T[lang]['adv_' + kind]), `${kind} (${lang}) : libellé`);
      assert.ok(h.includes(`title="${T[lang]['adv_' + kind + '_tip'].replace(/"/g, '&quot;')}"`), `${kind} (${lang}) : infobulle`);
    }
  }
  assert.match(T.ar.adv_identity, /[؀-ۿ]/);
  assert.match(T.fr.adv_identity_tip, /ne prouve pas/, 'l\'infobulle « identité » précise que ce n\'est pas une preuve de propriété');
  assert.match(T.ar.adv_identity_tip, /لا يثبت/);
});

test('les badges figurent sur les cartes et sur la fiche annonce', () => {
  assert.match(fn('cardHTML'), /\$\{advBadgeHTML\(advKind\(p\)\)\}/, 'carte de la liste');
  assert.match(html, /<div class="owner-agency">[\s\S]{0,140}\$\{advBadgeHTML\(advKind\(p\)\)\}/, 'carte de contact de la fiche');
});

test('types de documents du formulaire = types acceptés par le serveur', () => {
  const docs = literal(/const VF_DOCS = (\{[^;]*\});/);
  assert.deepEqual(Object.keys(docs).sort(), Object.keys(V.KINDS).sort());
  for (const kind of Object.keys(V.KINDS)) assert.deepEqual([...docs[kind]], V.KINDS[kind], kind);
  const adminDocs = literal(/const VERIF_DOC = (\{[^;]*\});/);
  for (const d of Object.values(V.KINDS).flat()) {
    assert.ok(adminDocs[d], `libellé admin de ${d}`);
    for (const lang of ['fr', 'ar']) assert.ok(T[lang]['vf_doc_' + d], `libellé ${lang} de ${d}`);
  }
});

test('motifs de refus de vérification : traduits en arabe pour le demandeur', () => {
  const reasons = Array.from(literal(/const VERIF_REASONS = (\[[^\]]*\]);/));
  assert.equal(reasons.length, 6);
  assert.deepEqual(reasons.filter(r => !REASONS_AR[r]), [], 'motifs sans traduction serveur');
  const front = literal(/const MOD_REASONS_AR = (\{[\s\S]*?\n\});/);
  assert.deepEqual(reasons.filter(r => !front[r]), [], 'motifs sans traduction dans le site (affichage du refus)');
});

test('formulaire : consentement obligatoire, envoi limité à 2 photos, jeton et langue envoyés', () => {
  const body = fn('submitVerification');
  assert.match(body, /files\.slice\(0, 2\)/);
  assert.match(body, /Authorization: 'Bearer ' \+ token/);
  assert.match(body, /'X-Lang': currentLang/);
  assert.match(body, /consent.*checked \? 'true' : 'false'/);
  assert.match(html, /<input type="checkbox" name="consent" required>/, 'case de consentement obligatoire');
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/, 'seuls les formats acceptés par le serveur');
  assert.match(fn('vfKindChanged'), /f\.reference\.required = kind === 'business'/, 'numéro obligatoire pour un professionnel');
});

test('onglets : l\'ordre des boutons du tableau de bord et de l\'administration suit les tableaux de noms', () => {
  const dashButtons = [...html.match(/<div class="tabs">[\s\S]*?<\/div>\s*<div id="dash-tab-content">/)[0].matchAll(/dashTab\('([a-z-]+)'\)/g)].map(m => m[1]);
  const dashNames = html.match(/\[('mes-annonces'[^\]]*)\]\[i\] === tab/)[1].match(/'([a-z-]+)'/g).map(x => x.slice(1, -1));
  assert.deepEqual(dashButtons, dashNames);
  const adminButtons = [...html.match(/<div class="tabs" id="admin-tabs">[\s\S]*?<\/div>/)[0].matchAll(/adminTab\('([a-z]+)'\)/g)].map(m => m[1]);
  const adminNames = html.match(/const ADMIN_TABS = \[([^\]]*)\]/)[1].match(/'([a-z]+)'/g).map(x => x.slice(1, -1));
  assert.deepEqual(adminButtons, adminNames);
  assert.ok(adminNames.includes('verifications'));
  assert.match(html, /verifications: \(\) => adminLoadVerifications\(\)/);
});

test('l\'administration charge les justificatifs avec le jeton (blob) et ne les met pas dans le HTML', () => {
  const body = fn('adminLoadVerifications');
  assert.match(body, /Authorization: 'Bearer ' \+ token/);
  assert.match(body, /URL\.createObjectURL/);
  assert.match(body, /URL\.revokeObjectURL/, 'URL locales libérées au rechargement');
  assert.doesNotMatch(body, /src="\$\{API\}/, 'aucune URL de justificatif dans le HTML (il faut le jeton)');
});

test('politique de confidentialité : section sur la vérification, dans les deux langues, avec suppression et consentement', () => {
  assert.match(html, /data-i18n="priv_h8"/);
  assert.match(html, /data-i18n="priv_p8"/);
  assert.match(T.fr.priv_p8, /supprimés dès la décision/);
  assert.match(T.fr.priv_p8, /consentement/);
  assert.match(T.ar.priv_p8, /تُحذف فور اتخاذ القرار/);
  assert.match(T.ar.priv_p8, /موافقتك/);
  assert.notEqual(T.fr.priv_sub, 'Dernière mise à jour : 1er janvier 2026', 'date de mise à jour actualisée');
});

test('le texte de consentement du formulaire annonce la suppression du document', () => {
  assert.match(T.fr.vf_consent, /supprimé dès la décision/);
  assert.match(T.ar.vf_consent, /ستُحذف فور اتخاذ القرار/);
});
