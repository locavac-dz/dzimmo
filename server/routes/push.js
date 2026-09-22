const router = require('express').Router();
const auth   = require('../middleware/auth');
const db     = require('../db');
const push   = require('../push');

// GET /api/push/key — clé publique VAPID (publique, comme TURNSTILE_SITE_KEY)
router.get('/key', (req, res) => {
  res.json({ key: push.publicKey() });
});

// POST /api/push/subscribe — enregistre ou met à jour un abonnement push
router.post('/subscribe', auth, async (req, res) => {
  const { endpoint, p256dh, auth: authKey } = req.body;
  if (!endpoint || !p256dh || !authKey)
    return res.status(400).json({ error: 'Abonnement push invalide.' });
  await db.pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, updated_at = NOW()`,
    [req.user.id, endpoint, p256dh, authKey]
  );
  res.json({ ok: true });
});

// DELETE /api/push/subscribe — désenregistre l'abonnement (déconnexion)
router.delete('/subscribe', auth, async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    await db.pool.query(
      'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
      [endpoint, req.user.id]
    );
  }
  res.json({ ok: true });
});

module.exports = router;
