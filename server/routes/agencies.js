const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET /api/agencies — liste des agences
router.get('/', async (req, res) => {
  const { wilaya, q } = req.query;
  const all = await db.agencies.find(a => {
    if (wilaya && a.wilaya !== wilaya) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!a.name.toLowerCase().includes(s) && !(a.description||'').toLowerCase().includes(s)) return false;
    }
    return true;
  });
  res.json(all);
});

// GET /api/agencies/:id
router.get('/:id', async (req, res) => {
  const agency = await db.agencies.findOne(a => a.id === Number(req.params.id));
  if (!agency) return res.status(404).json({ error: 'Agence introuvable.' });
  const properties = await db.properties.find(p => p.agency_id === agency.id && p.status === 'active');
  res.json({ ...agency, property_count: properties.length, properties: properties.slice(0, 12) });
});

// POST /api/agencies — créer une agence
router.post('/', auth, async (req, res) => {
  const { name, description, phone, address, wilaya, logo, website } = req.body;
  if (!name || !wilaya) return res.status(400).json({ error: 'Nom et wilaya requis.' });
  const existing = await db.agencies.findOne(a => a.owner_id === req.user.id);
  if (existing) return res.status(409).json({ error: 'Vous avez déjà une agence enregistrée.' });
  const agency = await db.agencies.insert({
    owner_id: req.user.id, name: name.trim(),
    description: description || null, phone: phone || null,
    address: address || null, wilaya,
    logo: logo || null, website: website || null,
    verified: false,
  });
  await db.users.update(u => u.id === req.user.id, { is_agent: true });
  res.status(201).json({ id: agency.id });
});

// PUT /api/agencies/:id — modifier son agence
router.put('/:id', auth, async (req, res) => {
  const agency = await db.agencies.findOne(a => a.id === Number(req.params.id));
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
  await db.agencies.update(a => a.id === agency.id, changes);
  res.json({ ok: true });
});

// GET /api/agencies/mine — agence de l'utilisateur connecté
router.get('/mine/info', auth, async (req, res) => {
  const agency = await db.agencies.findOne(a => a.owner_id === req.user.id);
  if (!agency) return res.status(404).json({ error: 'Aucune agence trouvée.' });
  res.json(agency);
});

module.exports = router;
