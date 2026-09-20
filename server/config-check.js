// Contrôle de la configuration au démarrage (production uniquement).
// « errors » empêchent le démarrage : le serveur tournerait avec une faille (secret JWT devinable) ou des liens
// erronés (APP_URL). « warnings » sont affichés dans les logs : le site fonctionne mais dégradé.
// Fonction pure (reçoit l'environnement) pour être testée sans démarrer le serveur.

const SECRET_MIN = 32;
const PLACEHOLDER_SECRET = /changez|change[-_ ]?me|secret-de-test|example|exemple/i;
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

function checkConfig(env = process.env) {
  const errors = [], warnings = [];
  if (env.NODE_ENV !== 'production') return { errors, warnings };

  const secret = env.JWT_SECRET || '';
  if (!secret) errors.push('JWT_SECRET est absent : les sessions ne peuvent pas être signées.');
  else if (PLACEHOLDER_SECRET.test(secret))
    errors.push('JWT_SECRET est encore la valeur d\'exemple de .env.example : n\'importe qui pourrait forger un jeton administrateur.');
  else if (secret.length < SECRET_MIN)
    errors.push(`JWT_SECRET est trop court (${secret.length} caractères, ${SECRET_MIN} minimum) : générez-en un avec « node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" ».`);

  if (!env.DATABASE_URL) errors.push('DATABASE_URL est absent.');

  const app = env.APP_URL || '';
  if (!app) errors.push('APP_URL est absent : les liens des emails, le sitemap et les URL canoniques pointeraient vers le serveur interne.');
  else if (LOCAL.test(app)) errors.push(`APP_URL pointe vers une adresse locale (${app}).`);
  else if (!/^https:\/\//i.test(app)) warnings.push(`APP_URL n'est pas en https (${app}).`);

  const cors = (env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
  if (!cors.length || cors.every(o => LOCAL.test(o)))
    warnings.push('CORS_ORIGINS ne contient que des adresses locales : le site public ne pourra pas appeler l\'API depuis un autre domaine.');

  if (!env.TRUST_PROXY || env.TRUST_PROXY === '0' || env.TRUST_PROXY === 'false')
    warnings.push('TRUST_PROXY n\'est pas défini : derrière Nginx, tous les visiteurs partagent la même limite de débit (l\'IP du proxy). Mettre TRUST_PROXY=1.');

  const gid = (env.GOOGLE_CLIENT_ID || '').trim();
  if (env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_ID !== '' && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(gid))
    warnings.push("GOOGLE_CLIENT_ID n'a pas la forme d'un identifiant client Google (« …apps.googleusercontent.com ») : la connexion Google ne fonctionnera pas.");

  // Délais de reconfirmation des annonces (server/expiry.js) : une valeur invalide est ignorée au profit du défaut, autant le dire
  for (const [name, def] of [['LISTING_CONFIRM_DAYS', 30], ['LISTING_EXPIRE_GRACE_DAYS', 14]]) {
    const raw = env[name];
    if (raw === undefined || String(raw).trim() === '') continue;
    const v = String(raw).trim();
    if (!/^\d{1,3}$/.test(v) || Number(v) < 1 || Number(v) > 365)
      warnings.push(`${name} doit être un nombre entier de jours entre 1 et 365 (« ${v} » ignoré : ${def} jours utilisés).`);
  }

  if (!env.EMAIL_HOST) warnings.push('EMAIL_HOST est absent : aucun email (confirmation, mot de passe oublié, alertes) ne sera envoyé.');
  if ((env.MODERATION || 'on').toLowerCase() === 'off') warnings.push('MODERATION=off : les annonces sont publiées sans validation.');

  return { errors, warnings };
}

// Affiche le bilan ; renvoie false si le démarrage doit être refusé
function reportConfig(env = process.env, log = console) {
  const { errors, warnings } = checkConfig(env);
  warnings.forEach(w => log.warn('⚠️  Configuration : ' + w));
  errors.forEach(e => log.error('❌ Configuration : ' + e));
  return errors.length === 0;
}

module.exports = { checkConfig, reportConfig, SECRET_MIN };
