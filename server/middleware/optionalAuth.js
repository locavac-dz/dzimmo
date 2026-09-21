const jwt = require('jsonwebtoken');
const db  = require('../db');
const { isRevoked } = require('../sessions');
const twoFactor = require('../two-factor');

// Authentification facultative : un jeton valide identifie le visiteur, tout le reste le laisse anonyme (jamais d'erreur).
// Comme `auth`, le compte est relu en base : un compte supprimé, suspendu ou dont les sessions ont été révoquées redevient
// un simple visiteur (sinon son ancien jeton lui montrait encore ses annonces en attente, `is_mine`, etc. jusqu'à expiration).
// Le rôle admin vient de la base, pas du jeton : un admin rétrogradé perd aussitôt la vue des annonces non publiées.
module.exports = async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    let payload = null;
    try { payload = jwt.verify(header.slice(7), process.env.JWT_SECRET); } catch { /* anonyme */ }
    if (payload) {
      const user = await db.users.findById(payload.id);
      if (user && !user.banned && !isRevoked(payload, user))
        req.user = { ...payload, is_admin: !!user.is_admin && twoFactor.adminBlock(user, payload) === null };
    }
  }
  next();
};
