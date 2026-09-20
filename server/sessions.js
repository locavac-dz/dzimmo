// Révocation des sessions : un jeton (JWT) est valide 7 jours, mais quand un compte change de mains ou que son mot de passe
// est réinitialisé, les jetons déjà émis doivent cesser de fonctionner. users.sessions_valid_after garde la date limite
// (à la seconde, comme le « iat » des jetons) : un jeton émis avant est refusé.
const db = require('./db');

const seconds = ms => Math.floor(ms / 1000);

function isRevoked(payload, user) {
  return !!user.sessions_valid_after && Number(payload.iat) < seconds(new Date(user.sessions_valid_after).getTime());
}

// Refuse tous les jetons émis jusqu'ici (ceux émis dans la même seconde ou après restent valables : la nouvelle connexion)
async function revokeSessions(userId) {
  await db.pool.query('UPDATE users SET sessions_valid_after = date_trunc(\'second\', NOW()) WHERE id = $1', [userId]);
}

module.exports = { isRevoked, revokeSessions };
