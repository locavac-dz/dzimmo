const crypto = require('crypto');
const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET /api/favorites — favoris de l'utilisateur (les annonces en attente ou refusées n'y apparaissent pas)
router.get('/', auth, async (req, res) => {
  const r = await db.pool.query(
    `SELECT f.id AS fav_id, f.created_at, f.note, p.*
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

// GET /api/favorites/check/:property_id
router.get('/check/:property_id', auth, async (req, res) => {
  const fav = await db.favorites.findOne({ user_id: req.user.id, property_id: db.toId(req.params.property_id) ?? 0 });
  res.json({ is_favorite: !!fav });
});

// POST /api/favorites/share — génère (ou renouvelle) un jeton de partage de liste de favoris
router.post('/share', auth, async (req, res) => {
  const token = crypto.randomBytes(32).toString('hex');
  await db.pool.query('UPDATE users SET favorites_share_token = $1 WHERE id = $2', [token, req.user.id]);
  res.json({ token, url: `/favoris-partages/${token}` });
});

// DELETE /api/favorites/share — révoque le lien de partage (doit être avant DELETE /:property_id)
router.delete('/share', auth, async (req, res) => {
  await db.pool.query('UPDATE users SET favorites_share_token = NULL WHERE id = $1', [req.user.id]);
  res.json({ ok: true });
});

// PUT /api/favorites/:property_id/note — ajouter ou modifier la note privée d'un favori
router.put('/:property_id/note', auth, async (req, res) => {
  const propId = db.toId(req.params.property_id);
  if (propId === null) return res.status(404).json({ error: 'Favori introuvable.' });
  const { note } = req.body;
  if (note !== null && note !== undefined && (typeof note !== 'string' || note.length > 500))
    return res.status(400).json({ error: 'Note invalide (500 caractères maximum).' });
  const r = await db.pool.query(
    `UPDATE favorites SET note = $1 WHERE user_id = $2 AND property_id = $3 RETURNING id`,
    [note || null, req.user.id, propId]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'Favori introuvable.' });
  res.json({ ok: true });
});

// DELETE /api/favorites/:property_id — supprimer un favori
router.delete('/:property_id', auth, async (req, res) => {
  await db.favorites.delete({ user_id: req.user.id, property_id: db.toId(req.params.property_id) ?? 0 });
  res.json({ ok: true });
});

// GET /api/favorites/shared/:token — liste publique des favoris d'un utilisateur (sans auth, sans données personnelles)
router.get('/shared/:token', async (req, res) => {
  const token = req.params.token;
  if (!/^[0-9a-f]{64}$/.test(token)) return res.status(404).json({ error: 'Lien invalide.' });
  const user = (await db.pool.query(
    'SELECT id FROM users WHERE favorites_share_token = $1 AND banned = false', [token])).rows[0];
  if (!user) return res.status(404).json({ error: 'Lien invalide.' });
  const r = await db.pool.query(
    `SELECT f.created_at AS fav_at, p.*
       FROM favorites f
       JOIN properties p ON p.id = f.property_id
      WHERE f.user_id = $1 AND p.status NOT IN ('pending', 'rejected')
      ORDER BY f.id`, [user.id]);
  res.json(r.rows);
});

module.exports = router;
