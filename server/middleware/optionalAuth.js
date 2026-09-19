const jwt = require('jsonwebtoken');

// Comme auth, mais sans jamais refuser : req.user est renseigné si le jeton est valide,
// sinon la requête continue en anonyme. Sert aux routes publiques dont la réponse
// dépend de l'appelant (ex. un propriétaire voit son annonce en attente de validation).
module.exports = function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try { req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET); } catch { /* anonyme */ }
  }
  next();
};
