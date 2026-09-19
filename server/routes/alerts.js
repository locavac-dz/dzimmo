const router = require('express').Router();
const { pool } = require('../db');
const auth = require('../middleware/auth');

// GET /api/alerts — mes alertes
router.get('/', auth, async (req, res) => {
  const r = await pool.query(
    'SELECT * FROM search_alerts WHERE user_id = $1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(r.rows);
});

// POST /api/alerts — créer une alerte (max 5 par user)
router.post('/', auth, async (req, res) => {
  const { wilaya, mode, type_bien, min_price, max_price, min_surface } = req.body;
  const count = await pool.query(
    'SELECT COUNT(*) FROM search_alerts WHERE user_id = $1',
    [req.user.id]
  );
  if (parseInt(count.rows[0].count) >= 5)
    return res.status(400).json({ error: 'Maximum 5 alertes autorisées par compte.' });

  const r = await pool.query(
    `INSERT INTO search_alerts (user_id, wilaya, mode, type_bien, min_price, max_price, min_surface)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      req.user.id,
      wilaya     || null,
      mode       || null,
      type_bien  || null,
      min_price  || null,
      max_price  || null,
      min_surface|| null,
    ]
  );
  res.status(201).json(r.rows[0]);
});

// DELETE /api/alerts/:id — supprimer une alerte
router.delete('/:id', auth, async (req, res) => {
  const r = await pool.query(
    'DELETE FROM search_alerts WHERE id = $1 AND user_id = $2 RETURNING id',
    [req.params.id, req.user.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'Alerte introuvable.' });
  res.json({ ok: true });
});

module.exports = router;
