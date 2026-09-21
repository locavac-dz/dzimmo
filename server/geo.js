// ── Recherche géographique : autour d'un point (rayon) et dans une zone dessinée (polygone) ───────────────────────────────
// Aucune extension PostgreSQL (pas de PostGIS : droits particuliers, invisible des schémas de test). Un rectangle englobant
// sur (lat, lng) — servi par l'index 021 — écarte l'essentiel des annonces ; la distance ou l'appartenance au polygone
// (nombre de croisements d'une demi-droite, calculé en SQL) tranche ensuite. Tout se fait en SQL : la réponse est bornée
// par un LIMIT, jamais une liste triée en mémoire. Ni la position du visiteur ni la zone dessinée ne sont stockées ou journalisées.
const MAX_VERTICES = 60;
const KM_PER_DEG   = 111.32;

const finite = v => typeof v === 'number' && Number.isFinite(v);

// Sommets [[lat, lng], …] d'un polygone : nombres finis, dans les bornes, 3 à 60 points distincts.
// Renvoie { lats, lngs, box } ou null. Les points consécutifs identiques sont fusionnés ; un sommet de fermeture répété est retiré.
function cleanPolygon(raw) {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > MAX_VERTICES + 1) return null;
  const pts = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2 || !finite(p[0]) || !finite(p[1])) return null;
    const [lat, lng] = p;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    const last = pts[pts.length - 1];
    if (!last || last[0] !== lat || last[1] !== lng) pts.push([lat, lng]);
  }
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  if (pts.length < 3 || pts.length > MAX_VERTICES) return null;
  const lats = pts.map(p => p[0]), lngs = pts.map(p => p[1]);
  const box = { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
  // Zone sans surface (points alignés) : rien à chercher
  if (box.minLat === box.maxLat || box.minLng === box.maxLng) return null;
  return { lats, lngs, box };
}

// Rectangle englobant d'un cercle (marge de 1 %). Près des pôles la longitude n'est plus bornée : on ne la restreint pas.
function circleBox(lat, lng, km) {
  const dLat = km / KM_PER_DEG * 1.01;
  const cos  = Math.cos(lat * Math.PI / 180);
  const dLng = cos > 0.01 ? km / (KM_PER_DEG * cos) * 1.01 : 360;
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// Condition « dans le rectangle » (colonnes p.lat / p.lng) ; `add(valeur)` enregistre un paramètre et renvoie son « $n ».
// Un rectangle qui déborde de l'antiméridien (±180°) n'est pas restreint en longitude : le calcul exact reste juste.
function boxCondition(box, add) {
  const conds = [`p.lat BETWEEN ${add(box.minLat)} AND ${add(box.maxLat)}`];
  if (box.minLng >= -180 && box.maxLng <= 180) conds.push(`p.lng BETWEEN ${add(box.minLng)} AND ${add(box.maxLng)}`);
  return conds.join(' AND ');
}

// Condition « dans le polygone » : parité du nombre d'arêtes coupées par la demi-droite qui part du point vers l'est.
// `la` / `ln` : numéros de paramètres des tableaux de latitudes et de longitudes (float8[]).
function polygonCondition(la, ln) {
  const lats = `($${la}::float8[])`, lngs = `($${ln}::float8[])`, n = `cardinality($${la}::float8[])`;
  return `(SELECT COUNT(*) FROM generate_subscripts($${la}::float8[], 1) AS g(i)
            WHERE (${lats}[g.i] > p.lat::float8) <> (${lats}[g.i % ${n} + 1] > p.lat::float8)
              AND p.lng::float8 < (${lngs}[g.i % ${n} + 1] - ${lngs}[g.i]) * (p.lat::float8 - ${lats}[g.i])
                                  / NULLIF(${lats}[g.i % ${n} + 1] - ${lats}[g.i], 0) + ${lngs}[g.i]) % 2 = 1`;
}

// Distance (km) de p à un point, par la formule du grand cercle ; `la` / `ln` : numéros de paramètres
const distanceSql = (la, ln) => `(6371 * acos(LEAST(1.0,
        cos(radians($${la})) * cos(radians(p.lat)) * cos(radians(p.lng) - radians($${ln})) +
        sin(radians($${la})) * sin(radians(p.lat)))))`;

module.exports = { cleanPolygon, circleBox, boxCondition, polygonCondition, distanceSql, MAX_VERTICES };
