// ── Conseils à l'annonceur : ce que disent les statistiques d'une annonce ─────────────────────────────────────────
// Fonction pure (aucun accès à la base) : elle reçoit les chiffres déjà lus et renvoie des **codes** de conseil avec leurs paramètres.
// Le texte est écrit côté site, en français et en arabe (clés `adv_<code>` de public/app.js) : le serveur ne compose aucune phrase.
// Jamais d'identité ni d'annonce d'un autre membre ici : seuls les chiffres de l'annonce et la médiane de prix (en %) sont utilisés.
const MIN_PHOTOS        = 5;     // en dessous : conseil « ajoutez des photos » (urgent sous 3)
const MIN_DESCRIPTION   = 150;   // caractères
const MATURITY_DAYS     = 7;     // avant, trop tôt pour juger la visibilité
const LOW_VIEWS_7D      = 5;     // moins de vues sur 7 jours, à partir de MATURITY_DAYS de vie
const DROP_MIN_PREVIOUS = 10;    // vues des 7 jours précédents nécessaires pour parler de baisse
const DROP_RATIO        = 0.5;   // moins de la moitié des vues de la semaine précédente
const NO_ENGAGEMENT_MIN = 30;    // vues sur 30 jours sans aucun favori, clic ni demande
const MAX_ADVICE        = 4;

// Ordre de priorité (le plus important d'abord) : c'est aussi la liste des codes que le site doit savoir traduire
const CODES = ['price_high', 'few_photos', 'no_phone', 'no_engagement', 'views_drop', 'low_visibility', 'short_description',
               'no_location', 'no_media', 'no_features', 'no_floor', 'all_good'];

const sum = a => a.reduce((t, v) => t + (Number(v) || 0), 0);

// p : ligne de l'annonce ; owner_phone : téléphone du compte (ou de l'agence) ; series : tableaux de 30 valeurs (le dernier = aujourd'hui) ;
// quality : { flags, ratio } de listing_quality (ou null) ; contacts_30d : demandes de contact reçues.
// Ne renvoie des conseils que pour une annonce publiée (`active`) : les autres statuts ont leur propre écran.
function advise({ property: p, phone, series, quality = null, contacts30 = 0, now = Date.now() }) {
  if (!p || p.status !== 'active') return [];
  const found = new Map();
  const add = (code, level, params = {}) => found.set(code, { code, level, params });

  const photos = Array.isArray(p.photos) ? p.photos.filter(Boolean).length : 0;
  const photoCount = Math.max(photos, p.image ? 1 : 0);
  const views = series.views, favs = series.favorites, clicks = series.clicks;
  const views30 = sum(views), views7 = sum(views.slice(-7)), viewsBefore = sum(views.slice(-14, -7));
  const ageDays = (now - new Date(p.published_at || p.created_at).getTime()) / 86400000;

  if (quality && (quality.flags || []).includes('price_high') && quality.ratio > 1)
    add('price_high', 'warn', { pct: Math.round((quality.ratio - 1) * 100) });
  if (photoCount < MIN_PHOTOS) add('few_photos', photoCount < 3 ? 'warn' : 'tip', { n: photoCount, min: MIN_PHOTOS });
  if (!String(phone || '').trim()) add('no_phone', 'warn');
  if (views30 >= NO_ENGAGEMENT_MIN && sum(favs) + sum(clicks) + contacts30 === 0) add('no_engagement', 'warn', { views: views30 });
  if (viewsBefore >= DROP_MIN_PREVIOUS && views7 < viewsBefore * DROP_RATIO)
    add('views_drop', 'warn', { pct: Math.round((1 - views7 / viewsBefore) * 100) });
  else if (ageDays >= MATURITY_DAYS && views7 < LOW_VIEWS_7D) add('low_visibility', 'tip', { n: views7 });
  if (String(p.description || '').trim().length < MIN_DESCRIPTION)
    add('short_description', 'tip', { n: String(p.description || '').trim().length, min: MIN_DESCRIPTION });
  if (p.lat === null || p.lat === undefined || p.lng === null || p.lng === undefined) add('no_location', 'tip');
  if (!p.video_url && !p.tour_url) add('no_media', 'tip');
  if (p.type_bien !== 'terrain' && !(Array.isArray(p.features) && p.features.length)) add('no_features', 'tip');
  if (['appartement', 'bureau'].includes(p.type_bien) && p.floor == null) add('no_floor', 'tip');

  const list = CODES.filter(c => found.has(c)).map(c => found.get(c)).slice(0, MAX_ADVICE);
  // Rien à reprocher et déjà des visites : on le dit (un encouragement plutôt qu'une liste vide)
  if (!list.length && views30 > 0) list.push({ code: 'all_good', level: 'good', params: {} });
  return list;
}

module.exports = { advise, CODES, MIN_PHOTOS, MIN_DESCRIPTION, MATURITY_DAYS, LOW_VIEWS_7D, DROP_MIN_PREVIOUS, DROP_RATIO, NO_ENGAGEMENT_MIN, MAX_ADVICE };
