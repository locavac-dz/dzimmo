const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

const MODES_VALIDES    = ['vente', 'location_longue', 'location_courte'];
const TYPES_VALIDES    = ['appartement','villa','maison','bureau','local_commercial','terrain','ferme','entrepot'];
const STATUTS_VALIDES  = ['active','sold','rented','archived'];

async function withOwner(property) {
  const owner = await db.users.findOne(u => u.id === property.owner_id);
  let agency = null;
  if (property.agency_id) {
    agency = await db.agencies.findOne(a => a.id === property.agency_id);
  }
  return {
    ...property,
    owner_name:   owner ? owner.name   : 'Inconnu',
    owner_phone:  owner ? owner.phone  : null,
    owner_avatar: owner ? owner.avatar : null,
    agency_name:  agency ? agency.name  : null,
    agency_logo:  agency ? agency.logo  : null,
    agency_phone: agency ? agency.phone : null,
  };
}

// GET /api/properties
router.get('/', async (req, res) => {
  const { wilaya, commune, mode, type_bien, min_price, max_price, min_surface, max_surface, rooms, q, status } = req.query;

  const all = await db.properties.find(p => {
    if (p.status !== (status || 'active')) return false;
    if (wilaya    && p.wilaya    !== wilaya)              return false;
    if (commune   && p.commune   !== commune)             return false;
    if (mode      && p.mode      !== mode)                return false;
    if (type_bien && p.type_bien !== type_bien)           return false;
    if (min_price   && p.price      < Number(min_price))  return false;
    if (max_price   && p.price      > Number(max_price))  return false;
    if (min_surface && p.surface_m2 < Number(min_surface)) return false;
    if (max_surface && p.surface_m2 > Number(max_surface)) return false;
    if (rooms     && p.rooms     <  Number(rooms))        return false;
    if (q) {
      const s = q.toLowerCase();
      if (!p.title.toLowerCase().includes(s) &&
          !(p.commune||'').toLowerCase().includes(s) &&
          !(p.wilaya||'').toLowerCase().includes(s) &&
          !(p.description||'').toLowerCase().includes(s)) return false;
    }
    return true;
  });

  all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json(await Promise.all(all.map(withOwner)));
});

// GET /api/properties/estimation — prix/m² moyen depuis la BDD (DOIT être avant /:id)
router.get('/estimation', async (req, res) => {
  const { pool } = require('../db');
  const { type_bien, wilaya, mode } = req.query;

  const buildQuery = (withWilaya) => {
    const conds  = ["status = 'active'", 'surface_m2 > 5', 'price > 0'];
    const params = [];
    if (type_bien && TYPES_VALIDES.includes(type_bien)) {
      params.push(type_bien); conds.push(`type_bien = $${params.length}`);
    }
    if (withWilaya && wilaya) {
      params.push(wilaya); conds.push(`wilaya = $${params.length}`);
    }
    if (mode && MODES_VALIDES.includes(mode)) {
      params.push(mode); conds.push(`mode = $${params.length}`);
    }
    return {
      sql: `SELECT COUNT(*)::int AS count,
        ROUND(AVG(price::numeric / surface_m2::numeric)) AS avg_pm2,
        ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP
          (ORDER BY price::numeric / surface_m2::numeric)) AS p25_pm2,
        ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP
          (ORDER BY price::numeric / surface_m2::numeric)) AS p75_pm2
      FROM properties WHERE ${conds.join(' AND ')}`,
      params,
    };
  };

  if (!mode) {
    return res.status(400).json({ error: 'mode_required' });
  }

  try {
    let scope = wilaya ? 'wilaya' : 'national';
    let q = buildQuery(true);
    let { rows } = await pool.query(q.sql, q.params);
    let d = rows[0];

    if (wilaya && (!d.count || d.count < 2)) {
      scope = 'national';
      q = buildQuery(false);
      ({ rows } = await pool.query(q.sql, q.params));
      d = rows[0];
    }

    res.json({
      count:   d.count   || 0,
      avg_pm2: d.avg_pm2 ? +d.avg_pm2 : null,
      p25_pm2: d.p25_pm2 ? +d.p25_pm2 : null,
      p75_pm2: d.p75_pm2 ? +d.p75_pm2 : null,
      scope,
    });
  } catch (err) {
    console.error('[estimation]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/properties/:id
router.get('/:id', async (req, res) => {
  const property = await db.properties.findOne(p => p.id === Number(req.params.id));
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });

  // Incrémenter les vues
  await db.properties.update(p => p.id === property.id, { views: (property.views || 0) + 1 });

  const revList = await db.reviews.find(r => r.property_id === property.id);
  const reviews = await Promise.all(
    revList
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 10)
      .map(async r => {
        const u = await db.users.findOne(u => u.id === r.author_id);
        return { ...r, author_name: u ? u.name : 'Anonyme', author_avatar: u ? u.avatar : null };
      })
  );
  res.json({ ...await withOwner(property), reviews });
});

// POST /api/properties
router.post('/', auth, async (req, res) => {
  const { title, description, mode, type_bien, price, surface_m2, rooms, baths, floor, total_floors,
          wilaya, commune, address, lat, lng, image, photos, features, agency_id } = req.body;

  if (!title || !mode || !type_bien || !price || !wilaya)
    return res.status(400).json({ error: 'Champs obligatoires : titre, mode, type, prix, wilaya.' });
  if (!MODES_VALIDES.includes(mode))
    return res.status(400).json({ error: 'Mode invalide.' });
  if (!TYPES_VALIDES.includes(type_bien))
    return res.status(400).json({ error: 'Type de bien invalide.' });

  const finalImage  = image || (Array.isArray(photos) && photos[0]) || '';
  const finalPhotos = Array.isArray(photos) && photos.length ? photos : (finalImage ? [finalImage] : []);

  const property = await db.properties.insert({
    owner_id:     req.user.id,
    agency_id:    agency_id ? Number(agency_id) : null,
    title: title.trim(), description: description || '',
    mode, type_bien, price: Number(price),
    surface_m2:   surface_m2   ? Number(surface_m2)   : null,
    rooms:        rooms        ? Number(rooms)         : null,
    baths:        baths        ? Number(baths)         : null,
    floor:        floor        !== undefined ? Number(floor)  : null,
    total_floors: total_floors ? Number(total_floors)  : null,
    wilaya, commune: commune || null, address: address || null,
    lat: lat ? Number(lat) : null, lng: lng ? Number(lng) : null,
    image: finalImage, photos: JSON.stringify(finalPhotos),
    features: JSON.stringify(Array.isArray(features) ? features : []),
    status: 'active',
  });

  await db.users.update(u => u.id === req.user.id, { is_agent: true });
  res.status(201).json({ id: property.id });
});

// PUT /api/properties/:id
router.put('/:id', auth, async (req, res) => {
  const property = await db.properties.findOne(p => p.id === Number(req.params.id));
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id !== req.user.id && !req.user.is_admin)
    return res.status(403).json({ error: 'Accès refusé.' });

  const { title, description, price, surface_m2, rooms, baths, status, features, image, photos } = req.body;
  const changes = {};
  if (title       !== undefined) changes.title       = title.trim();
  if (description !== undefined) changes.description = description;
  if (price       !== undefined) changes.price       = Number(price);
  if (surface_m2  !== undefined) changes.surface_m2  = Number(surface_m2);
  if (rooms       !== undefined) changes.rooms       = Number(rooms);
  if (baths       !== undefined) changes.baths       = Number(baths);
  if (image       !== undefined) changes.image       = image;
  if (status      !== undefined && STATUTS_VALIDES.includes(status)) changes.status = status;
  if (Array.isArray(features))   changes.features    = JSON.stringify(features);
  if (Array.isArray(photos))     changes.photos      = JSON.stringify(photos);

  await db.properties.update(p => p.id === property.id, changes);
  res.json({ ok: true });
});

