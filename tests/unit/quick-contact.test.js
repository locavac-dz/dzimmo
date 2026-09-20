// Appel et WhatsApp en un clic sur la fiche annonce : lecture des numéros algériens et rendu des boutons.
// Le code testé est celui de public/index.html, extrait et exécuté tel quel (aucun navigateur nécessaire).
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
const fn = name => html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0];

// Contexte minimal : T() renvoie la clé, annonceUrl() une URL fixe, currentUser réglable
function sandbox(currentUser = null, lang = 'fr') {
  const T = key => ({ det_call: 'Appeler', det_whatsapp: 'WhatsApp', det_wa_msg: 'Bonjour {title} {url}' })[key] || key;
  const ctx = { T, currentUser, annonceUrl: (id, title) => `https://dzimmo.dz/annonce/${id}-x`, encodeURIComponent };
  vm.createContext(ctx);
  vm.runInContext(fn('parsePhoneDZ') + fn('quickContactHTML'), ctx);
  return ctx;
}
const { parsePhoneDZ } = sandbox();

test('numéros mobiles : tous les écrits usuels donnent la même identité', () => {
  for (const raw of ['0555123456', '0555 12 34 56', '05 55 12 34 56', '0555-12-34-56', '0555.12.34.56', '+213555123456', '+213 555 12 34 56',
                     '+213 0555 12 34 56', '00213555123456', '00 213 555 12 34 56', '213555123456', ' (0555) 12 34 56 '])
    assert.deepEqual({ ...parsePhoneDZ(raw) }, { intl: '213555123456', mobile: true, national: '0555 12 34 56' }, raw);
});

test('préfixes mobiles 05, 06 et 07 acceptés', () => {
  assert.equal(parsePhoneDZ('0661234567').intl, '213661234567');
  assert.equal(parsePhoneDZ('0771234567').intl, '213771234567');
  assert.equal(parsePhoneDZ('0771234567').national, '0771 23 45 67');
  assert.equal(parsePhoneDZ('0551234567').mobile, true);
});

test('lignes fixes : appel possible, pas de WhatsApp', () => {
  const alger = parsePhoneDZ('021 12 34 56');
  assert.deepEqual({ ...alger }, { intl: '21321123456', mobile: false, national: '021 12 34 56' });
  assert.equal(parsePhoneDZ('+213 41 12 34 56').mobile, false);
  assert.equal(parsePhoneDZ('041123456').national, '041 12 34 56');
  assert.equal(parsePhoneDZ('0331234567'), null, 'fixe : 8 chiffres après le 0, pas 9');
});

test('valeurs inexploitables : aucun bouton', () => {
  for (const raw of [null, undefined, '', '   ', 'abc', 'tél. —', '0555', '055512345', '05551234567', '0855123456', '0155123456', '+33612345678', '+1 555 123 4567',
                     '00 33 6 12 34 56 78', '+213', '0', '213', '+213 999 12 34 56', '0455 123'])
    assert.equal(parsePhoneDZ(raw), null, String(raw));
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
