// Double authentification des comptes (TOTP) : secret chiffré, contrôle des essais, codes de secours, politique d'accès à l'administration.
// Les fonctions cryptographiques pures sont dans server/totp.js.
//
//  - Un compte qui a activé la double authentification reçoit, après son mot de passe (ou Google), un « jeton de défi » de 5 minutes
//    (signé avec une clé dérivée : il n'ouvre AUCUNE route, seule POST /api/auth/2fa/login l'accepte) ; le code donne la vraie session,
//    marquée `mfa: true`.
//  - Administration : refusée à une session sans `mfa` dès que le compte a activé la double authentification, et — avec
//    ADMIN_2FA_REQUIRED (par défaut en production) — tant qu'un administrateur ne l'a pas activée.
//  - Essais comptés AVANT la vérification (UPDATE atomique) : 5 essais, puis verrou de 15 minutes, même sous requêtes simultanées.
//  - Un code TOTP ne sert qu'une fois (totp_last_step) ; un code de secours non plus (retiré de totp_recovery).
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const db     = require('./db');
const totp   = require('./totp');

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const CHALLENGE_TTL = '5m';
const RECOVERY_COUNT = 10;
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // sans i, l, o, 0, 1 : lisibles à la main

// Clés dérivées de JWT_SECRET, une par usage : aucune ne peut servir à la place d'une autre.
const key = label => crypto.createHmac('sha256', String(process.env.JWT_SECRET)).update('dzimmo:' + label).digest();

// ── Politique ─────────────────────────────────────────
function required(env = process.env) {
  const v = String(env.ADMIN_2FA_REQUIRED ?? '').trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return env.NODE_ENV === 'production';
}

// null si la session peut administrer, sinon la raison : 'mfa' (code à saisir) ou 'setup' (double authentification à configurer)
function adminBlock(user, payload, env = process.env) {
  if (user.totp_enabled_at) return payload && payload.mfa === true ? null : 'mfa';
  return required(env) ? 'setup' : null;
}

// ── Secret chiffré au repos (AES-256-GCM) ─────────────
function encrypt(secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key('totp-secret'), iv);
  const ct = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map(b => b.toString('base64')).join('.');
}
function decrypt(stored) {
  const [iv, tag, ct] = String(stored).split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key('totp-secret'), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// ── Jeton de défi ─────────────────────────────────────
const challengeToken = user => jwt.sign({ id: user.id, purpose: 'mfa' }, key('mfa-challenge'), { expiresIn: CHALLENGE_TTL });
function readChallenge(token) {
  try {
    const p = jwt.verify(String(token), key('mfa-challenge'));
    return p.purpose === 'mfa' ? p : null;
  } catch { return null; }
}

// ── Codes de secours ──────────────────────────────────
function generateRecoveryCodes(n = RECOVERY_COUNT) {
  return Array.from({ length: n }, () => {
    const s = Array.from(crypto.randomBytes(10), b => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
const normalizeRecovery = c => String(c ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecovery = c => crypto.createHmac('sha256', key('recovery')).update(normalizeRecovery(c)).digest('hex');

// ── Contrôle d'un code ────────────────────────────────
// Réserve un essai (atomique). null = verrouillé. Après un verrou expiré, le compteur repart de 1.
async function reserveAttempt(userId) {
  const next = 'CASE WHEN totp_locked_until IS NULL THEN totp_failures + 1 ELSE 1 END';
  const r = await db.pool.query(
    `UPDATE users SET totp_failures = ${next},
                      totp_locked_until = CASE WHEN ${next} >= $2 THEN NOW() + make_interval(mins => $3) ELSE NULL END
      WHERE id = $1 AND (totp_locked_until IS NULL OR totp_locked_until <= NOW())
      RETURNING totp_failures`, [userId, MAX_ATTEMPTS, LOCK_MINUTES]);
  return r.rowCount === 1;
}

// user : ligne complète du compte. Résultat : { ok, method?: 'totp' | 'recovery', left?, locked? }
async function check(user, input) {
  if (!(await reserveAttempt(user.id))) return { ok: false, locked: true };
  const given = String(input ?? '').trim();
  if (/^\d[\d\s]{5,7}$/.test(given)) {
    if (!user.totp_secret) return { ok: false };
    const step = totp.match(decrypt(user.totp_secret), given);
    if (step === null) return { ok: false };
    // Le pas doit être strictement postérieur au dernier accepté : un code déjà utilisé (ou volé et rejoué) est refusé
    const r = await db.pool.query(
      `UPDATE users SET totp_last_step = $2, totp_failures = 0, totp_locked_until = NULL
        WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`, [user.id, step]);
    return r.rowCount === 1 ? { ok: true, method: 'totp' } : { ok: false };
  }
  const rec = normalizeRecovery(given);
  if (/^[a-z0-9]{10}$/.test(rec)) {
    const h = hashRecovery(rec);
    const r = await db.pool.query(
      `UPDATE users SET totp_recovery = array_remove(totp_recovery, $2), totp_failures = 0, totp_locked_until = NULL
        WHERE id = $1 AND $2 = ANY(totp_recovery) RETURNING cardinality(totp_recovery) AS left`, [user.id, h]);
    return r.rowCount === 1 ? { ok: true, method: 'recovery', left: r.rows[0].left } : { ok: false };
  }
  return { ok: false };
}

// Remplace les codes de secours ; renvoie les codes en clair (affichés une seule fois, jamais stockés)
async function renewRecovery(userId) {
  const codes = generateRecoveryCodes();
  await db.pool.query('UPDATE users SET totp_recovery = $2 WHERE id = $1', [userId, codes.map(hashRecovery)]);
  return codes;
}

module.exports = {
  required, adminBlock, encrypt, decrypt, challengeToken, readChallenge,
  generateRecoveryCodes, hashRecovery, normalizeRecovery, check, renewRecovery,
  MAX_ATTEMPTS, LOCK_MINUTES, RECOVERY_COUNT,
};
