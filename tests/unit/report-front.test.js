// Signalement d'une annonce (côté site) : motifs identiques à ceux du serveur, chaînes dans les deux langues, aucune donnée dans un onclick.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { readFront } = require('../helpers/front');
const { MOTIFS } = require('../../server/reports');

const html = readFront();

test('les motifs proposés sont exactement ceux que le serveur accepte', () => {
  const list = html.match(/const REPORT_MOTIFS = \[([^\]]*)\]/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(list, MOTIFS);
});

test('chaque chaîne du signalement existe en français ET en arabe', () => {
  const keys = ['rp_btn', 'rp_login', 'rp_title', 'rp_intro', 'rp_choose', 'rp_motif', 'rp_message', 'rp_send', 'rp_need_motif', 'rp_thanks',
    ...MOTIFS.map(m => 'rp_m_' + m)];
  const fr = html.indexOf('const TRANSLATIONS');
  const ar = html.indexOf('\n  ar: {', fr);
  assert.ok(fr > -1 && ar > fr, 'TRANSLATIONS introuvable');
  for (const k of keys) {
    assert.ok(html.slice(fr, ar).includes(`${k}:`), `${k} manquant en français`);
    assert.ok(html.slice(ar).includes(`${k}:`), `${k} manquant en arabe`);
  }
});

test('la modale existe et le bouton n\'embarque aucune donnée de l\'annonce dans son onclick', () => {
  assert.match(html, /id="modal-report"/);
  assert.match(html, /id="report-motif"/);
  assert.match(html, /onclick="openReport\(this\.dataset\.id\)"/);
  assert.doesNotMatch(html, /openReport\(\$\{/);
});

test('le bouton est réservé aux annonces publiées et masqué à leur propriétaire', () => {
  const at = html.indexOf('openReport(this.dataset.id)');
  const around = html.slice(at - 260, at);
  assert.match(around, /p\.status === 'active'/);
  assert.match(around, /currentUser\.id === p\.owner_id/);
});
