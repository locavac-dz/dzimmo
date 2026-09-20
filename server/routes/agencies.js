const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET /api/agencies — liste des agences avec compteur d'annonces actives
router.get('/', async (req, res) => {
  const { wilaya, q } = req.query;
  const { pool } = db;

  const conds  = [];
  const params = [];
  let   idx    = 1;
  if (wilaya) { conds.push(`a.wilaya = $${idx++}`); params.push(wilaya); }
  if (q) {
    const like = '%' + q.toLowerCase() + '%';
    conds.push(`(LOWER(a.name) LIKE $${idx} OR LOWER(COALESCE(a.description,'')) LIKE $${idx})`);
    params.push(like); idx++;
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const r = await pool.query(
    `SELECT a.*,
       COUNT(p.id) FILTER (WHERE p.status = 'active') AS property_count
     FROM agencies a
     LEFT JOIN properties p ON p.agency_id = a.id
     ${where}
     GROUP BY a.id
     ORDER BY property_count DESC, a.name`,
    params
  );
  res.json(r.rows.map(row => ({ ...row, property_count: parseInt(row.property_count) })));
});

// GET /api/agencies/:id
router.get('/:id', async (req, res) => {
  const agency = await db.agencies.findById(req.params.id);
  if (!agency) return res.status(404).json({ error: 'Agence introuvable.' });
  const where = { agency_id: agency.id, status: 'active' };
  const [properties, property_count] = await Promise.all([
    db.properties.find(where, { limit: 12 }), db.properties.count(where),
  ]);
  res.json({ ...agency, property_count, properties });
});

// POST /api/agencies — créer une agence
router.post('/', auth, async (req, res) => {
  const { name, description, phone, address, wilaya, logo, website } = req.body;
  if (!name || !wilaya) return res.status(400).json({ error: 'Nom et wilaya requis.' });
  const existing = await db.agencies.findOne({ owner_id: req.user.id });
  if (existing) return res.status(409).json({ error: 'Vous avez déjà une agence enregistrée.' });
  const agency = await db.agencies.insert({
    owner_id: req.user.id, name: name.trim(),
    description: description || null, phone: phone || null,
    address: address || null, wilaya,
    logo: logo || null, website: website || null,
    verified: (await db.users.findById(req.user.id))?.verified_kind === 'business',
  });
  await db.users.update({ id: req.user.id }, { is_agent: true });
  res.status(201).json({ id: agency.id });
});

// PUT /api/agencies/:id — modifier son agence
router.put('/:id', auth, async (req, res) => {
  const agency = await db.agencies.findById(req.params.id);
  if (!agency) return res.status(404).json({ error: 'Agence introuvable.' });
  if (agency.owner_id !== req.user.id && !req.user.is_admin)
    return res.status(403).json({ error: 'Accès refusé.' });
  const { name, description, phone, address, logo, website } = req.body;
  const changes = {};
  if (name        !== undefined) changes.name        = name.trim();
  if (description !== undefined) changes.description = description;
  if (phone       !== undefined) changes.phone       = phone || null;
  if (address     !== undefined) changes.address     = address || null;
  if (logo        !== undefined) changes.logo        = logo || null;
  if (website     !== undefined) changes.website     = website || null;
  await db.agencies.update({ id: agency.id }, changes);
  res.json({ ok: true });
});

// GET /api/agencies/mine — agence de l'utilisateur connecté
router.get('/mine/info', auth, async (req, res) => {
  const agency = await db.agencies.findOne({ owner_id: req.user.id });
  if (!agency) return res.status(404).json({ error: 'Aucune agence trouvée.' });
  res.json(agency);
});

module.exports = router;
