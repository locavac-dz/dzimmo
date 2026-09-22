// Vérification Cloudflare Turnstile côté serveur.
// TURNSTILE_SECRET absent (développement, tests) → toujours valide.
// Cloudflare injoignable → on laisse passer (même règle que les limiteurs de débit).

const SECRET   = process.env.TURNSTILE_SECRET || '';
const ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyWith(secret, token, ip) {
  if (!secret) return true;
  if (!token || typeof token !== 'string') return false;
  try {
    const r = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ secret, response: token, remoteip: ip }),
      signal:  AbortSignal.timeout(5000),
    });
    return (await r.json()).success === true;
  } catch {
    return true;   // réseau dégradé → on laisse passer plutôt que de bloquer le site
  }
}

async function verify(token, ip) {
  return verifyWith(SECRET, token, ip);
}

module.exports = { verify, verifyWith };
