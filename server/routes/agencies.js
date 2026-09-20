const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const agency   = require('../agency');
const projects = require('../projects');

// GET /api/agencies — annuaire paginé : ?kind=agence|promoteur &wilaya= &service= &q= &verified=1 &sort=relevance|listings|rating|recent|name &page= &per_page=
router.get('/', async (req, res) => {
  res.json(await agency.directory(req.query));
});

// GET /api/agencies/mine/info — agence de l'utilisateur connecté (profil complet, pour le formulaire de la vitrine)
router.get('/mine/info', auth, async (req, res) => {
  const mine = await db.agencies.findOne({ owner_id: req.user.id });
  if (!mine) return res.status(404).json({ error: 'Aucune agence trouvée.' });
  res.json(mine);
});

// GET /api/agencies/:id — fiche publique : profil, chiffres, avis, premiers programmes (les annonces se lisent par /api/properties?agency_id=)
router.get('/:id', optionalAuth, async (req, res) => {
  const a = await agency.profile(req.params.id, req.user ? req.user.id : null);
  if (!a) return res.status(404).json({ error: 'Agence introuvable.' });
  const programmes = a.verified ? (await projects.list({ agency_id: a.id, per_page: 6 })).items : [];
  res.json({ ...a, programmes });
});

// POST /api/agencies — créer sa vitrine (une par compte)
router.post('/', auth, async (req, res) => {
  const { values, error } = agency.cleanProfile(req.body, { creating: true });
  if (error) return res.status(400).json({ error });
  const existing = await db.agencies.findOne({ owner_id: req.user.id });
  if (existing) return res.status(409).json({ error: 'Vous avez déjà une agence enregistrée.' });
  const created = await db.agencies.insert({
    ...values, owner_id: req.user.id,
    verified: (await db.users.findById(req.user.id))?.verified_kind === 'business',
  });
  await db.users.update({ id: req.user.id }, { is_agent: true });
  res.status(201).json({ id: created.id });
});

// PUT /api/agencies/:id — modifier sa vitrine (le statut « vérifié » ne se change que par la vérification)
router.put('/:id', auth, async (req, res) => {
  const found = await db.agencies.findById(req.params.id);
  if (!found) return res.status(404).json({ error: 'Agence introuvable.' });
  if (found.owner_id !== req.user.id && !req.user.is_admin)
    return res.status(403).json({ error: 'Accès refusé.' });
  const { values, error } = agency.cleanProfile(req.body);
  if (error) return res.status(400).json({ error });
  if (Object.keys(values).length) await db.agencies.update({ id: found.id }, values);
  res.json({ ok: true });
});

// DELETE /api/agencies/:id — supprimer sa vitrine : ses annonces restent en ligne (rattachées au compte), ses programmes sont supprimés
router.delete('/:id', auth, async (req, res) => {
  const found = await db.agencies.findById(req.params.id);
  if (!found) return res.status(404).json({ error: 'Agence introuvable.' });
  if (found.owner_id !== req.user.id && !req.user.is_admin)
    return res.status(403).json({ error: 'Accès refusé.' });
  await db.agencies.delete({ id: found.id });
  res.json({ ok: true });
});

module.exports = router;
