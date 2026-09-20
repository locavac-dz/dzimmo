// ── Clics « Appeler » / « WhatsApp » ─────────────────────────────────────────
// Compteurs anonymes par annonce, jour et canal (table contact_clicks) : ni adresse IP ni identifiant de visiteur n'est stocké.
// Pour qu'un compteur reste honnête, un même visiteur (adresse IP, connue seulement en mémoire) ne compte qu'une fois par annonce
// et par canal pendant DEDUP_MS : recharger la page ou cliquer dix fois ne gonfle pas les chiffres.
const db = require('./db');

const CHANNELS = ['call', 'whatsapp'];
const DEDUP_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 50000;

const seen = new Map();   // « ip|annonce|canal » → date du dernier clic compté

// true si ce visiteur n'a pas déjà été compté récemment (et le mémorise)
function firstRecently(ip, propertyId, channel, now = Date.now()) {
  const key = `${ip}|${propertyId}|${channel}`;
  const last = seen.get(key);
  if (last !== undefined && now - last < DEDUP_MS) return false;
  if (seen.size >= MAX_ENTRIES) {                 // purge : d'abord les entrées périmées, sinon la moitié des plus anciennes
    for (const [k, t] of seen) if (now - t >= DEDUP_MS) seen.delete(k);
    if (seen.size >= MAX_ENTRIES) { let i = 0; for (const k of seen.keys()) { if (i++ >= MAX_ENTRIES / 2) break; seen.delete(k); } }
  }
  seen.set(key, now);
  return true;
}

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

module.exports = { CHANNELS, DEDUP_MS, firstRecently, record, totalsForOwner, _seen: seen };
