// Pagination des listes d'administration : LIMIT / OFFSET calculés côté serveur, réponse
// { items, total, page, pages, per_page }. Les fragments SQL passés à paginate() (colonnes, FROM, tri) viennent
// du code des routes, jamais de la requête HTTP ; seuls les nombres calculés ici y sont insérés.
const PER_PAGE_DEFAUT = 25;
const PER_PAGE_MAX    = 100;
const PAGE_MAX        = 1000000; // évite un OFFSET hors limites d'un entier SQL

function pageParams(query = {}, defaut = PER_PAGE_DEFAUT) {
  const perPage = Math.min(PER_PAGE_MAX, Math.max(1, parseInt(query.per_page, 10) || defaut));
  const page    = Math.min(PAGE_MAX, Math.max(1, parseInt(query.page, 10) || 1));
  return { page, perPage };
}

// Motif ILIKE « contient » pour une recherche saisie par l'admin (les jokers % _ \ sont neutralisés) ; null si vide
function likePattern(q) {
  if (typeof q !== 'string') return null;
  const txt = q.trim().slice(0, 100);
  return txt ? '%' + txt.replace(/[\\%_]/g, c => '\\' + c) + '%' : null;
}

// countFrom : FROM du comptage quand il peut être plus simple que celui de la lecture (jointures inutiles au COUNT).
// Une page demandée au-delà de la dernière (ex. dernier élément supprimé) renvoie la dernière page.
async function paginate(pool, { columns, from, countFrom = from, where = '', params = [], orderBy, query, defaut }) {
  const { page: demandee, perPage } = pageParams(query, defaut);
  const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${countFrom} ${where}`, params)).rows[0].n;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page  = Math.min(demandee, pages);
  const { rows } = await pool.query(
    `SELECT ${columns} FROM ${from} ${where} ORDER BY ${orderBy} LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`, params);
  return { items: rows, total, page, pages, per_page: perPage };
}

module.exports = { paginate, pageParams, likePattern, PER_PAGE_DEFAUT, PER_PAGE_MAX };
