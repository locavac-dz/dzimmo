// Notifications push navigateur (Web Push API, VAPID).
// Gracieux si VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY sont absents : sendPush() renvoie 0.
const webpush = require('web-push');

const PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY  || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const EMAIL       = process.env.VAPID_EMAIL        || 'contact@dzimmo.dz';

if (PUBLIC_KEY && PRIVATE_KEY) {
  webpush.setVapidDetails(`mailto:${EMAIL}`, PUBLIC_KEY, PRIVATE_KEY);
}

async function sendPush(userId, payload) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return 0;
  const { pool } = require('./db');
  const r = await pool.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [Number(userId)]
  );
  if (!r.rows.length) return 0;
  const data = JSON.stringify(payload);
  let sent = 0;
  await Promise.allSettled(r.rows.map(async row => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        data
      );
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]).catch(() => {});
      }
    }
  }));
  return sent;
}

module.exports = { sendPush, publicKey: () => PUBLIC_KEY };
