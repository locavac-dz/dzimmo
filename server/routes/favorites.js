const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET /api/favorites — favoris de l'utilisateur (les annonces en attente ou refusées n'y apparaissent pas)
router.get('/', auth, async (req, res) => {
  const r = await db.pool.query(
    `SELECT f.id AS fav_id, f.created_at, p.*
       FROM favorites f
       JOIN properties p ON p.id = f.property_id
      WHERE f.user_id = $1 AND p.status NOT IN ('pending', 'rejected')
      ORDER BY f.id`, [req.user.id]);
  res.json(r.rows);
});

// POST /api/favorites — ajouter un favori
router.post('/', auth, async (req, res) => {
  const { property_id } = req.body;
  if (!property_id) return res.status(400).json({ error: 'property_id requis.' });
  const property = await db.properties.findById(property_id);
  if (!property || ['pending', 'rejected'].includes(property.status))
    return res.status(404).json({ error: 'Annonce introuvable.' });
  try {
    const fav = await db.favorites.insert({ user_id: req.user.id, property_id: property.id });
    res.status(201).json({ id: fav.id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Déjà dans les favoris.' });
    throw e;
  }
});

// DELETE /api/favorites/:property_id — supprimer un favori
router.delete('/:property_id', auth, async (req, res) => {
  await db.favorites.delete({ user_id: req.user.id, property_id: db.toId(req.params.property_id) ?? 0 });
  res.json({ ok: true });
});

// GET /api/favorites/check/:property_id
router.get('/check/:property_id', auth, async (req, res) => {
  const fav = await db.favorites.findOne({ user_id: req.user.id, property_id: db.toId(req.params.property_id) ?? 0 });
  res.json({ is_favorite: !!fav });
});

module.exports = router;
