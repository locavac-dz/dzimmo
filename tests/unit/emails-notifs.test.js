// Gabarits d'emails et textes de notifications : français et arabe, sans SMTP ni base de données.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const SERVER = path.join(__dirname, '..', '..', 'server');
const { build } = require(path.join(SERVER, 'mailer'));
const { notif, translateReason, NOTIFS, REASONS_AR } = require(path.join(SERVER, 'messages'));

const textOf = html => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
const ARABIC = /[؀-ۿ]/;

// Un jeu de données par gabarit (valeurs latines neutres : aucun mot français à confondre avec le gabarit)
const SAMPLES = {
  buildWelcome:            { name: 'Karim' },
  buildVerifyEmail:        { name: 'Karim', verifyUrl: 'https://dzimmo.dz/v?token=abc&x=1' },
  buildPasswordReset:      { name: 'Karim', resetUrl: 'https://dzimmo.dz/#reset_token=abc' },
  buildContactRequest:     { ownerName: 'Karim', requesterName: 'Sara', propertyTitle: 'Villa X', type: 'offre', message: 'Hello', visitDate: '2026-10-01', offerAmount: 25000000 },
  buildNewMessage:         { senderName: 'Sara', propertyTitle: 'Villa X', preview: 'Hello there' },
  buildSearchAlert:        { name: 'Karim', properties: [{ title: 'Villa X', wilaya: 'Oran', price: 5000000 }], alertCriteria: { wilaya: 'Oran', mode: 'vente', type_bien: 'villa' } },
  buildModerationDecision: { name: 'Karim', propertyTitle: 'Villa X', approved: false, reason: 'Photos absentes ou de mauvaise qualité — Retirez le numéro', url: 'https://dzimmo.dz/annonce/1' },
  buildAdminPending:       { ownerName: 'Karim', propertyTitle: 'Villa X', url: 'https://dzimmo.dz/' },
  buildVerificationDecision:      { name: 'Karim', kind: 'identity', approved: false, reason: 'Document expiré — Carte périmée en 2024', url: 'https://dzimmo.dz/' },
  buildAdminVerificationPending:  { ownerName: 'Karim', kind: 'business', url: 'https://dzimmo.dz/' },
  buildExpiryReminder:            { name: 'Karim', propertyTitle: 'Villa X', days: 30, graceDays: 14, confirmUrl: 'https://dzimmo.dz/annonce/1-villa?renew=abc' },
  buildListingExpired:            { name: 'Karim', propertyTitle: 'Villa X', renewUrl: 'https://dzimmo.dz/annonce/1-villa?renew=abc' },
};

test('chaque gabarit d\'email existe et est couvert par un jeu de données', () => {
  assert.deepEqual(Object.keys(build).sort(), Object.keys(SAMPLES).sort());
});

test('emails en arabe : sujet et corps en arabe, page en écriture de droite à gauche', () => {
  for (const [name, data] of Object.entries(SAMPLES)) {
    const { subject, html } = build[name]('ar', data);
    assert.match(subject, ARABIC, `${name} : sujet`);
    assert.match(textOf(html), ARABIC, `${name} : corps`);
    assert.match(html, /<html lang="ar" dir="rtl">/, `${name} : lang/dir`);
    assert.match(html, /direction:rtl;text-align:right/, `${name} : direction`);
  }
});

test('emails en arabe : aucun mot de gabarit français ne subsiste', () => {
  const FRENCH = /\b(Bonjour|Votre|votre|vous|Cliquez|Voir|Répondre|Découvrir|Confirmer|valable|heures?|annonces?|Merci|Bienvenue|espace|message)\b/;
  for (const [name, data] of Object.entries(SAMPLES)) {
    const { subject, html } = build[name]('ar', data);
    const visible = textOf(html).replace(/Villa X|Karim|Sara|Hello there|Hello|DzImmo/g, ' ');
    assert.doesNotMatch(subject.replace(/Villa X|Karim|Sara|DzImmo/g, ' '), FRENCH, `${name} : sujet`);
    assert.doesNotMatch(visible, FRENCH, `${name} : corps → « ${(visible.match(FRENCH) || [''])[0]} »`);
  }
});

test('emails en français : wording historique conservé (dir ltr)', () => {
  assert.equal(build.buildWelcome('fr', { name: 'K' }).subject, '🏠 Bienvenue sur DzImmo !');
  assert.equal(build.buildVerifyEmail('fr', SAMPLES.buildVerifyEmail).subject, '✅ Confirmez votre adresse email — DzImmo');
  assert.equal(build.buildPasswordReset('fr', SAMPLES.buildPasswordReset).subject, '🔑 Réinitialisation de votre mot de passe — DzImmo');
  assert.equal(build.buildContactRequest('fr', SAMPLES.buildContactRequest).subject, '📩 Offre de prix — Villa X');
  assert.equal(build.buildNewMessage('fr', SAMPLES.buildNewMessage).subject, '💬 Nouveau message de Sara');
  assert.equal(build.buildModerationDecision('fr', { ...SAMPLES.buildModerationDecision, approved: true }).subject, '✅ Votre annonce est publiée — Villa X');
  assert.match(build.buildWelcome('fr', { name: 'K' }).html, /<html lang="fr" dir="ltr">/);
  assert.match(build.buildWelcome('fr', { name: 'K' }).html, /Bienvenue, K/);
  // sans langue (ancien appelant) : français
  assert.match(build.buildWelcome(undefined, { name: 'K' }).html, /lang="fr"/);
});

