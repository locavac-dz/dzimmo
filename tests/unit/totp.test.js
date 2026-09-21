// TOTP (server/totp.js) : vecteurs officiels de la RFC 6238 (SHA-1), base32, fenêtre de tolérance, adresse du QR.
const test   = require('node:test');
const assert = require('node:assert/strict');
const totp   = require('../../server/totp');

// Secret ASCII de la RFC 6238 (« 12345678901234567890 ») en base32
const RFC_SECRET = totp.base32(Buffer.from('12345678901234567890'));

test('RFC 6238 : les codes de référence (SHA-1, 8 chiffres tronqués à 6) sont retrouvés', () => {
  // Valeurs de l'annexe B (8 chiffres) : on compare leurs 6 derniers chiffres
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
                   [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [seconds, eight] of vectors)
    assert.equal(totp.code(RFC_SECRET, Math.floor(seconds / totp.STEP)), eight.slice(-6), `t=${seconds}`);
});

test('base32 : aller-retour, minuscules, espaces et tirets ignorés, caractère invalide refusé', () => {
  const raw = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 128, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25]);
  assert.deepEqual(totp.unbase32(totp.base32(raw)), raw);
  assert.equal(totp.base32(Buffer.from('foobar')), 'MZXW6YTBOI');   // vecteur RFC 4648
  assert.equal(totp.unbase32('mzxw 6ytb-oi').toString(), 'foobar');
  assert.throws(() => totp.unbase32('MZXW1'), /base32/);
});

test('secret : 160 bits, alphabet base32, différent à chaque appel', () => {
  const a = totp.generateSecret(), b = totp.generateSecret();
  assert.match(a, /^[A-Z2-7]{32}$/);
  assert.notEqual(a, b);
  assert.equal(totp.unbase32(a).length, 20);
});

test('fenêtre : le pas courant et ses voisins immédiats sont acceptés, pas au-delà ; le pas est renvoyé', () => {
  const t = 1700000000000, now = totp.stepAt(t);
  for (const d of [-1, 0, 1]) assert.equal(totp.match(RFC_SECRET, totp.code(RFC_SECRET, now + d), t), now + d, `pas ${d}`);
  for (const d of [-2, 2, 10]) assert.equal(totp.match(RFC_SECRET, totp.code(RFC_SECRET, now + d), t), null, `pas ${d}`);
});

test('saisie : espaces tolérés (« 123 456 »), tout ce qui n\'est pas 6 chiffres est refusé', () => {
  const t = 1700000000000, good = totp.code(RFC_SECRET, totp.stepAt(t));
  assert.notEqual(totp.match(RFC_SECRET, `${good.slice(0, 3)} ${good.slice(3)}`, t), null);
  for (const bad of ['', '12345', '1234567', 'abcdef', '12345a', null, undefined, {}, [], 123456.5])
    assert.equal(totp.match(RFC_SECRET, bad, t), null, String(bad));
});

test('adresse du QR : émetteur, compte et secret encodés ; groupes de 4 pour la saisie à la main', () => {
  const u = totp.uri('ABCDEFGH', 'karim+test@exemple.dz');
  assert.match(u, /^otpauth:\/\/totp\/DzImmo%3Akarim%2Btest%40exemple\.dz\?secret=ABCDEFGH&issuer=DzImmo&/);
  assert.match(u, /digits=6&period=30$/);
  assert.equal(totp.pretty('ABCDEFGHIJ'), 'ABCD EFGH IJ');
  assert.equal(totp.pretty('ABCD'), 'ABCD');
});
