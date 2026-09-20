// ── Recherche tolérante : accents, majuscules, arabe (diacritiques, variantes de lettres), français ↔ arabe ───────────────────────
// Principe : chaque annonce, agence et programme a un « texte de recherche » normalisé (tables property_search, agency_search,
// project_search, tenues à jour par des déclencheurs SQL) et la requête de l'utilisateur est normalisée de la même façon ici.
// La recherche est alors : chaque mot de la requête doit apparaître (dans n'importe quel ordre) dans le texte normalisé.
//   • « elegant », « ÉLÉGANT » et « élégant » se valent ; « bab-ezzouar » = « Bab Ezzouar » ;
//   • en arabe, voyelles brèves (tachkil), tatwil, alif à hamza (أ إ آ → ا), « ى » = « ي », « ة » = « ه », chiffres ٣ = 3 ;
//   • le texte indexé contient aussi le nom arabe de la wilaya et les mots arabes du type de bien et du mode : « الجزائر » trouve Alger,
//     « شقة » trouve un appartement, et « alger » trouve une annonce dont la wilaya s'écrit en arabe.
// Aucune extension PostgreSQL (unaccent, pg_trgm) : elles demandent des droits particuliers et ne sont pas visibles des schémas de test.
// La fonction SQL dz_norm() de la migration 012 doit donner EXACTEMENT le même résultat que normalize() : tests/api/search.test.js
// le vérifie caractère par caractère (U+0020–U+024F et bloc arabe). Modifier l'une exige de modifier l'autre.
const { likePattern } = require('./pagination');
const WILAYAS_AR = require('./wilayas-ar');

// Marques combinantes latines (U+0300–U+036F), tachkil arabe (U+064B–U+065F, U+0670) et tatwil (U+0640)
const MARKS = /[\u0300-\u036F\u064B-\u065F\u0670\u0640]/g;
// Ligatures et lettres barrées : pas de décomposition canonique, table explicite
const LIGATURES = { 'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'Œ': 'oe', 'ß': 'ss', 'ẞ': 'ss' };
const STROKED   = { 'ø': 'o', 'Ø': 'o', 'ł': 'l', 'Ł': 'l', 'đ': 'd', 'Đ': 'd', 'ð': 'd', 'Ð': 'd', 'ı': 'i' };
// Lettres arabes équivalentes pour la recherche (alif à hamza, alif maqsura, ta marbuta, variantes persanes du clavier), et chiffres indo-arabes / persans
const AR_LETTERS = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه', 'ؤ': 'و', 'ئ': 'ي', 'ک': 'ك', 'ی': 'ي' };
const AR_DIGITS  = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_MAP = new Map([...Object.entries(AR_LETTERS), ...[...AR_DIGITS].map((c, i) => [c, String(i)]), ...[...FA_DIGITS].map((c, i) => [c, String(i)])]);
const AR_RE  = new RegExp('[' + [...AR_MAP.keys()].join('') + ']', 'g');

function normalize(text) {
  let s = String(text ?? '');
  s = s.replace(/[æÆœŒßẞ]/g, c => LIGATURES[c]);
  s = s.normalize('NFD').replace(/[øØłŁđĐðÐı]/g, c => STROKED[c]).toLowerCase().replace(MARKS, '');
  s = s.replace(AR_RE, c => AR_MAP.get(c));
  return s.replace(/[^a-z0-9\u0621-\u064A]+/g, ' ').trim();
}

// Mots de la requête : normalisés, sans doublon, 8 au plus, 40 caractères au plus chacun ; [] si la requête n'est pas un texte
const MAX_TOKENS = 8, MAX_TOKEN_LENGTH = 40;
function tokens(q) {
  if (typeof q !== 'string') return [];
  return [...new Set(normalize(q.slice(0, 200)).split(' ').filter(Boolean).map(t => t.slice(0, MAX_TOKEN_LENGTH)))].slice(0, MAX_TOKENS);
}

// Condition SQL « chaque mot apparaît dans le texte de recherche » (ou null si la requête est vide).
//   column   : expression SQL du texte normalisé (ex. « s.text »)
//   fallback : colonnes brutes cherchées telles quelles quand la requête n'a aucun mot cherchable (ex. « 100% » seul, « % » ; comme avant)
//   arg      : (valeur) => « $n », ajoute la valeur aux paramètres de la requête
// Les mots ne contiennent que [a-z0-9] et des lettres arabes : aucun joker LIKE à neutraliser.
function condition(q, column, fallback, arg) {
  const words = tokens(q);
  if (words.length) return words.map(w => `${column} LIKE ${arg('%' + w + '%')}`).join(' AND ');
  const like = likePattern(q);
  if (!like) return null;
  const p = arg(like);
  return '(' + fallback.map(c => `${c} ILIKE ${p}`).join(' OR ') + ')';
}

// ── Lexique français ↔ arabe des termes indexés (table search_lexicon, lue par les déclencheurs) ──────────────────────────────────
const LEXICON = [
  ...Object.entries(WILAYAS_AR).map(([fr, ar]) => ({ kind: 'wilaya', key: fr, terms: ar })),
  { kind: 'type', key: 'appartement',      terms: 'appartement apartment شقة شقق' },
  { kind: 'type', key: 'villa',            terms: 'villa فيلا فيلات' },
  { kind: 'type', key: 'maison',           terms: 'maison منزل بيت دار' },
  { kind: 'type', key: 'bureau',           terms: 'bureau مكتب مكاتب' },
  { kind: 'type', key: 'local_commercial', terms: 'local commercial محل تجاري محلات' },
  { kind: 'type', key: 'terrain',          terms: 'terrain أرض قطعة أرض' },
  { kind: 'type', key: 'ferme',            terms: 'ferme مزرعة فلاحية' },
  { kind: 'type', key: 'entrepot',         terms: 'entrepôt hangar مستودع مخزن' },
  { kind: 'mode', key: 'vente',            terms: 'vente à vendre بيع للبيع' },
  { kind: 'mode', key: 'location_longue',  terms: 'location à louer longue durée كراء إيجار للإيجار للكراء' },
  { kind: 'mode', key: 'location_courte',  terms: 'location saisonnière courte durée كراء موسمي إيجار قصير' },
  { kind: 'kind', key: 'agence',           terms: 'agence immobilière وكالة عقارية' },
  { kind: 'kind', key: 'promoteur',        terms: 'promoteur immobilier programme neuf مروج عقاري مشروع' },
];

// Aligne la table search_lexicon sur LEXICON et recalcule les textes de recherche si elle a changé. Appelée au démarrage (db.connect),
// après les migrations. Sûre avec plusieurs instances (verrou consultatif) et sans effet quand rien n'a changé. Renvoie true si mise à jour.
async function sync(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7318842)');
    const have = (await client.query('SELECT kind, key, terms FROM search_lexicon')).rows;
    const key = r => `${r.kind}|${r.key}|${r.terms}`;
    const same = have.length === LEXICON.length && new Set(have.map(key)).size === have.length && LEXICON.every(r => have.some(h => key(h) === key(r)));
    if (same) { await client.query('COMMIT'); return false; }
    await client.query('DELETE FROM search_lexicon');
    await client.query('INSERT INTO search_lexicon (kind, key, terms) SELECT * FROM unnest($1::text[], $2::text[], $3::text[])',
      [LEXICON.map(r => r.kind), LEXICON.map(r => r.key), LEXICON.map(r => r.terms)]);
    await client.query('SELECT dz_reindex_search()');
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { normalize, tokens, condition, sync, LEXICON, MARKS, MAX_TOKENS, MAX_TOKEN_LENGTH };
