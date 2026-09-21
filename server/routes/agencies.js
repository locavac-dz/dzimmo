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

// GET /api/agencies/me/stats — stats globales des 30 derniers jours pour toutes les annonces de l'agence de l'utilisateur connecté.
// totals : vues, favoris, clics (appels / WhatsApp), demandes de contact, nombre d'annonces actives et total.
// top : 5 annonces les plus vues sur la période (id, titre, statut, views_30d, contacts_30d).
router.get('/me/stats', auth, async (req, res) => {
  const mine = await db.agencies.findOne({ owner_id: req.user.id });
  if (!mine) return res.status(404).json({ error: 'Aucune agence trouvée.' });

  const [daysR, views, favorites, clicks, favTotal, contacts, counts, top] = await Promise.all([
    db.pool.query(`SELECT to_char(d, 'YYYY-MM-DD') AS day FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, interval '1 day') d ORDER BY d`),
    db.pool.query(
      `SELECT day::text, SUM(views)::int AS views FROM property_views_daily
       WHERE property_id IN (SELECT id FROM properties WHERE agency_id = $1)
         AND day >= CURRENT_DATE - 29
       GROUP BY day ORDER BY day`, [mine.id]
    ),
    db.pool.query(
      `SELECT created_at::date::text AS day, COUNT(*)::int AS n FROM favorites
       WHERE property_id IN (SELECT id FROM properties WHERE agency_id = $1)
         AND created_at >= CURRENT_DATE - 29
       GROUP BY 1 ORDER BY 1`, [mine.id]
    ),
    db.pool.query(
      `SELECT day::text, channel, SUM(n)::int AS n FROM contact_clicks
       WHERE property_id IN (SELECT id FROM properties WHERE agency_id = $1)
         AND day >= CURRENT_DATE - 29
       GROUP BY day, channel ORDER BY day`, [mine.id]
    ),
    db.pool.query(
      `SELECT COUNT(*)::int AS n FROM favorites
       WHERE property_id IN (SELECT id FROM properties WHERE agency_id = $1)`, [mine.id]
    ),
    db.pool.query(
      `SELECT COUNT(*)::int AS n FROM contact_requests
       WHERE property_id IN (SELECT id FROM properties WHERE agency_id = $1)
         AND created_at >= CURRENT_DATE - 29`, [mine.id]
    ),
    db.pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'active')::int AS active
       FROM properties WHERE agency_id = $1`, [mine.id]
    ),
    db.pool.query(
      `SELECT p.id, p.title, p.status,
              (SELECT COALESCE(SUM(v.views), 0)::int FROM property_views_daily v
               WHERE v.property_id = p.id AND v.day >= CURRENT_DATE - 29)  AS views_30d,
              (SELECT COUNT(*)::int FROM contact_requests cr
               WHERE cr.property_id = p.id AND cr.created_at >= CURRENT_DATE - 29) AS contacts_30d
       FROM properties p
       WHERE p.agency_id = $1
       ORDER BY views_30d DESC, p.id DESC
       LIMIT 5`, [mine.id]
    ),
  ]);

  const list = daysR.rows.map(r => r.day);
  const daily = (rows, pick) => {
    const m = {};
    rows.forEach(r => { m[r.day] = (m[r.day] || 0) + Number(pick(r)); });
    return list.map(d => m[d] || 0);
  };
  const channel = ch => clicks.rows.filter(r => r.channel === ch);
  const series = {
    views:     daily(views.rows, r => r.views),
    favorites: daily(favorites.rows, r => r.n),
    clicks:    daily(clicks.rows, r => r.n),
  };
  const total = a => a.reduce((t, v) => t + v, 0);
  const c = counts.rows[0] || { total: 0, active: 0 };

  res.json({
    days: list,
    views: views.rows,
    favorites: favorites.rows,
    clicks: clicks.rows,
    totals: {
      views_30d:        total(series.views),
      views_7d:         total(series.views.slice(-7)),
      favorites_30d:    total(series.favorites),
      favorites_total:  favTotal.rows[0].n,
      calls_30d:        total(daily(channel('call'),      r => r.n)),
      whatsapps_30d:    total(daily(channel('whatsapp'),  r => r.n)),
      contacts_30d:     contacts.rows[0].n,
      listings_active:  c.active,
      listings_total:   c.total,
    },
    top: top.rows,
  });
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
