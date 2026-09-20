const jwt = require('jsonwebtoken');
const db  = require('../db');
const { isRevoked } = require('../sessions');

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou invalide.' });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const user = await db.users.findById(payload.id);
    if (!user || user.banned) return res.status(403).json({ error: 'Compte suspendu.' });
    if (isRevoked(payload, user)) return res.status(401).json({ error: 'Token expiré ou invalide.' });
    // Le compte mémorise la dernière langue choisie sur le site : emails et notifications suivent
    if (req.langExplicit && user.lang !== req.lang)
      db.pool.query('UPDATE users SET lang = $1 WHERE id = $2', [req.lang, user.id]).catch(() => {});
    // Le rôle admin vient de la base, pas du jeton (un admin rétrogradé garde son jeton jusqu'à expiration)
    req.user = { ...payload, is_admin: !!user.is_admin };
    next();
  } catch {
    res.status(401).json({ error: 'Token expiré ou invalide.' });
  }
};
