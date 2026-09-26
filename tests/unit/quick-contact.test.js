// Appel et WhatsApp en un clic sur la fiche annonce : lecture des numéros (algériens et étrangers) et rendu des boutons.
// Le code testé est celui de public/index.html, extrait et exécuté tel quel (aucun navigateur nécessaire).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');
const { readFront } = require('../helpers/front');

const html = readFront();
const fn = name => html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

// Contexte minimal : T() renvoie la clé, annonceUrl() une URL fixe, currentUser réglable
function sandbox(currentUser = null, lang = 'fr') {
  const T = key => ({ det_call: 'Appeler', det_whatsapp: 'WhatsApp', det_wa_msg: 'Bonjour {title} {url}' })[key] || key;
  const ctx = { T, currentUser, annonceUrl: (id, title) => `https://dzimmo.dz/annonce/${id}-x`, encodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext(html.match(/const COUNTRY_CODES = \[[\s\S]*?\];/)[0] + fn('parsePhone') + fn('quickContactHTML'), ctx);
  return ctx;
}
const { parsePhone } = sandbox();

test('numéros mobiles : tous les écrits usuels donnent la même identité', () => {
  for (const raw of ['0555123456', '0555 12 34 56', '05 55 12 34 56', '0555-12-34-56', '0555.12.34.56', '+213555123456', '+213 555 12 34 56',
                     '+213 0555 12 34 56', '00213555123456', '00 213 555 12 34 56', '213555123456', ' (0555) 12 34 56 '])
    assert.deepEqual({ ...parsePhone(raw) }, { intl: '213555123456', mobile: true, national: '0555 12 34 56' }, raw);
});

test('préfixes mobiles 05, 06 et 07 acceptés', () => {
  assert.equal(parsePhone('0661234567').intl, '213661234567');
  assert.equal(parsePhone('0771234567').intl, '213771234567');
  assert.equal(parsePhone('0771234567').national, '0771 23 45 67');
  assert.equal(parsePhone('0551234567').mobile, true);
});

test('lignes fixes : appel possible, pas de WhatsApp', () => {
  const alger = parsePhone('021 12 34 56');
  assert.deepEqual({ ...alger }, { intl: '21321123456', mobile: false, national: '021 12 34 56' });
  assert.equal(parsePhone('+213 41 12 34 56').mobile, false);
  assert.equal(parsePhone('041123456').national, '041 12 34 56');
  assert.equal(parsePhone('0331234567'), null, 'fixe : 8 chiffres après le 0, pas 9');
});

test('valeurs inexploitables : aucun bouton', () => {
  for (const raw of [null, undefined, '', '   ', 'abc', 'tél. —', '0555', '055512345', '05551234567', '0855123456', '0155123456',
                     '+213', '0', '213', '+213 999 12 34 56', '0455 123',
                     // étranger : sans « + » / « 00 », trop court, trop long, indicatif nul
                     '33612345678', '612345678', '+', '00', '+33', '+1234567', '+1234567890123456', '+0123456789', '+00 33 6 12 34 56 78', '+33 abc'])
    assert.equal(parsePhone(raw), null, String(raw));
});

test('numéros étrangers : « + » ou « 00 » et l\'indicatif, quel que soit le pays', () => {
  const cases = [
    ['+33 6 12 34 56 78', '33612345678', '+33 612 345 678'],
    ['0033612345678', '33612345678', '+33 612 345 678'],
    ['00 33 6 12 34 56 78', '33612345678', '+33 612 345 678'],
    ['+33 (0)6 12 34 56 78', '33612345678', '+33 612 345 678'],   // le 0 entre parenthèses ne se compose pas
    ['+33.6.12.34.56.78', '33612345678', '+33 612 345 678'],
    ['+1 (514) 555-0199', '15145550199', '+1 514 555 0199'],
    ['+1 555 123 4567', '15551234567', '+1 555 123 4567'],
    ['+212 6 12 34 56 78', '212612345678', '+212 612 345 678'],
    ['+34 612 345 678', '34612345678', '+34 612 345 678'],
    ['+44 7911 123456', '447911123456', '+44 791 112 34 56'],
    ['+971 50 123 4567', '971501234567', '+971 501 234 567'],
    ['+999 123 456 789', '999123456789', '+999 123 456 789'],      // indicatif absent de la liste : groupes de 3
  ];
  for (const [raw, intl, shown] of cases) {
    const r = parsePhone(raw);
    assert.deepEqual({ ...r }, { intl, mobile: null, national: shown }, raw);
  }
  assert.equal(parsePhone('+33612345678').mobile, null, 'mobile ou fixe : inconnu à l\'étranger');
  assert.equal(parsePhone('+12345678').intl, '12345678', '8 chiffres : limite basse acceptée');
  assert.equal(parsePhone('+123456789012345').intl, '123456789012345', '15 chiffres : limite haute acceptée');
});

test('numéro algérien avec indicatif : toujours lu comme algérien, jamais comme étranger', () => {
  assert.equal(parsePhone('+213 555 12 34 56').national, '0555 12 34 56');
  assert.equal(parsePhone('+213 (0)555 12 34 56').intl, '213555123456');
  assert.equal(parsePhone('0612345678').national, '0612 34 56 78', 'sans « + » ni « 00 », 06… est un mobile algérien');
  assert.equal(parsePhone('+213 999 12 34 56'), null, 'indicatif algérien mais numéro invalide : pas d\'étranger par défaut');
});

test('affichage : boutons Appeler + WhatsApp pour un mobile, message prérempli encodé', () => {
  const { quickContactHTML } = sandbox();
  const h = quickContactHTML({ id: 12, title: 'Villa "F5" à Oran & vue mer', status: 'active', owner_id: 5, owner_phone: '0555 12 34 56' });
  assert.match(h, /<a class="qc-call" href="tel:\+213555123456"/);
  assert.match(h, /<span class="qc-num">0555 12 34 56<\/span>/);
  assert.match(h, /<a class="qc-wa" href="https:\/\/wa\.me\/213555123456\?text=/);
  assert.match(h, /target="_blank" rel="noopener"/);
  const text = decodeURIComponent(h.match(/\?text=([^"]+)"/)[1]);
  assert.equal(text, 'Bonjour Villa "F5" à Oran & vue mer https://dzimmo.dz/annonce/12-x', 'titre et lien dans le message');
  assert.match(h.match(/href="https:\/\/wa\.me[^"]*"/)[0], /^href="https:\/\/wa\.me\/\d+\?text=[^\s"&<>]+"$/, 'lien WhatsApp sans espace, guillemet ni & bruts');
});

test('affichage : numéro étranger = Appeler et WhatsApp, numéro lisible avec l\'indicatif', () => {
  const { quickContactHTML } = sandbox();
  const h = quickContactHTML({ id: 3, title: 'Villa', status: 'active', owner_id: 5, owner_phone: '+33 (0)6 12 34 56 78' });
  assert.match(h, /<a class="qc-call" href="tel:\+33612345678"/);
  assert.match(h, /<span class="qc-num">\+33 612 345 678<\/span>/);
  assert.match(h, /<a class="qc-wa" href="https:\/\/wa\.me\/33612345678\?text=/);
  // Propriétaire à l'étranger, agence algérienne : le numéro de l'agence reste prioritaire
  const both = quickContactHTML({ id: 3, title: 'Villa', status: 'active', owner_id: 5, owner_phone: '+33 6 12 34 56 78', agency_phone: '0661 00 00 02' });
  assert.match(both, /tel:\+213661000002/);
  // Numéro d'agence illisible (« 021 XX ») : repli sur le numéro étranger du propriétaire
  assert.match(quickContactHTML({ id: 3, title: 'V', status: 'active', owner_id: 5, owner_phone: '00 44 7911 123456', agency_phone: '021 XX XX XX' }), /tel:\+447911123456/);
});

test('numéros : jamais de caractère à risque dans les liens (chiffres seulement)', () => {
  const { quickContactHTML } = sandbox();
  for (const phone of ['+33 6 12 34 56 78"><script>alert(1)</script>', '0555 12 34 56" onmouseover="alert(1)', "+33612345678'; DROP TABLE users; --"]) {
    const h = quickContactHTML({ id: 1, title: 'V', status: 'active', owner_id: 5, owner_phone: phone });
    for (const href of h.match(/href="[^"]*"/g) || []) assert.match(href, /^href="(tel:\+\d+|https:\/\/wa\.me\/\d+\?text=[^\s"&<>]+)"$/, phone);
    assert.doesNotMatch(h, /<script|onmouseover/i, phone);
  }
});

test('champs « téléphone » : ils préviennent que le numéro est affiché et expliquent le format depuis l\'étranger', () => {
  const start = html.indexOf('const TRANSLATIONS = {'), end = html.indexOf('function T(key)');
  const T = vm.runInNewContext('(' + html.slice(start, end).replace(/^const TRANSLATIONS = /, '').trim().replace(/;$/, '') + ')');
  assert.match(T.fr.m_phone_hint, /Numéro algérien/);
  assert.match(T.fr.m_phone_hint, /\+213/);
  assert.match(T.ar.m_phone_hint, /رقم جزائري/);
  assert.match(T.ar.m_phone_hint, /<bdi dir="ltr">\+213/, 'exemple isolé de droite à gauche');
  assert.match(html, /id="reg-phone"[^>]*><div class="field-hint" data-i18n-html="m_phone_hint">/, 'inscription');
  assert.match(html, /id="p-phone"[^>]*><div class="field-hint">\$\{T\('m_phone_hint'\)\}/, 'profil');
});

test('affichage : ligne fixe = Appeler seulement', () => {
  const { quickContactHTML } = sandbox();
  const h = quickContactHTML({ id: 1, title: 'Bureau', status: 'active', owner_id: 5, owner_phone: '021 12 34 56' });
  assert.match(h, /qc-call/);
  assert.doesNotMatch(h, /qc-wa|wa\.me/);
});

test('affichage : numéro de l\'agence prioritaire, celui du propriétaire en repli', () => {
  const { quickContactHTML } = sandbox();
  const base = { id: 1, title: 'Villa', status: 'active', owner_id: 5, owner_phone: '0555 00 00 01' };
  assert.match(quickContactHTML({ ...base, agency_phone: '0661 00 00 02' }), /tel:\+213661000002/);
  assert.match(quickContactHTML({ ...base, agency_phone: '+213 21 XX XX XX' }), /tel:\+213555000001/, 'numéro d\'agence illisible : repli');
  assert.match(quickContactHTML({ ...base, agency_phone: null }), /tel:\+213555000001/);
});

test('affichage : rien si annonce non active, propre annonce, ou numéro inexploitable', () => {
  const p = { id: 1, title: 'Villa', status: 'active', owner_id: 5, owner_phone: '0555 12 34 56' };
  const visiteur = sandbox().quickContactHTML;
  assert.notEqual(visiteur(p), '');
  for (const status of ['sold', 'rented', 'archived', 'pending', 'rejected']) assert.equal(visiteur({ ...p, status }), '', status);
  assert.equal(visiteur({ ...p, owner_phone: null }), '');
  assert.equal(visiteur({ ...p, owner_phone: 'pas de numéro' }), '');
  assert.equal(sandbox({ id: 5 }).quickContactHTML(p), '', 'l\'annonceur ne voit pas ses propres boutons');
  assert.notEqual(sandbox({ id: 6 }).quickContactHTML(p), '', 'un autre membre connecté les voit');
});

test('la fiche affiche les boutons avant le formulaire, sans exiger de compte ; barre fixe sur mobile', () => {
  const card = html.match(/<div class="contact-card">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>`;/)[0];
  const qc = card.indexOf('${quickContactHTML(p)}');
  assert.ok(qc > 0, 'boutons dans la carte de contact');
  assert.ok(qc < card.indexOf('${token ? `'), 'avant le bloc « connectez-vous » / formulaire');
  assert.match(html, /@media \(max-width: 768px\) \{[\s\S]*?\.quick-contact \{\s*position: fixed;/, 'barre fixée en bas sur mobile');
  assert.match(html, /#detail-content\.has-qc \{ padding-bottom: 5rem;/);
  assert.match(html, /container\.classList\.toggle\('has-qc'/);
});

test('textes des boutons : français et arabe, message WhatsApp avec titre et lien', () => {
  const start = html.indexOf('const TRANSLATIONS = {'), end = html.indexOf('function T(key)');
  const T = vm.runInNewContext('(' + html.slice(start, end).replace(/^const TRANSLATIONS = /, '').trim().replace(/;$/, '') + ')');
  for (const lang of ['fr', 'ar']) {
    for (const k of ['det_call', 'det_whatsapp', 'det_wa_msg']) assert.ok(T[lang][k], `${k} (${lang})`);
    assert.match(T[lang].det_wa_msg, /\{title\}/, lang);
    assert.match(T[lang].det_wa_msg, /\{url\}/, lang);
  }
  assert.match(T.ar.det_call, /[؀-ۿ]/);
  assert.match(T.ar.det_wa_msg, /[؀-ۿ]/, 'message arabe pour un annonceur arabophone');
});
