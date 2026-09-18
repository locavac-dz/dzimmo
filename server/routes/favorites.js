const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET /api/favorites — favoris de l'utilisateur
router.get('/', auth, async (req, res) => {
  const favs = await db.favorites.find(f => f.user_id === req.user.id);
  const result = await Promise.all(favs.map(async f => {
    const p = await db.properties.findOne(pr => pr.id === f.property_id);
    if (!p) return null;
    return { fav_id: f.id, created_at: f.created_at, ...p };
  }));
  res.json(result.filter(Boolean));
});

// POST /api/favorites — ajouter un favori
router.post('/', auth, async (req, res) => {
  const { property_id } = req.body;
  if (!property_id) return res.status(400).json({ error: 'property_id requis.' });
  const property = await db.properties.findOne(p => p.id === Number(property_id));
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  try {
    const fav = await db.favorites.insert({ user_id: req.user.id, property_id: Number(property_id) });
    res.status(201).json({ id: fav.id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Déjà dans les favoris.' });
    throw e;
  }
});

// DELETE /api/favorites/:property_id — supprimer un favori
router.delete('/:property_id', auth, async (req, res) => {
  await db.favorites.delete(f => f.user_id === req.user.id && f.property_id === Number(req.params.property_id));
  res.json({ ok: true });
});

// GET /api/favorites/check/:property_id
router.get('/check/:property_id', auth, async (req, res) => {
  const fav = await db.favorites.findOne(f => f.user_id === req.user.id && f.property_id === Number(req.params.property_id));
  res.json({ is_favorite: !!fav });
});

module.exports = router;
