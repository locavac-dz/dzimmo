const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../db');
const mailer = require('../mailer');
const google = require('../google-auth');
const images = require('../images');
const { revokeSessions } = require('../sessions');
const twoFactor = require('../two-factor');
const { sign, safe } = require('../tokens');

// Emails de réinitialisation du mot de passe acceptés par compte et par heure (au-delà : réponse identique, aucun envoi)
const RESET_MAX_PER_HOUR = 3;

// Compte qui a activé la double authentification : ni jeton de session ni fiche, seulement un défi de 5 minutes à valider par
// POST /api/auth/2fa/login (server/two-factor.js). Le mot de passe (ou Google) seul ne suffit plus.
function sendSession(res, user, extra = {}) {
  if (user.totp_enabled_at) return res.json({ mfa_required: true, mfa_token: twoFactor.challengeToken(user) });
  res.json({ token: sign(user), user: safe(user), ...extra });
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
  sendSession(res, user);
});

// GET /api/auth/config — réglages publics du site (identifiant client Google : public par nature, absent = bouton masqué)
router.get('/config', (req, res) => {
  res.json({ google_client_id: process.env.GOOGLE_CLIENT_ID || null });
});

// POST /api/auth/google — { credential } : jeton d'identité fourni par le bouton « Se connecter avec Google »
// Rattachement au compte, dans cet ordre :
//  1. identifiant Google déjà connu → ce compte ;
//  2. adresse déjà inscrite → on rattache Google à ce compte. Si l'adresse n'y avait jamais été confirmée, le compte a peut-être
//     été créé par un tiers (pré-inscription de l'adresse d'autrui) : son mot de passe est remplacé et ses sessions révoquées ;
//  3. sinon → nouveau compte (adresse confirmée par Google, mot de passe aléatoire : « mot de passe oublié » permet d'en définir un).
router.post('/google', async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'Connexion Google indisponible.' });
  const credential = req.body && req.body.credential;
  if (typeof credential !== 'string' || !credential || credential.length > 4096)
    return res.status(400).json({ error: 'Jeton Google invalide.' });

  let g;
  try { g = await google.verifyIdToken(credential, clientId); }
  catch (e) { return res.status(401).json({ error: 'Jeton Google invalide.' }); }
  if (g.email_verified !== true) return res.status(401).json({ error: 'Adresse Google non vérifiée.' });

  const email = g.email.toLowerCase().trim();
  let user = null, created = false;
  for (let attempt = 0; attempt < 2 && !user; attempt++) {
    try {
      user = await db.users.findOne({ google_id: g.sub });
      if (user) break;
      const existing = await db.users.findOne({ email });
      if (existing) {
        if (existing.google_id) return res.status(409).json({ error: 'Un autre compte Google est déjà associé à cette adresse.' });
        const changes = { google_id: g.sub, email_verified: true, verification_token: null };
        if (!existing.email_verified) {
          changes.password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
          changes.sessions_valid_after = new Date(Math.floor(Date.now() / 1000) * 1000);
        }
        await db.users.update({ id: existing.id }, changes);
        user = { ...existing, ...changes };
      } else {
        user = await db.users.insert({
          name: String(g.name || email.split('@')[0]).trim().slice(0, 100), email, google_id: g.sub,
          password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
          avatar: images.isGoogleAvatar(g.picture) ? g.picture : null,   // photo servie par Google, sinon pas d'avatar
          is_agent: false, lang: req.lang, email_verified: true,
        });
        created = true;
      }
    } catch (e) {
      if (e.code !== '23505') throw e;   // deux premières connexions simultanées : la seconde retrouve le compte créé par la première
      user = null;
    }
  }
  if (!user) return res.status(500).json({ error: 'Erreur interne du serveur.' });
  if (user.banned) return res.status(403).json({ error: 'Ce compte a été suspendu. Contactez le support.' });
  if (created) mailer.mailWelcome({ name: user.name, email: user.email, lang: user.lang });
  else if (req.langExplicit && user.lang !== req.lang) await db.pool.query('UPDATE users SET lang = $1 WHERE id = $2', [req.lang, user.id]);
  sendSession(res, user, { created });
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const user = await db.users.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json(safe(user));
});

