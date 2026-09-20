// ── Clics « Appeler » / « WhatsApp » ─────────────────────────────────────────
// Compteurs anonymes par annonce, jour et canal (table contact_clicks) : ni adresse IP ni identifiant de visiteur n'est stocké.
// Pour qu'un compteur reste honnête, un même visiteur (adresse IP, jamais stockée en clair) ne compte qu'une fois par annonce
// et par canal pendant DEDUP_MS : recharger la page ou cliquer dix fois ne gonfle pas les chiffres.
const db = require('./db');
const rateStore = require('./rate-store');

const CHANNELS = ['call', 'whatsapp'];
const DEDUP_MS = 10 * 60 * 1000;

// true si ce visiteur n'a pas déjà été compté récemment. Le souvenir est partagé entre les workers pm2 (table rate_limits) :
// en mémoire, un même visiteur était compté une fois par worker. Seul un HMAC de « adresse|annonce|canal » est gardé, dix minutes.
const firstRecently = (ip, propertyId, channel) => rateStore.firstInWindow('clic', `${ip}|${propertyId}|${channel}`, DEDUP_MS);

async function record(propertyId, channel) {
  await db.pool.query(
    `INSERT INTO contact_clicks (property_id, day, channel, n) VALUES ($1, CURRENT_DATE, $2, 1)
     ON CONFLICT (property_id, day, channel) DO UPDATE SET n = contact_clicks.n + 1`, [propertyId, channel]);
}

// Totaux d'un annonceur : tous ses clics, et ceux des 30 derniers jours
async function totalsForOwner(ownerId) {
  const r = await db.pool.query(
    `SELECT COALESCE(SUM(k.n) FILTER (WHERE k.channel = 'call'), 0)::int                                  AS calls,
            COALESCE(SUM(k.n) FILTER (WHERE k.channel = 'whatsapp'), 0)::int                              AS whatsapps,
            COALESCE(SUM(k.n) FILTER (WHERE k.channel = 'call' AND k.day > CURRENT_DATE - 30), 0)::int     AS calls_30d,
            COALESCE(SUM(k.n) FILTER (WHERE k.channel = 'whatsapp' AND k.day > CURRENT_DATE - 30), 0)::int AS whatsapps_30d
       FROM contact_clicks k JOIN properties p ON p.id = k.property_id
      WHERE p.owner_id = $1`, [ownerId]);
  return r.rows[0];
}

module.exports = { CHANNELS, DEDUP_MS, firstRecently, record, totalsForOwner };
