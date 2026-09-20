const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../db');
const mailer = require('../mailer');

function sign(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, is_agent: user.is_agent, is_admin: user.is_admin || false },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
}

function safe(u) {
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    is_agent: u.is_agent, is_admin: u.is_admin || false,
    bio: u.bio || '', avatar: u.avatar || '',
    email_verified: u.email_verified || false,
    verified_kind: u.verified_kind || null,
    created_at: u.created_at,
  };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Nom, email et mot de passe obligatoires.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Adresse email invalide.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  const existing = await db.users.findOne({ email: email.toLowerCase().trim() });
  if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé.' });
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const user = await db.users.insert({
    name: name.trim(), email: email.toLowerCase().trim(),
    password: await bcrypt.hash(password, 10),
    phone: phone || null, is_agent: false, lang: req.lang,
    email_verified: false, verification_token: verificationToken,
  });
  const baseUrl = process.env.APP_URL || 'http://localhost:3001';
  mailer.mailVerifyEmail({ name: user.name, email: user.email, lang: user.lang, verifyUrl: `${baseUrl}/api/auth/verify-email?token=${verificationToken}` });
  mailer.mailWelcome({ name: user.name, email: user.email, lang: user.lang });
  res.status(201).json({ token: sign(user), user: safe(user) });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  const user = await db.users.findOne({ email: email.toLowerCase().trim() });
  if (!user || !await bcrypt.compare(password, user.password))
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  if (user.banned)
    return res.status(403).json({ error: 'Ce compte a été suspendu. Contactez le support.' });
  if (req.langExplicit && user.lang !== req.lang) await db.pool.query('UPDATE users SET lang = $1 WHERE id = $2', [req.lang, user.id]);
  res.json({ token: sign(user), user: safe(user) });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const user = await db.users.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json(safe(user));
});

// PUT /api/auth/profile
router.put('/profile', require('../middleware/auth'), async (req, res) => {
  const { name, phone, bio, avatar } = req.body;
  const changes = {};
  if (name   !== undefined) changes.name   = name.trim();
  if (phone  !== undefined) changes.phone  = phone.trim() || null;
  if (bio    !== undefined) changes.bio    = bio.trim();
  if (avatar !== undefined) changes.avatar = avatar.trim();
  if (!Object.keys(changes).length)
    return res.status(400).json({ error: 'Aucun champ à modifier.' });
  await db.users.update({ id: req.user.id }, changes);
  const updated = await db.users.findById(req.user.id);
  res.json(safe(updated));
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis.' });
  const user = await db.users.findOne({ email: email.toLowerCase().trim() });
  if (!user) return res.json({ ok: true }); // anti-énumération
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await db.pool.query(
    'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [user.id, token, expires]
  );
  const baseUrl = process.env.APP_URL || 'http://localhost:3001';
  // Langue du site au moment de la demande, sinon celle enregistrée pour le compte
  mailer.mailPasswordReset({ name: user.name, email: user.email, lang: req.langExplicit ? req.lang : user.lang, resetUrl: `${baseUrl}/#reset_token=${token}` });
  res.json({ ok: true });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token et mot de passe requis.' });
  if (password.length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  const r = await db.pool.query(
    `SELECT * FROM password_reset_tokens WHERE token = $1 AND used = false AND expires_at > NOW()`,
    [token]
  );
  if (!r.rows[0]) return res.status(400).json({ error: 'Lien invalide ou expiré.' });
  const { user_id, id: tokenId } = r.rows[0];
  await db.users.update({ id: user_id }, { password: await bcrypt.hash(password, 10) });
  await db.pool.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [tokenId]);
  res.json({ ok: true });
});

// GET /api/auth/verify-email?token=xxx
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') return res.redirect('/?verify=invalid');
  const user = await db.users.findOne({ verification_token: token });
  if (!user) return res.redirect('/?verify=invalid');
  await db.users.update({ id: user.id }, { email_verified: true, verification_token: null });
  res.redirect('/?verify=ok');
});

// DELETE /api/auth/me — suppression de compte (RGPD)
router.delete('/me', require('../middleware/auth'), async (req, res) => {
  const uid = req.user.id;
  await require('../verification').purgeUser(uid);   // justificatifs en attente : supprimés avec le compte
  await db.pool.query('DELETE FROM messages WHERE from_id = $1 OR to_id = $1', [uid]);
  await db.pool.query('DELETE FROM favorites WHERE user_id = $1', [uid]);
  await db.pool.query('DELETE FROM contact_requests WHERE user_id = $1', [uid]);
  await db.pool.query('DELETE FROM properties WHERE owner_id = $1', [uid]);
  await db.pool.query('DELETE FROM users WHERE id = $1', [uid]);
  res.json({ ok: true });
});

// GET /api/auth/users/:id — profil public
router.get('/users/:id', async (req, res) => {
  const user = await db.users.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const property_count = await db.properties.count({ owner_id: user.id, status: 'active' });
  res.json({
    id: user.id, name: user.name, bio: user.bio || '',
    avatar: user.avatar || '', is_agent: user.is_agent,
    verified_kind: user.verified_kind || null,
    created_at: user.created_at,
    property_count,
  });
});

module.exports = router;
