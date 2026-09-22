const router = require('express').Router();
const db     = require('../db');
const search = require('../search');

// GET /api/search/suggest?q=… — autocomplétion (8 suggestions max)
// Renvoie titre, wilaya, prix, mode, type pour affichage dans la liste déroulante.
router.get('/suggest', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) return res.json([]);

  const params = [];
  const push = v => { params.push(v); return '$' + params.length; };
  const text = search.condition(q, 's.text', ['p.title', 'p.commune', 'p.wilaya'], push);
  if (!text) return res.json([]);

  const result = await db.pool.query(
    `SELECT p.id, p.title, p.wilaya, p.price, p.mode, p.type_bien
       FROM properties p
       JOIN property_search s ON s.property_id = p.id
      WHERE p.status = 'active' AND ${text}
      LIMIT 8`,
    params,
  );
  res.json(result.rows);
});

module.exports = router;
