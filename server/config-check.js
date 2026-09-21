// Contrôle de la configuration au démarrage (production uniquement).
// « errors » empêchent le démarrage : le serveur tournerait avec une faille (secret JWT devinable) ou des liens
// erronés (APP_URL). « warnings » sont affichés dans les logs : le site fonctionne mais dégradé.
// Fonction pure (reçoit l'environnement) pour être testée sans démarrer le serveur.

const path = require('path');
const jwt  = require('jsonwebtoken');

const { FROM_OK, EMAIL_OK } = require('./mailer');   // la règle qu'applique réellement l'envoi (sender)
const SECRET_MIN = 32;
const PLACEHOLDER_SECRET = /changez|change[-_ ]?me|secret-de-test|example|exemple/i;
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

const MIN_SESSION_SECONDS = 300;

// Durée réelle d'une session pour cette valeur, calculée par jsonwebtoken lui-même (null : il la refuse)
function sessionSeconds(ttl) {
  try {
    const { iat, exp } = jwt.decode(jwt.sign({}, 'controle-de-configuration', { expiresIn: ttl }));
    return exp - iat;
  } catch { return null; }
}

function checkConfig(env = process.env) {
  const errors = [], warnings = [];
  if (env.NODE_ENV !== 'production') return { errors, warnings };

  const secret = env.JWT_SECRET || '';
  if (!secret) errors.push('JWT_SECRET est absent : les sessions ne peuvent pas être signées.');
  else if (PLACEHOLDER_SECRET.test(secret))
    errors.push('JWT_SECRET est encore la valeur d\'exemple de .env.example : n\'importe qui pourrait forger un jeton administrateur.');
  else if (secret.length < SECRET_MIN)
    errors.push(`JWT_SECRET est trop court (${secret.length} caractères, ${SECRET_MIN} minimum) : générez-en un avec « node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" ».`);

  // Durée des sessions (7d par défaut) : avec une valeur illisible, jwt.sign() échoue et plus personne ne peut se connecter
  const ttl = (env.JWT_EXPIRES_IN || '').trim();
  if (ttl) {
    const seconds = sessionSeconds(ttl);
    if (seconds === null)
      errors.push(`JWT_EXPIRES_IN est illisible (« ${ttl} ») : attendu une durée comme 7d, 12h ou 30m.`);
    else if (seconds < MIN_SESSION_SECONDS)   // piège : « 3600 » sans unité vaut 3600 millisecondes
      errors.push(`JWT_EXPIRES_IN (« ${ttl} ») donne des sessions de ${seconds} seconde(s) : les membres seraient déconnectés aussitôt. Préciser l'unité, par exemple 7d.`);
  }

  if (!env.DATABASE_URL) errors.push('DATABASE_URL est absent.');

  // Justificatifs d'identité (loi 18-07) : jamais dans un dossier servi au public
  if (env.VERIFICATION_DIR) {
    const pub = path.resolve(__dirname, '..', 'public') + path.sep;
    if ((path.resolve(env.VERIFICATION_DIR) + path.sep).toLowerCase().startsWith(pub.toLowerCase()))
      errors.push('VERIFICATION_DIR est sous public/ : les pièces d\'identité des annonceurs seraient téléchargeables par n\'importe qui.');
  }

  // Sauvegardes (server/backup.js) : contiennent comptes et messages, jamais dans un dossier servi au public
  if (env.BACKUP_DIR) {
    const pub = path.resolve(__dirname, '..', 'public') + path.sep;
    if ((path.resolve(env.BACKUP_DIR) + path.sep).toLowerCase().startsWith(pub.toLowerCase()))
      errors.push('BACKUP_DIR est sous public/ : les sauvegardes de la base (comptes, messages) seraient téléchargeables par n\'importe qui.');
  }
  if (String(env.BACKUP_ENABLED ?? '').trim().toLowerCase() === 'false')
    warnings.push('BACKUP_ENABLED=false : aucune sauvegarde automatique de la base ne sera faite (à assurer autrement, voir DEPLOIEMENT.md § 7).');
  if (env.BACKUP_KEEP !== undefined && String(env.BACKUP_KEEP).trim() !== '' && !/^\d{1,3}$/.test(String(env.BACKUP_KEEP).trim()))
    warnings.push(`BACKUP_KEEP doit être un nombre entier de sauvegardes à conserver (« ${String(env.BACKUP_KEEP).trim()} » ignoré : 14 utilisées).`);

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

  const NO_MAIL = 'aucun email (confirmation, mot de passe oublié, alertes) ne sera envoyé.';
  if (!env.EMAIL_HOST) warnings.push('EMAIL_HOST est absent : ' + NO_MAIL);
  else if (/(^|\.)example\.(com|org|net)$/i.test(env.EMAIL_HOST.trim())) warnings.push(`EMAIL_HOST est encore la valeur d'exemple (${env.EMAIL_HOST}) : ` + NO_MAIL);
  else if (!env.EMAIL_USER) warnings.push('EMAIL_USER est absent : ' + NO_MAIL);
  const from = (env.EMAIL_FROM || '').trim();
  if (from && !FROM_OK.test(from))
    warnings.push('EMAIL_FROM est invalide (attendu « Nom <adresse@domaine> » ou une adresse seule) : le compte SMTP sert d\'expéditeur.');
  const contact = (env.CONTACT_EMAIL || '').trim();
  if (contact && !EMAIL_OK.test(contact))
    warnings.push('CONTACT_EMAIL est invalide (une adresse seule attendue) : les messages de la page Contact vont aux administrateurs.');
  const alertTo = (env.ALERT_EMAIL || '').trim();
  if (alertTo && !EMAIL_OK.test(alertTo))
    warnings.push('ALERT_EMAIL est invalide (une adresse seule attendue) : les alertes de panne vont à CONTACT_EMAIL ou aux administrateurs.');
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
