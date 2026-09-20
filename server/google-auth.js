// Vérification du jeton d'identité « Sign in with Google » (Google Identity Services), sans dépendance :
// signature RS256 contrôlée avec les certificats publics de Google (jsonwebtoken), puis audience (notre GOOGLE_CLIENT_ID),
// émetteur et expiration. Les certificats sont mis en cache selon l'en-tête Cache-Control de Google.
const jwt = require('jsonwebtoken');

const CERTS_URL = 'https://www.googleapis.com/oauth2/v1/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const MIN_REFRESH_MS = 60 * 1000;    // un identifiant de clé inconnu ne relance pas plus d'un téléchargement par minute

async function downloadCerts() {
  const r = await fetch(CERTS_URL, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`certificats Google indisponibles (HTTP ${r.status})`);
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  return { certs: await r.json(), ttl: (m ? Number(m[1]) : 3600) * 1000 };
}

let fetcher = downloadCerts;         // remplaçable (tests : aucun accès réseau)
let cache = null;                    // { certs, fetchedAt, expires }
let inflight = null;                 // téléchargement en cours, partagé par les requêtes simultanées

function setCertFetcher(fn) { fetcher = fn || downloadCerts; cache = null; inflight = null; }

function loadCerts() {
  inflight ??= fetcher()
    .then(({ certs, ttl }) => {
      const now = Date.now();
      cache = { certs, fetchedAt: now, expires: now + Math.max(60 * 1000, Math.min(ttl, 24 * 3600 * 1000)) };
      return cache.certs;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

async function certificate(kid) {
  let certs = cache && Date.now() < cache.expires ? cache.certs : await loadCerts();
  // Rotation des clés : un identifiant inconnu déclenche (au plus une fois par minute) un nouveau téléchargement
  if (!certs[kid] && cache && Date.now() - cache.fetchedAt > MIN_REFRESH_MS) certs = await loadCerts();
  return certs[kid];
}

// Renvoie les revendications du jeton ou lève une erreur (jeton falsifié, expiré, destiné à une autre application…)
async function verifyIdToken(idToken, clientId) {
  if (!clientId) throw new Error('[google] GOOGLE_CLIENT_ID absent');
  const decoded = jwt.decode(idToken, { complete: true });
  // RS256 imposé : ni « none », ni HS256 signé avec la clé publique
  if (!decoded || decoded.header.alg !== 'RS256' || typeof decoded.header.kid !== 'string') throw new Error('[google] en-tête invalide');
  const pem = await certificate(decoded.header.kid);
  if (!pem) throw new Error('[google] clé de signature inconnue');
  const claims = jwt.verify(idToken, pem, { algorithms: ['RS256'], audience: clientId, issuer: ISSUERS });
  if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || !claims.email)
    throw new Error('[google] identité incomplète');
  return claims;
}

module.exports = { verifyIdToken, setCertFetcher };
