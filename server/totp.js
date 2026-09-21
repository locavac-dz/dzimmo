// TOTP (RFC 6238) sans dépendance : HMAC-SHA1, 6 chiffres, pas de 30 s, compatible Google Authenticator, Microsoft Authenticator,
// Aegis, 2FAS, FreeOTP… Fonctions pures (ni base ni horloge cachée) : le contrôle des essais est dans server/two-factor.js.
const crypto = require('crypto');

const STEP = 30;          // secondes
const DIGITS = 6;
const WINDOW = 1;         // un pas de tolérance de chaque côté (dérive d'horloge du téléphone)
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';   // base32 (RFC 4648)

function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of String(str).toUpperCase().replace(/[\s=-]/g, '')) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('[totp] base32 invalide');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// 160 bits, la taille recommandée pour HMAC-SHA1
const generateSecret = () => base32(crypto.randomBytes(20));

const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP);

function code(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

// Pas correspondant au code saisi (dans la fenêtre de tolérance), ou null. Comparaison en temps constant.
function match(secret, input, ms = Date.now()) {
  const given = String(input ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const now = stepAt(ms);
  let found = null;
  for (let s = now - WINDOW; s <= now + WINDOW; s++) {
    const a = Buffer.from(code(secret, s)), b = Buffer.from(given);
    if (crypto.timingSafeEqual(a, b) && found === null) found = s;
  }
  return found;
}

// Adresse à scanner (QR) ou à ouvrir : otpauth://totp/DzImmo:<compte>?secret=…&issuer=DzImmo
function uri(secret, account, issuer = 'DzImmo') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
}

// Secret affiché par groupes de 4 pour la saisie à la main
const pretty = secret => secret.replace(/(.{4})(?=.)/g, '$1 ');

module.exports = { generateSecret, code, match, stepAt, uri, pretty, base32, unbase32, STEP, DIGITS, WINDOW };