test('emails : les données saisies par les utilisateurs sont échappées (pas d\'injection HTML)', () => {
  const evil = '<script>alert(1)</script>';
  for (const lang of ['fr', 'ar']) {
    for (const [name, data] of Object.entries(SAMPLES)) {
      const dirty = JSON.parse(JSON.stringify(data));
      for (const k of ['name', 'ownerName', 'requesterName', 'propertyTitle', 'senderName', 'preview', 'message', 'reason'])
        if (k in dirty) dirty[k] = evil;
      if (dirty.properties) dirty.properties[0].title = evil;
      assert.doesNotMatch(build[name](lang, dirty).html, /<script>alert/, `${name} (${lang})`);
    }
  }
});

test('alerte : pluriel arabe (1, 2, 3-10, 11+) et noms de wilaya / mode / type en arabe', () => {
  const sub = n => build.buildSearchAlert('ar', { name: 'K', properties: Array.from({ length: n }, () => ({ title: 'T', wilaya: 'Oran', price: 1 })), alertCriteria: {} }).subject;
  assert.match(sub(1), /1 إعلان جديد/);
  assert.match(sub(2), /2 إعلانان جديدان/);
  assert.match(sub(5), /5 إعلانات جديدة/);
  assert.match(sub(11), /11 إعلاناً جديداً/);
  const full = build.buildSearchAlert('ar', SAMPLES.buildSearchAlert);
  assert.match(full.subject, /وهران · بيع · فيلا/);
  assert.match(textOf(full.html), /5\s?000\s?000 د\.ج/);
  assert.match(build.buildSearchAlert('ar', { name: 'K', properties: [{ title: 'T', wilaya: 'Alger', price: 1 }], alertCriteria: {} }).subject, /جميع الولايات · جميع العمليات · جميع الأنواع/);
  assert.equal(build.buildSearchAlert('fr', { name: 'K', properties: SAMPLES.buildSearchAlert.properties, alertCriteria: {} }).subject,
    '🔔 1 nouvelle annonce — Toutes les wilayas · Tous modes · Tous types');
});

test('motif de refus : motifs proposés traduits, précision libre conservée', () => {
  const r = translateReason('Prix incohérent avec le bien — Trop cher pour 40 m²', 'ar');
  assert.equal(r, `${REASONS_AR['Prix incohérent avec le bien']} — Trop cher pour 40 m²`);
  assert.equal(translateReason('Prix incohérent avec le bien', 'fr'), 'Prix incohérent avec le bien');
  assert.equal(translateReason('Motif inventé', 'ar'), 'Motif inventé');
  assert.equal(translateReason('', 'ar'), '');
});

test('les motifs de refus de l\'interface d\'administration ont tous une traduction arabe', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
  const literal = html.match(/const MOD_REASONS = (\[[\s\S]*?\]);/)[1];
  const reasons = Array.from(vm.runInNewContext(literal));
  assert.equal(reasons.length, 6);
  assert.deepEqual(reasons.filter(r => !REASONS_AR[r]), []);
});

test('la table des motifs traduits du site est identique à celle du serveur', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
  const front = vm.runInNewContext('(' + html.match(/const MOD_REASONS_AR = (\{[\s\S]*?\n\});/)[1] + ')');
  assert.deepEqual({ ...front }, { ...REASONS_AR });
});

test('notifications : toutes les clés existent dans les deux langues, paramètres remplis', () => {
  assert.deepEqual(Object.keys(NOTIFS.fr).sort(), Object.keys(NOTIFS.ar).sort());
  for (const key of Object.keys(NOTIFS.fr)) {
    for (const lang of ['fr', 'ar']) {
      const n = notif(lang, key, { name: 'Sara', title: 'Villa X', reason: 'Motif' });
      assert.ok(n.title && n.body, `${key} (${lang})`);
      assert.doesNotMatch(n.title + n.body, /[{}]/, `${key} (${lang}) : paramètre non remplacé`);
      assert.match(n.body, /Villa X|Sara/, `${key} (${lang}) : contenu`);
    }
    assert.match(notif('ar', key, { name: 'S', title: 'T', reason: 'R' }).title, ARABIC, `${key} : titre arabe`);
  }
  assert.equal(notif('fr', 'contact_new', { name: 'Sara', title: 'Villa X' }).body, 'Sara a envoyé une demande pour « Villa X »');
  assert.equal(notif(undefined, 'contact_confirmed', { title: 'V' }).title, 'Demande confirmée !', 'langue absente : français');
});

test('les noms de wilayas arabes du serveur sont identiques à ceux du site', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
  const front = vm.runInNewContext('(' + html.match(/const WILAYAS_AR = (\{[\s\S]*?\n\});/)[1] + ')');
  assert.deepEqual({ ...require(path.join(SERVER, 'wilayas-ar')) }, { ...front });
});
