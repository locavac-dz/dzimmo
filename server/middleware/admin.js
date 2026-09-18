const jwt = require('jsonwebtoken');

module.exports = function adminMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant.' });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    if (!payload.is_admin) return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token expiré ou invalide.' });
  }
};
