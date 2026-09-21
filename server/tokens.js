// Jeton de session et fiche publique d'un compte (partagés par les routes de connexion et de double authentification).
const jwt = require('jsonwebtoken');

// mfa : la session a passé la double authentification (code TOTP ou de secours). Sans cette mention, un compte qui a activé la double
// authentification n'a pas accès à l'administration (server/two-factor.js, adminAllowed).
function sign(user, { mfa = false } = {}) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, is_agent: user.is_agent, is_admin: user.is_admin || false, ...(mfa ? { mfa: true } : {}) },
    process.env.JWT_SECRET,
    // Sans durée, jwt.sign() lève une erreur : un oubli dans .env ne doit pas empêcher toute connexion
    { expiresIn: (process.env.JWT_EXPIRES_IN || '').trim() || '7d' }
  );
}

function safe(u) {
  const { required } = require('./two-factor');
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    is_agent: u.is_agent, is_admin: u.is_admin || false,
    bio: u.bio || '', avatar: u.avatar || '',
    email_verified: u.email_verified || false,
    notify_price_drop: u.notify_price_drop !== false,   // alerte de baisse de prix des favoris (active par défaut)
    verified_kind: u.verified_kind || null,
    two_factor: !!u.totp_enabled_at,
    two_factor_required: !!u.is_admin && !u.totp_enabled_at && required(),   // l'administrateur doit configurer la double authentification
    created_at: u.created_at,
  };
}

module.exports = { sign, safe };
