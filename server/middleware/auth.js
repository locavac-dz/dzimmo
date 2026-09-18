const jwt = require('jsonwebtoken');
const db  = require('../db');

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou invalide.' });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const user = await db.users.findById(payload.id);
    if (!user || user.banned) return res.status(403).json({ error: 'Compte suspendu.' });
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token expiré ou invalide.' });
  }
};
