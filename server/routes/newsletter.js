const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');

function unsubToken(email) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(email.toLowerCase().trim()).digest('hex').slice(0, 32);
}

// POST /api/newsletter/subscribe
router.post('/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Adresse email invalide.' });
  try {
    await pool.query(
      'INSERT INTO newsletter_subscribers (email) VALUES ($1)',
      [email.toLowerCase().trim()]
    );
    res.json({ ok: true, unsubToken: unsubToken(email) });
  } catch (e) {
    if (e.code === '23505') return res.json({ ok: true, unsubToken: unsubToken(email) }); // déjà inscrit — silencieux
    throw e;
  }
});

// DELETE /api/newsletter/unsubscribe
router.delete('/unsubscribe', async (req, res) => {
  const { email, token } = req.body;
  if (!email || !token) return res.status(400).json({ error: 'Email et token requis.' });
  if (token !== unsubToken(email))
    return res.status(403).json({ error: 'Token invalide.' });
  await pool.query('DELETE FROM newsletter_subscribers WHERE email = $1', [email.toLowerCase().trim()]);
  res.json({ ok: true });
});

module.exports = router;
