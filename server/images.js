// ── Images d'annonces : ce que le serveur accepte dans image et photos ─────────────────────────────────────────────
// Ces valeurs sont rendues dans des attributs src par la page (cartes, fiche, messagerie…) : une chaîne quelconque (guillemet, javascript:, adresse
// externe suivie à la lecture) n'a rien à y faire. Sont acceptés :
//   • un fichier envoyé sur ce site (POST /api/upload) : /uploads/<nom>.(webp|jpg|jpeg|png|gif) ;
//   • une adresse https d'un domaine de la liste blanche REMOTE_HOSTS : les photos des annonces de démonstration (seed de server/db.js),
//     qui doivent rester modifiables. Ajouter un domaine ici est une décision de sécurité, pas de configuration.
// La migration 011 applique la même règle aux annonces déjà enregistrées : la garder identique (regex et longueur).
const UPLOAD_PATH  = /^\/uploads\/[\w.-]+\.(?:webp|jpe?g|png|gif)$/i;
const REMOTE_HOSTS = ['images.unsplash.com'];
const REMOTE_CHARS = /^[A-Za-z0-9\-._~:/?#@!$&()*+,;=%]+$/;   // ni guillemet, ni apostrophe, ni « < », ni antislash, ni espace
const MAX_LENGTH   = 300;
const MAX_PHOTOS   = 20;

const isUpload = v => typeof v === 'string' && v.length <= MAX_LENGTH && UPLOAD_PATH.test(v);

// Même règle que la migration 011 : « https://<domaine>/ » exact (casse comprise, sans identifiants ni port) puis au moins un caractère
const isRemote = v => typeof v === 'string' && v.length <= MAX_LENGTH && REMOTE_CHARS.test(v)
  && REMOTE_HOSTS.some(h => v.startsWith('https://' + h + '/') && v.length > ('https://' + h + '/').length);

const isListingImage = v => isUpload(v) || isRemote(v);

// ── Avatar d'un compte ────────────────────────────────────────────────────────────────────────────────────────────
// Saisi par le membre (PUT /api/auth/profile) : uniquement un fichier envoyé sur ce site. La photo d'un compte Google vient d'un jeton signé
// par Google, jamais du membre : on ne la garde que si elle est servie par Google (lh3…lh6.googleusercontent.com), sinon le compte n'a pas
// d'avatar. La migration 015 applique la même règle aux comptes déjà enregistrés : la garder identique.
const GOOGLE_AVATAR     = /^https:\/\/lh[0-9]\.googleusercontent\.com\/[A-Za-z0-9\-._~/=]+$/;
const MAX_GOOGLE_AVATAR = 500;
const isGoogleAvatar = v => typeof v === 'string' && v.length <= MAX_GOOGLE_AVATAR && GOOGLE_AVATAR.test(v);

const BAD_IMAGE = 'Image invalide : envoyez-la depuis le formulaire.';
const TOO_MANY  = 'Trop de photos (20 maximum).';

// Vérifie les champs image et photos d'un corps de requête ; renvoie le message d'erreur, ou null si tout est valide.
// Absent, null ou vide (image) : rien à vérifier. Tout autre type que texte (image) ou tableau de textes (photos) est refusé.
function invalid({ image, photos } = {}) {
  if (image !== undefined && image !== null && image !== '' && !isListingImage(image)) return BAD_IMAGE;
  if (photos === undefined || photos === null) return null;
  if (!Array.isArray(photos)) return BAD_IMAGE;
  if (photos.length > MAX_PHOTOS) return TOO_MANY;
  return photos.every(isListingImage) ? null : BAD_IMAGE;
}

module.exports = { UPLOAD_PATH, REMOTE_HOSTS, MAX_LENGTH, MAX_PHOTOS, BAD_IMAGE, TOO_MANY, isUpload, isListingImage, isGoogleAvatar, invalid };
