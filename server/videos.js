// ── Vidéo et visite virtuelle d'une annonce : ce que le serveur accepte dans video_url et tour_url ─────────────────
// Liens seulement (aucun fichier vidéo n'est reçu ni hébergé : pas de transcodage, pas de coût de bande passante) :
//   • video_url : une vidéo YouTube ou Vimeo ;
//   • tour_url  : une visite 3D / à 360° Matterport ou Kuula.
// Comme pour les images (server/images.js), ce que l'annonceur saisit n'est jamais gardé tel quel : on en extrait l'identifiant, le fournisseur
// est reconnu par son domaine exact, et l'on ne stocke que l'adresse **canonique** reconstruite par nos soins. L'adresse d'incrustation (iframe)
// est reconstruite de la même façon : une adresse saisie par un membre n'arrive jamais dans un attribut src.
// La migration 022 applique la même forme canonique en contrainte CHECK : la garder identique (voir CANONICAL).
const MAX_LENGTH = 300;
const RAW_CHARS  = /^[A-Za-z0-9\-._~:/?#@!$&()*+,;=%]+$/;   // ni guillemet, ni apostrophe, ni « < », ni antislash, ni espace

const YT_HOSTS  = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
const YT_ID     = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID  = /^[0-9]{6,12}$/;
const VIMEO_KEY = /^[0-9a-f]{6,16}$/;
const MATTER_ID = /^[A-Za-z0-9]{11}$/;
const KUULA_ID  = /^[A-Za-z0-9]{4,12}$/;

// Formes canoniques (forme stockée) : la contrainte CHECK de la migration 022 doit accepter exactement celles-ci
const CANONICAL = {
  video: /^https:\/\/(?:www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}|vimeo\.com\/[0-9]{6,12}(?:\/[0-9a-f]{6,16})?)$/,
  tour:  /^https:\/\/(?:my\.matterport\.com\/show\/\?m=[A-Za-z0-9]{11}|kuula\.co\/share\/(?:(?!collection$)[A-Za-z0-9]{4,12}|collection\/[A-Za-z0-9]{4,12}))$/,
};

// Analyse une adresse saisie : renvoie { provider, url (canonique), embed } ou null si elle n'est pas d'un fournisseur reconnu du bon type.
function parseVideo(u) {
  const parts = u.pathname.split('/').filter(Boolean);
  if (YT_HOSTS.includes(u.hostname)) {
    let id = null;
    if (parts[0] === 'watch' && parts.length === 1) id = u.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0]) && parts.length === 2) id = parts[1];
    if (!YT_ID.test(id || '')) return null;
    return { provider: 'youtube', url: `https://www.youtube.com/watch?v=${id}`,
             embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1` };
  }
  if (u.hostname === 'youtu.be') {
    if (parts.length !== 1 || !YT_ID.test(parts[0])) return null;
    return { provider: 'youtube', url: `https://www.youtube.com/watch?v=${parts[0]}`,
             embed: `https://www.youtube-nocookie.com/embed/${parts[0]}?rel=0&autoplay=1` };
  }
  if (u.hostname === 'vimeo.com' || u.hostname === 'www.vimeo.com' || u.hostname === 'player.vimeo.com') {
    // vimeo.com/123456789, vimeo.com/123456789/<clé> (vidéo non répertoriée), player.vimeo.com/video/123456789?h=<clé>
    const player = u.hostname === 'player.vimeo.com';
    if (player && parts[0] !== 'video') return null;
    const rest = player ? parts.slice(1) : parts;
    if (rest.length < 1 || rest.length > 2 || !VIMEO_ID.test(rest[0])) return null;
    const key = rest[1] || (player ? u.searchParams.get('h') : null) || null;
    if (key !== null && !VIMEO_KEY.test(key)) return null;
    return { provider: 'vimeo', url: `https://vimeo.com/${rest[0]}${key ? '/' + key : ''}`,
             embed: `https://player.vimeo.com/video/${rest[0]}?dnt=1&autoplay=1${key ? '&h=' + key : ''}` };
  }
  return null;
}

function parseTour(u) {
  const parts = u.pathname.split('/').filter(Boolean);
  if (u.hostname === 'my.matterport.com') {
    const id = u.searchParams.get('m');
    if (parts.length !== 1 || parts[0] !== 'show' || !MATTER_ID.test(id || '')) return null;
    return { provider: 'matterport', url: `https://my.matterport.com/show/?m=${id}`,
             embed: `https://my.matterport.com/show/?m=${id}&play=1` };
  }
  if (u.hostname === 'kuula.co' || u.hostname === 'www.kuula.co') {
    // /share/<id>, /post/<id> (même identifiant), /share/collection/<id> (série de visites)
    let coll = false, id = null;
    if (['share', 'post'].includes(parts[0]) && parts.length === 2) id = parts[1];
    else if (parts[0] === 'share' && parts[1] === 'collection' && parts.length === 3) { coll = true; id = parts[2]; }
    if (!KUULA_ID.test(id || '') || (!coll && id === 'collection')) return null;   // « /share/collection » seul n'est pas une visite
    const url = `https://kuula.co/share/${coll ? 'collection/' : ''}${id}`;
    return { provider: 'kuula', url, embed: `${url}?fs=1&vr=1&sd=1&thumbs=1` };
  }
  return null;
}

// kind : 'video' | 'tour'. Renvoie null pour toute adresse refusée. Seul https est accepté : ni identifiants, ni port, ni autre schéma.
function parse(kind, value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_LENGTH || !RAW_CHARS.test(raw) || !/^https:\/\//i.test(raw)) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const found = kind === 'tour' ? parseTour(u) : parseVideo(u);
  // Garde-fou : ce qu'on a reconstruit doit respecter la forme que la base impose
  return found && CANONICAL[kind].test(found.url) ? found : null;
}

const BAD_VIDEO = 'Lien vidéo invalide : utilisez un lien YouTube ou Vimeo.';
const BAD_TOUR  = 'Lien de visite virtuelle invalide : utilisez un lien Matterport ou Kuula.';

const isEmpty = v => v === undefined || v === null || v === '';

// Vérifie video_url et tour_url d'un corps de requête ; renvoie le message d'erreur, ou null si tout est valide (absent ou vide : rien à vérifier).
function invalid({ video_url, tour_url } = {}) {
  if (!isEmpty(video_url) && !parse('video', video_url)) return BAD_VIDEO;
  if (!isEmpty(tour_url)  && !parse('tour',  tour_url))  return BAD_TOUR;
  return null;
}

// Valeur à enregistrer : l'adresse canonique, ou null pour un champ vidé. À n'appeler qu'après `invalid` (une adresse refusée donne null aussi).
function clean(kind, value) {
  if (isEmpty(value)) return null;
  const found = parse(kind, value);
  return found ? found.url : null;
}

// Pour l'affichage : { provider, url, embed } depuis une adresse déjà stockée, ou null (rien, ou valeur qui ne serait plus reconnue)
function describe(kind, stored) {
  return isEmpty(stored) ? null : parse(kind, stored);
}

module.exports = { MAX_LENGTH, CANONICAL, BAD_VIDEO, BAD_TOUR, parse, invalid, clean, describe };
