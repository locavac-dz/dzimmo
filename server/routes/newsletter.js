const router = require('express').Router();
const { pool } = require('../db');

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
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.json({ ok: true }); // déjà inscrit — silencieux
    throw e;
  }
});

// DELETE /api/newsletter/unsubscribe
router.delete('/unsubscribe', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis.' });
  await pool.query('DELETE FROM newsletter_subscribers WHERE email = $1', [email.toLowerCase().trim()]);
  res.json({ ok: true });
});

module.exports = router;
