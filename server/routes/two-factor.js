// Double authentification (TOTP) : POST /api/auth/2fa/login (défi après le mot de passe), GET / (état), POST /setup, /enable,
// /disable, /recovery-codes. Logique et politique : server/two-factor.js ; cryptographie : server/totp.js.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const qrcode = require('qrcode-generator');
const db     = require('../db');
const mailer = require('../mailer');
const totp   = require('../totp');
const tf     = require('../two-factor');
const auth   = require('../middleware/auth');
const { isRevoked, revokeSessions } = require('../sessions');
const { sign, safe } = require('../tokens');

const notice = (user, event) => mailer.mailSecurityNotice({ to: user.email, name: user.name, lang: user.lang, event });

// Le code (6 chiffres ou code de secours) est du texte court ; tout le reste est refusé avant de compter un essai
const validCode = c => typeof c === 'string' && c.trim().length > 0 && c.length <= 32;

// Réponse commune à un code refusé ou à un compte verrouillé
function refuse(res, r) {
  if (r.locked) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  return res.status(401).json({ error: 'Code de vérification incorrect.' });
}

// Le rôle vient de la base, jamais de req.user : un administrateur dont la double authentification n'est pas encore configurée
// n'est pas « admin » pour les autres routes (middleware auth), mais doit pouvoir la configurer ici.
async function adminAccount(req, res) {
  const user = await db.users.findById(req.user.id);
  if (!user || !user.is_admin) {
    res.status(403).json({ error: 'La double authentification est réservée aux administrateurs.' });
    return null;
  }
  return user;
}

// POST /api/auth/2fa/login — { mfa_token, code } : deuxième étape de la connexion
router.post('/login', async (req, res) => {
  const { mfa_token, code } = req.body;
  if (typeof mfa_token !== 'string' || !validCode(code))
    return res.status(400).json({ error: 'Code de vérification requis.' });
  const expired = () => res.status(401).json({ error: 'Connexion expirée. Reconnectez-vous.' });
  const challenge = tf.readChallenge(mfa_token);
  if (!challenge) return expired();
  const user = await db.users.findById(challenge.id);
  if (!user || !user.totp_enabled_at || isRevoked(challenge, user)) return expired();
  if (user.banned) return res.status(403).json({ error: 'Ce compte a été suspendu. Contactez le support.' });

  const r = await tf.check(user, code);
  if (!r.ok) return refuse(res, r);
  if (r.method === 'recovery') notice(user, 'recovery');
  if (req.langExplicit && user.lang !== req.lang) await db.pool.query('UPDATE users SET lang = $1 WHERE id = $2', [req.lang, user.id]);
  res.json({ token: sign(user, { mfa: true }), user: safe(user), ...(r.method === 'recovery' ? { recovery_left: r.left } : {}) });
});

// GET /api/auth/2fa — état pour l'écran « Sécurité »
router.get('/', auth, async (req, res) => {
  const user = await adminAccount(req, res);
  if (!user) return;
  res.json({ enabled: !!user.totp_enabled_at, required: tf.required(), recovery_left: user.totp_enabled_at ? user.totp_recovery.length : 0 });
});

// POST /api/auth/2fa/setup — génère un secret en attente (rien n'est protégé tant que /enable n'a pas reçu un premier code valide)
router.post('/setup', auth, async (req, res) => {
  const user = await adminAccount(req, res);
  if (!user) return;
  if (user.totp_enabled_at) return res.status(409).json({ error: 'La double authentification est déjà activée.' });
  const secret = totp.generateSecret();
  await db.users.update({ id: user.id }, { totp_secret: tf.encrypt(secret) });
  const uri = totp.uri(secret, user.email);
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  res.json({ secret: totp.pretty(secret), uri, qr_svg: qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true }) });
});

// POST /api/auth/2fa/enable — { code } : premier code valide → activation, codes de secours (montrés une seule fois),
// autres sessions fermées, nouvelle session déjà validée
router.post('/enable', auth, async (req, res) => {
  const user = await adminAccount(req, res);
  if (!user) return;
  if (user.totp_enabled_at) return res.status(409).json({ error: 'La double authentification est déjà activée.' });
  if (!user.totp_secret) return res.status(400).json({ error: 'Lancez d\'abord la configuration de la double authentification.' });
  if (!validCode(req.body.code)) return res.status(400).json({ error: 'Code de vérification requis.' });
  const r = await tf.check(user, req.body.code);
  if (!r.ok || r.method !== 'totp') return refuse(res, r.ok ? { ok: false } : r);

  const won = await db.pool.query('UPDATE users SET totp_enabled_at = NOW() WHERE id = $1 AND totp_enabled_at IS NULL', [user.id]);
  if (won.rowCount !== 1) return res.status(409).json({ error: 'La double authentification est déjà activée.' });   // deux activations simultanées
  const codes = await tf.renewRecovery(user.id);
  await revokeSessions(user.id);
  const fresh = await db.users.findById(user.id);
  notice(fresh, 'enabled');
  res.json({ token: sign(fresh, { mfa: true }), user: safe(fresh), recovery_codes: codes });
});

// POST /api/auth/2fa/disable — { password, code } : mot de passe (sauf compte Google) ET code valide
router.post('/disable', auth, async (req, res) => {
  const user = await adminAccount(req, res);
  if (!user) return;
  if (!user.totp_enabled_at) return res.status(409).json({ error: 'La double authentification n\'est pas activée.' });
  const { password, code } = req.body;
  if (!validCode(code)) return res.status(400).json({ error: 'Code de vérification requis.' });
  if (!user.google_id && (typeof password !== 'string' || !await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  const r = await tf.check(user, code);
  if (!r.ok) return refuse(res, r);

  await db.pool.query(
    `UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_recovery = '{}',
                      totp_failures = 0, totp_locked_until = NULL WHERE id = $1`, [user.id]);
  await revokeSessions(user.id);
  const fresh = await db.users.findById(user.id);
  notice(fresh, 'disabled');
  res.json({ token: sign(fresh), user: safe(fresh) });
});

// POST /api/auth/2fa/recovery-codes — { code } : nouveaux codes de secours (les anciens cessent de fonctionner)
router.post('/recovery-codes', auth, async (req, res) => {
  const user = await adminAccount(req, res);
  if (!user) return;
  if (!user.totp_enabled_at) return res.status(409).json({ error: 'La double authentification n\'est pas activée.' });
  if (!validCode(req.body.code)) return res.status(400).json({ error: 'Code de vérification requis.' });
  const r = await tf.check(user, req.body.code);
  if (!r.ok) return refuse(res, r);
  const codes = await tf.renewRecovery(user.id);
  notice(user, 'codes');
  res.json({ recovery_codes: codes });
});

module.exports = router;