// DELETE /api/properties/:id
router.delete('/:id', auth, async (req, res) => {
  const property = await db.properties.findOne(p => p.id === Number(req.params.id));
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id !== req.user.id && !req.user.is_admin)
    return res.status(403).json({ error: 'Accès refusé.' });
  await db.properties.delete(p => p.id === property.id);
  res.json({ ok: true });
});

// POST /api/properties/:id/photos
router.post('/:id/photos', auth, async (req, res) => {
  const property = await db.properties.findOne(p => p.id === Number(req.params.id));
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requise.' });
  const photos = [...(property.photos || [property.image].filter(Boolean)), url];
  await db.properties.update(p => p.id === property.id, { photos: JSON.stringify(photos) });
  res.json({ photos });
});

// DELETE /api/properties/:id/photos
router.delete('/:id/photos', auth, async (req, res) => {
  const property = await db.properties.findOne(p => p.id === Number(req.params.id));
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const { url } = req.body;
  const photos = (property.photos || []).filter(p => p !== url);
  await db.properties.update(p => p.id === property.id, { photos: JSON.stringify(photos) });
  res.json({ photos });
});

// POST /api/properties/:id/reviews
router.post('/:id/reviews', auth, async (req, res) => {
  const { rating, comment, contact_request_id } = req.body;
  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Note entre 1 et 5 requise.' });
  const pid = Number(req.params.id);

  // Vérifier qu'une demande de contact confirmée ou terminée existe
  const validContact = await db.contact_requests.findOne(c =>
    c.property_id === pid &&
    c.user_id     === req.user.id &&
    ['confirmed','done'].includes(c.status)
  );
  if (!validContact)
    return res.status(403).json({ error: 'Vous devez avoir une demande de contact confirmée pour laisser un avis.' });

  const existing = await db.reviews.findOne(r => r.property_id === pid && r.author_id === req.user.id);
  if (existing) return res.status(409).json({ error: 'Vous avez déjà laissé un avis pour ce bien.' });

  await db.reviews.insert({
    property_id: pid, author_id: req.user.id,
    contact_request_id: contact_request_id || null,
    rating: Number(rating), comment: comment || '',
  });
  const allReviews = await db.reviews.find(r => r.property_id === pid);
  const avg = allReviews.reduce((s, r) => s + Number(r.rating), 0) / allReviews.length;
  await db.properties.update(p => p.id === pid, { rating: Math.round(avg * 100) / 100, reviews: allReviews.length });
  res.status(201).json({ ok: true });
});

// POST /api/properties/:id/signaler
router.post('/:id/signaler', async (req, res) => {
  const { motif, message } = req.body;
  if (!motif) return res.status(400).json({ error: 'Motif requis.' });
  await db.pool.query(
    'INSERT INTO signalements (property_id, user_id, motif, message) VALUES ($1,$2,$3,$4)',
    [req.params.id, req.user?.id || null, motif, message || null]
  );
  res.json({ ok: true });
});

// GET /api/properties/user/:id — annonces d'un utilisateur
router.get('/user/:id', async (req, res) => {
  const uid   = Number(req.params.id);
  const props = await db.properties.find(p => p.owner_id === uid && p.status !== 'archived');
  res.json(await Promise.all(props.map(withOwner)));
});

module.exports = router;