// PUT /api/auth/profile
router.put('/profile', require('../middleware/auth'), async (req, res) => {
  const { name, phone, bio, avatar, notify_price_drop } = req.body;
  // Un champ présent doit être du texte : un nombre ou un objet donnait une erreur 500 (« .trim is not a function »)
  if ([name, phone, bio, avatar].some(v => v !== undefined && typeof v !== 'string'))
    return res.status(400).json({ error: 'Données du profil invalides.' });
  if (notify_price_drop !== undefined && typeof notify_price_drop !== 'boolean')
    return res.status(400).json({ error: 'Données du profil invalides.' });
  // L'avatar finit dans un attribut src : uniquement un fichier envoyé sur ce site (ou vide pour le retirer), jamais une adresse libre
  if (avatar !== undefined && avatar.trim() !== '' && !images.isUpload(avatar.trim()))
    return res.status(400).json({ error: images.BAD_IMAGE });
  const changes = {};
  if (name   !== undefined) changes.name   = name.trim();
  if (phone  !== undefined) changes.phone  = phone.trim() || null;
  if (bio    !== undefined) changes.bio    = bio.trim();
  if (avatar !== undefined) changes.avatar = avatar.trim() || null;
  if (notify_price_drop !== undefined) changes.notify_price_drop = notify_price_drop;
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
  // Au plus RESET_MAX_PER_HOUR emails par compte et par heure, quelle que soit l'adresse IP : au-delà, même réponse,
  // aucun envoi (un tiers ne peut pas inonder la boîte d'un membre ni faire passer le site pour un expéditeur de spam)
  const recent = await db.pool.query(
    `SELECT COUNT(*)::int AS n FROM password_reset_tokens WHERE user_id = $1 AND created_at > NOW() - interval '1 hour'`, [user.id]);
  if (recent.rows[0].n >= RESET_MAX_PER_HOUR) return res.json({ ok: true });
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
  await revokeSessions(user_id);
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

// GET /api/auth/export — export des données personnelles (loi 18-07 / RGPD, droit d'accès)
router.get('/export', require('../middleware/auth'), async (req, res) => {
  const uid = req.user.id;
  const pool = db.pool;
  const user = await db.users.findById(uid);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const [props, msgs, sent, received, favs, revs, alerts] = await Promise.all([
    pool.query(
      `SELECT id, title, mode, type_bien, price, surface_m2, wilaya, commune, description, status, created_at
         FROM properties WHERE owner_id = $1 ORDER BY id`, [uid]),
    pool.query(
      `SELECT m.id, m.from_id, f.name AS from_name, m.to_id, t.name AS to_name,
              m.property_id, m.body, m.created_at
         FROM messages m
         JOIN users f ON f.id = m.from_id
         JOIN users t ON t.id = m.to_id
        WHERE m.from_id = $1 OR m.to_id = $1
        ORDER BY m.id`, [uid]),
    pool.query(
      `SELECT c.id, c.type, c.status, c.message, c.visit_date, c.offer_amount, c.created_at,
              p.id AS property_id, p.title AS property_title
         FROM contact_requests c
         JOIN properties p ON p.id = c.property_id
        WHERE c.user_id = $1
        ORDER BY c.id`, [uid]),
    pool.query(
      `SELECT c.id, c.type, c.status, c.message, c.visit_date, c.offer_amount, c.created_at,
              c.user_id AS requester_id, u.name AS requester_name,
              p.id AS property_id, p.title AS property_title
         FROM contact_requests c
         JOIN properties p ON p.id = c.property_id AND p.owner_id = $1
         JOIN users u ON u.id = c.user_id
        ORDER BY c.id`, [uid]),
    pool.query(
      `SELECT f.property_id, p.title AS property_title, p.mode, p.type_bien, p.price, p.wilaya,
              p.status, f.created_at
         FROM favorites f
         JOIN properties p ON p.id = f.property_id
        WHERE f.user_id = $1
        ORDER BY f.created_at`, [uid]),
    pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, p.id AS property_id, p.title AS property_title
         FROM reviews r
         JOIN properties p ON p.id = r.property_id
        WHERE r.author_id = $1
        ORDER BY r.id`, [uid]),
    pool.query(
      `SELECT id, wilaya, mode, type_bien, min_price, max_price, min_surface, created_at
         FROM search_alerts WHERE user_id = $1 ORDER BY id`, [uid]),
  ]);

  const data = {
    exported_at: new Date().toISOString(),
    profile: {
      id: user.id, name: user.name, email: user.email, phone: user.phone || null,
      bio: user.bio || null, avatar: user.avatar || null,
      is_agent: user.is_agent, verified_kind: user.verified_kind || null,
      notify_price_drop: user.notify_price_drop !== false,
      lang: user.lang, created_at: user.created_at,
    },
    properties: props.rows,
    messages: msgs.rows,
    contact_requests_sent: sent.rows,
    contact_requests_received: received.rows,
    favorites: favs.rows,
    reviews: revs.rows,
    search_alerts: alerts.rows,
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="dzimmo-${uid}-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
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
