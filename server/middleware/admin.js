const jwt = require('jsonwebtoken');
const db  = require('../db');
const { isRevoked } = require('../sessions');
const twoFactor = require('../two-factor');

// Le rôle est relu en base à chaque requête : un administrateur rétrogradé, suspendu ou dont les sessions ont été révoquées
// perd son accès tout de suite, au lieu de garder pendant 7 jours un jeton qui affirme encore « is_admin ».
module.exports = async function adminMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant.' });
  }
  let payload;
  try { payload = jwt.verify(header.slice(7), process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Token expiré ou invalide.' }); }
  const user = await db.users.findById(payload.id);
  if (!user || user.banned) return res.status(403).json({ error: 'Compte suspendu.' });
  if (isRevoked(payload, user)) return res.status(401).json({ error: 'Token expiré ou invalide.' });
  if (!user.is_admin) return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  // Double authentification : un jeton obtenu avec le seul mot de passe (ou avant l'activation) n'ouvre pas l'administration
  const block = twoFactor.adminBlock(user, payload);
  if (block === 'mfa') return res.status(401).json({ error: 'Double authentification requise.' });
  if (block === 'setup')
    return res.status(403).json({ error: 'Activez la double authentification pour utiliser l\'administration.', code: 'mfa_setup_required' });
  req.user = payload;
  next();
};
