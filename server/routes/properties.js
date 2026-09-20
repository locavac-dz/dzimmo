const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const moderation   = require('../moderation');
const search = require('../search');
const { isRevoked } = require('../sessions');
const quality = require('../quality');
const expiry  = require('../expiry');
const clicks  = require('../clicks');
const images  = require('../images');

const MODES_VALIDES    = ['vente', 'location_longue', 'location_courte'];
const TYPES_VALIDES    = ['appartement','villa','maison','bureau','local_commercial','terrain','ferme','entrepot'];
// Statuts qu'un propriétaire peut demander ; « pending » / « rejected » relèvent de la modération
const STATUTS_VALIDES  = ['active','sold','rented','archived'];
// Statuts consultables par le public dans les listes
const STATUTS_PUBLICS  = ['active','sold','rented'];

async function withOwner(property) {
  const [owner, agency, project] = await Promise.all([
    db.users.findById(property.owner_id),
    property.agency_id ? db.agencies.findById(property.agency_id) : null,
    property.project_id ? db.pool.query(
      `SELECT j.id, j.name, j.status FROM projects j JOIN agencies a ON a.id = j.agency_id
        WHERE j.id = $1 AND COALESCE(a.verified, false) = true`, [property.project_id]) : null,
  ]);
  return {
    ...property,
    owner_name:   owner ? owner.name   : 'Inconnu',
    owner_phone:  owner ? owner.phone  : null,
    owner_avatar: owner ? owner.avatar : null,
    owner_verified_kind: owner ? owner.verified_kind || null : null,
    agency_verified: agency ? !!agency.verified : false,
    agency_name:  agency ? agency.name  : null,
    agency_logo:  agency ? agency.logo  : null,
    agency_phone: agency ? agency.phone : null,
    agency_kind:  agency ? agency.kind  : null,
    project:      project && project.rows[0] ? project.rows[0] : null,
  };
}

// Rattachement d'une annonce à une agence et à un programme : uniquement les siens. Sans ce contrôle, n'importe qui pourrait publier
// sous le nom, le logo et le numéro d'une autre agence. Renvoie { values } (colonnes à écrire) ou { error, status }.
// « current » : rattachement actuel de l'annonce à la modification (undefined dans le corps = inchangé).
async function affiliation(user, body, current = {}) {
  const out = {};
  const blank = v => v === null || v === '';
  if (body.agency_id !== undefined) {
    if (blank(body.agency_id)) out.agency_id = null;
    else {
      const a = await db.agencies.findById(body.agency_id);
      if (!a) return { error: 'Agence introuvable.', status: 404 };
      if (a.owner_id !== user.id && !user.is_admin) return { error: "Vous ne pouvez publier qu'au nom de votre propre agence.", status: 403 };
      out.agency_id = a.id;
    }
  }
  if (body.project_id !== undefined) {
    if (blank(body.project_id)) out.project_id = null;
    else {
      const j = (await db.pool.query(
        'SELECT j.id, j.agency_id, a.owner_id FROM projects j JOIN agencies a ON a.id = j.agency_id WHERE j.id = $1', [db.toId(body.project_id) ?? 0])).rows[0];
      if (!j) return { error: 'Programme introuvable.', status: 404 };
      if (j.owner_id !== user.id && !user.is_admin) return { error: "Vous ne pouvez publier qu'au nom de votre propre agence.", status: 403 };
      const agencyId = out.agency_id !== undefined ? out.agency_id : current.agency_id;
      if (agencyId && agencyId !== j.agency_id) return { error: "Ce programme n'appartient pas à l'agence choisie.", status: 400 };
      out.project_id = j.id;
      out.agency_id  = j.agency_id;   // un lot de programme est toujours publié au nom du promoteur
    }
  }
  // Changer d'agence (ou la retirer) détache le programme de l'ancienne
  if (out.agency_id !== undefined && out.agency_id !== current.agency_id && out.project_id === undefined) out.project_id = null;
  return { values: out };
}

// GET /api/properties — avec pagination SQL
router.get('/', optionalAuth, async (req, res) => {
  const { wilaya, commune, mode, type_bien, min_price, max_price,
          min_surface, max_surface, rooms, q, status,
          page, limit: limitQ, sort } = req.query;

  // Les annonces en attente / refusées / archivées ne sont pas listables publiquement
  if (status && !STATUTS_PUBLICS.includes(status) && !req.user?.is_admin)
    return res.status(403).json({ error: 'Statut non autorisé.' });

  // Chaque tri se termine par l'id : les ex æquo ne changent plus d'ordre d'une requête à l'autre
  // (sinon une annonce peut apparaître sur deux pages ou sur aucune) et les index (004) suivent le même ordre.
  const SORTS = {
    date_desc:    'p.created_at DESC, p.id DESC',
    date_asc:     'p.created_at ASC, p.id ASC',
    price_asc:    'p.price ASC, p.id ASC',
    price_desc:   'p.price DESC, p.id DESC',
    surface_desc: 'p.surface_m2 DESC NULLS LAST, p.id DESC',
  };
  const orderBy = SORTS[sort] || SORTS.date_desc;

  const { pool } = db;
  const conds  = [];
  const params = [];
  let   idx    = 1;

  const add = (sql, val) => { conds.push(sql.replace('?', `$${idx++}`)); params.push(val); };

  add('p.status = ?', status || 'active');
  if (wilaya)                                     add('p.wilaya = ?',       wilaya);
  if (commune)                                    add('p.commune = ?',      commune);
  if (db.toId(req.query.agency_id)  !== null)     add('p.agency_id = ?',    db.toId(req.query.agency_id));    // vitrine d'une agence
  if (db.toId(req.query.project_id) !== null)     add('p.project_id = ?',   db.toId(req.query.project_id));   // lots d'un programme
  if (mode      && MODES_VALIDES.includes(mode))  add('p.mode = ?',        mode);
  if (type_bien && TYPES_VALIDES.includes(type_bien)) add('p.type_bien = ?', type_bien);
  // Bornes numériques : une valeur qui n'est pas un nombre fini (« abc », liste, vide) est ignorée
  const num = v => (v !== '' && v != null && Number.isFinite(Number(v))) ? Number(v) : null;
  if (num(min_price)   !== null) add('p.price >= ?',      num(min_price));
  if (num(max_price)   !== null) add('p.price <= ?',      num(max_price));
  if (num(min_surface) !== null) add('p.surface_m2 >= ?', num(min_surface));
  if (num(max_surface) !== null) add('p.surface_m2 <= ?', num(max_surface));
  if (num(rooms)       !== null) add('p.rooms >= ?',      Math.min(1000, Math.ceil(num(rooms)))); // colonne entière
  // Recherche tolérante (accents, arabe, français ↔ arabe) : chaque mot de la requête doit figurer dans le texte de recherche de l'annonce
  // (server/search.js). Requête sans mot cherchable (« % » seul) : recherche brute comme avant ; vide ou non textuelle : ignorée.
  const text = search.condition(q, 's.text', ['p.title', 'p.commune', 'p.wilaya', 'p.description'], v => { params.push(v); return '$' + idx++; });
  if (text) conds.push(`EXISTS (SELECT 1 FROM property_search s WHERE s.property_id = p.id AND ${text})`);

  const where    = 'WHERE ' + conds.join(' AND ');
  const limitNum = Math.min(200, Math.max(1, parseInt(limitQ) || 12));
  const pageNum  = Math.min(1000000, Math.max(1, parseInt(page) || 1)); // plafond : un OFFSET géant ferait échouer SQL
  const offset   = (pageNum - 1) * limitNum;

  // La page est choisie (tri + LIMIT) sur properties seule, puis on joint propriétaire et agence pour ces
  // quelques lignes : joindre d'abord obligeait à rattacher toutes les annonces correspondantes avant de trier.
  const [countR, dataR] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM properties p ${where}`, params),
    pool.query(
      `SELECT p.*,
         u.name   AS owner_name,  u.phone  AS owner_phone,  u.avatar AS owner_avatar,  u.verified_kind AS owner_verified_kind,
         a.name   AS agency_name, a.logo   AS agency_logo,  a.phone  AS agency_phone,  COALESCE(a.verified, false) AS agency_verified, a.kind AS agency_kind
       FROM (SELECT p.* FROM properties p
              ${where}
              ORDER BY ${orderBy}
              LIMIT $${idx} OFFSET $${idx + 1}) p
       LEFT JOIN users    u ON u.id = p.owner_id
       LEFT JOIN agencies a ON a.id = p.agency_id
       ORDER BY ${orderBy}`,
      [...params, limitNum, offset]
    ),
  ]);

  const total = parseInt(countR.rows[0].count);
  res.json({
    data:  dataR.rows,
    total,
    page:  pageNum,
    pages: Math.ceil(total / limitNum) || 1,
    limit: limitNum,
  });
});

// GET /api/properties/estimation — prix/m² moyen depuis la BDD (DOIT être avant /:id)
router.get('/estimation', async (req, res) => {
  const { pool } = db;
  const { type_bien, wilaya, mode, rooms } = req.query;
  const roomsInt = rooms ? parseInt(rooms, 10) : NaN;

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
    if (!isNaN(roomsInt)) {
      if (roomsInt >= 6) {
        conds.push('rooms >= 6');
      } else {
        params.push(roomsInt); conds.push(`rooms = $${params.length}`);
      }
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
    res.status(500).json({ error: 'Erreur lors du calcul de l\'estimation.' });
  }
});

// GET /api/properties/:id
router.get('/:id', optionalAuth, async (req, res) => {
  const property = await db.properties.findById(req.params.id);
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });

  // En attente / refusée : visible uniquement de son propriétaire et des admins (404 pour les autres)
  const hidden = moderation.HIDDEN_STATUSES.includes(property.status);
  let staff = !!req.user && (req.user.is_admin || req.user.id === property.owner_id);
  if (hidden && staff) {
    // Annonce non publique : le compte est relu en base (jeton révoqué, compte suspendu ou rôle retiré = 404)
    const u = await db.users.findById(req.user.id);
    staff = !!u && !u.banned && !isRevoked(req.user, u) && (u.is_admin || u.id === property.owner_id);
  }
  if (hidden && !staff) return res.status(404).json({ error: 'Annonce introuvable.' });

  // Incrémenter les vues (pas pour une annonce non publiée)
  // (incrément atomique en SQL : deux visites simultanées comptent bien deux vues)
  if (!hidden) await db.pool.query('UPDATE properties SET views = COALESCE(views, 0) + 1 WHERE id = $1', [property.id]);

  const [reviews, detail] = await Promise.all([
    db.pool.query(
      `SELECT r.*, COALESCE(u.name, 'Anonyme') AS author_name, u.avatar AS author_avatar
         FROM reviews r
         LEFT JOIN users u ON u.id = r.author_id
        WHERE r.property_id = $1
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 10`, [property.id]),
    withOwner(property),
  ]);
  res.json({ ...detail, reviews: reviews.rows });
});

// POST /api/properties
router.post('/', auth, async (req, res) => {
  const { title, description, mode, type_bien, price, surface_m2, rooms, baths, floor, total_floors,
          wilaya, commune, address, lat, lng, image, photos, features } = req.body;

  if (!title || !mode || !type_bien || !price || !wilaya)
    return res.status(400).json({ error: 'Champs obligatoires : titre, mode, type, prix, wilaya.' });
  if (!MODES_VALIDES.includes(mode))
    return res.status(400).json({ error: 'Mode invalide.' });
  if (!TYPES_VALIDES.includes(type_bien))
    return res.status(400).json({ error: 'Type de bien invalide.' });
  // image et photos sont rendues dans des attributs src : uniquement nos envois (voir server/images.js)
  const imageError = images.invalid({ image, photos });
  if (imageError) return res.status(400).json({ error: imageError });

  const finalImage  = image || (Array.isArray(photos) && photos[0]) || '';
  const finalPhotos = Array.isArray(photos) && photos.length ? photos : (finalImage ? [finalImage] : []);

  const aff = await affiliation(req.user, req.body);
  if (aff.error) return res.status(aff.status).json({ error: aff.error });

  // Qualité : doublons et prix aberrants (server/quality.js)
  const assessment = await quality.assess({
    owner_id: req.user.id, title: title.trim(), description: description || '', mode, type_bien, wilaya,
    price: Number(price), surface_m2: surface_m2 ? Number(surface_m2) : null });
  if (assessment.doubleSubmit) return res.status(409).json({ error: 'Vous avez déjà publié cette annonce.' });

  // Modération : publication directe pour les admins / agences vérifiées, sinon en attente de validation.
  // Un signal de qualité bloquant (prix très éloigné du marché, texte copié) envoie l'annonce en validation, même pour une agence
  // vérifiée ; seuls les administrateurs (et le mode MODERATION=off) publient sans contrôle.
  const trusted = await moderation.isTrusted(req.user);
  const direct  = trusted && (req.user.is_admin || !moderation.enabled() || !assessment.blocking);

  const property = await db.properties.insert({
    owner_id:     req.user.id,
    agency_id:    aff.values.agency_id ?? null,
    project_id:   aff.values.project_id ?? null,
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
    status:       direct ? 'active' : 'pending',
    published_at: direct ? new Date() : null,
  });
  await quality.save(property.id, assessment);

  // Enregistrer le prix initial dans l'historique
  await db.pool.query(
    'INSERT INTO price_history (property_id, price) VALUES ($1, $2)',
    [property.id, Number(price)]
  );

  await db.users.update({ id: req.user.id }, { is_agent: true });

  if (!direct) {
    const owner = await db.users.findById(req.user.id);
    moderation.notifyAdminsPending(property, owner ? owner.name : 'Un utilisateur').catch(() => {});
  }
  // warnings : à afficher à l'annonceur ; held : compte de confiance dont l'annonce est tout de même vérifiée (signal de qualité)
  res.status(201).json({ id: property.id, status: property.status, warnings: quality.warningsFor(assessment), held: trusted && !direct });
});

// PUT /api/properties/:id
router.put('/:id', auth, async (req, res) => {
  const property = await db.properties.findById(req.params.id);
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id !== req.user.id && !req.user.is_admin)
    return res.status(403).json({ error: 'Accès refusé.' });

  const { title, description, price, surface_m2, rooms, baths, status, features, image, photos } = req.body;
  const imageError = images.invalid({ image, photos });
  if (imageError) return res.status(400).json({ error: imageError });
  const changes = {};
  if (title       !== undefined) changes.title       = title.trim();
  if (description !== undefined) changes.description = description;
  if (price       !== undefined) changes.price       = Number(price);
  if (surface_m2  !== undefined) changes.surface_m2  = Number(surface_m2);
  if (rooms       !== undefined) changes.rooms       = Number(rooms);
  if (baths       !== undefined) changes.baths       = Number(baths);
  if (image       !== undefined) changes.image       = image || '';
  if (status      !== undefined && STATUTS_VALIDES.includes(status)) {
    // Un propriétaire ne peut pas court-circuiter la modération : une annonce en attente, refusée,
    // ou archivée après un refus (motif conservé) ne repasse pas « active » sans validation.
    const needsAdmin = moderation.HIDDEN_STATUSES.includes(property.status)
      || (property.status === 'archived' && (property.moderation_reason || !property.published_at));
    if (!req.user.is_admin && moderation.enabled() && needsAdmin && status !== 'archived')
      return res.status(400).json({ error: 'Cette annonce doit d\'abord être validée par la modération.' });
    changes.status = status;
  }
  if (Array.isArray(features))   changes.features    = JSON.stringify(features);
  if (Array.isArray(photos))     changes.photos      = JSON.stringify(photos);

  const aff = await affiliation(req.user, req.body, property);
  if (aff.error) return res.status(aff.status).json({ error: aff.error });
  Object.assign(changes, aff.values);

  // Qualité : un changement de prix, de surface, de titre ou de texte recalcule les signaux (doublon, prix aberrant)
  let assessed = null;
  if (property.status !== 'archived' && ['title', 'description', 'price', 'surface_m2'].some(k => changes[k] !== undefined)) {
    assessed = await quality.assess({
      owner_id: property.owner_id, title: changes.title ?? property.title, description: changes.description ?? property.description,
      mode: property.mode, type_bien: property.type_bien, wilaya: property.wilaya,
      price: changes.price ?? property.price, surface_m2: changes.surface_m2 ?? property.surface_m2 }, { excludeId: property.id });
  }

  // Modération : une annonce refusée qu'on corrige est renvoyée en validation ; une annonce active dont
  // le contenu (titre, description, photos) change repasse en attente. Admins et agences vérifiées exemptés.
  let resubmitted = false;
  if (changes.status !== 'archived' && !(await moderation.isTrusted(req.user))) {
    const edited = Object.keys(changes).some(k => k !== 'status');
    if ((property.status === 'rejected' && edited)
        || (property.status === 'active' && moderation.contentChanged(property, changes))) {
      changes.status = 'pending';
      resubmitted = true;
    }
  }

  // Publier d'abord un prix normal puis le modifier n'échappe pas au contrôle : un signal bloquant remet l'annonce en validation
  if (assessed && assessed.blocking && !req.user.is_admin && moderation.enabled() && (changes.status || property.status) === 'active') {
    changes.status = 'pending';
    resubmitted = true;
  }
  // Une modification par son propriétaire vaut confirmation de disponibilité ; remettre l'annonce en ligne annule son expiration
  if (property.owner_id === req.user.id) { changes.last_confirmed_at = new Date(); changes.expiry_notified_at = null; }
  if (changes.status === 'active') changes.expired_at = null;

  await db.properties.update({ id: property.id }, changes);
  if (assessed) await quality.save(property.id, assessed);
  if (resubmitted) {
    const owner = await db.users.findById(property.owner_id);
    moderation.notifyAdminsPending({ ...property, ...changes }, owner ? owner.name : 'Un utilisateur').catch(() => {});
  }

  // Enregistrer le nouveau prix si modifié
  if (changes.price !== undefined && Number(changes.price) !== Number(property.price)) {
    await db.pool.query(
      'INSERT INTO price_history (property_id, price) VALUES ($1, $2)',
      [property.id, changes.price]
    );
  }

  res.json({ ok: true, status: changes.status || property.status, warnings: assessed ? quality.warningsFor(assessed) : [] });
});

// POST /api/properties/:id/renew — « toujours disponible » (annonce active) ou renouvellement (annonce retirée faute de confirmation)
router.post('/:id/renew', auth, async (req, res) => {
  const property = await db.properties.findById(req.params.id);
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const r = await expiry.renew(property.id);
  if (!r) return res.status(409).json({ error: 'Cette annonce ne peut pas être renouvelée.' });
  res.json({ ok: true, status: r.status, last_confirmed_at: r.last_confirmed_at });
});

// POST /api/properties/:id/confirm — lien de l'email de rappel, sans connexion : { token, action: 'available' | 'closed' }
// Le jeton dépend de la dernière confirmation : il ne sert qu'une fois. Réponse identique pour un jeton faux et une annonce inconnue.
router.post('/:id/confirm', async (req, res) => {
  const { token, action } = req.body || {};
  if (!['available', 'closed'].includes(action)) return res.status(400).json({ error: 'Action invalide.' });
  const property = await db.properties.findById(req.params.id);
  if (!property || !expiry.validToken(property.id, property.last_confirmed_at, token))
    return res.status(400).json({ error: 'Ce lien de confirmation est invalide ou a expiré.' });
  const r = action === 'available' ? await expiry.renew(property.id) : await expiry.close(property.id, property.mode);
  if (!r) return res.status(409).json({ error: 'Cette annonce ne peut pas être renouvelée.' });
  res.json({ ok: true, status: r.status });
});

// POST /api/properties/:id/click — { channel: 'call' | 'whatsapp' } : clic sur « Appeler » / « WhatsApp » (compteur anonyme)
// Réponse toujours 204 : rien n'indique si le clic a été compté (annonce inconnue, propre annonce, déjà compté récemment).
router.post('/:id/click', optionalAuth, async (req, res) => {
  const channel = req.body && req.body.channel;
  if (!clicks.CHANNELS.includes(channel)) return res.status(400).json({ error: 'Action invalide.' });
  const p = await db.properties.findById(req.params.id);
  if (p && p.status === 'active' && !(req.user && req.user.id === p.owner_id) && clicks.firstRecently(req.ip, p.id, channel))
    await clicks.record(p.id, channel);
  res.status(204).end();
});

// GET /api/properties/:id/price-history
router.get('/:id/price-history', optionalAuth, async (req, res) => {
  const { pool } = db;
  // Pas d'historique pour une annonce non publiée (sauf propriétaire / admin)
  const prop = await pool.query('SELECT owner_id, status FROM properties WHERE id = $1', [Number(req.params.id)]);
  const row  = prop.rows[0];
  if (row && moderation.HIDDEN_STATUSES.includes(row.status)
      && !(req.user && (req.user.is_admin || req.user.id === row.owner_id)))
    return res.status(404).json({ error: 'Annonce introuvable.' });
  const r = await pool.query(
    'SELECT price, changed_at FROM price_history WHERE property_id = $1 ORDER BY changed_at ASC',
    [Number(req.params.id)]
  );
  res.json(r.rows);
});

// DELETE /api/properties/:id
router.delete('/:id', auth, async (req, res) => {
  const property = await db.properties.findById(req.params.id);
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id !== req.user.id && !req.user.is_admin)
    return res.status(403).json({ error: 'Accès refusé.' });
  await db.properties.delete({ id: property.id });
  res.json({ ok: true });
});

// POST /api/properties/:id/photos
router.post('/:id/photos', auth, async (req, res) => {
  const property = await db.properties.findById(req.params.id);
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requise.' });
  const photos = [...(property.photos || [property.image].filter(Boolean)), url];
  const imageError = images.invalid({ photos });   // url : une chaîne d'envoi valide ; total de photos plafonné
  if (imageError) return res.status(400).json({ error: imageError });
  const patch = { photos: JSON.stringify(photos) };
  // Nouvelle photo sur une annonce publiée : retour en modération (sauf admin / agence vérifiée)
  const review = property.status === 'active' && !(await moderation.isTrusted(req.user));
  if (review) patch.status = 'pending';
  await db.properties.update({ id: property.id }, patch);
  if (review) {
    const owner = await db.users.findById(property.owner_id);
    moderation.notifyAdminsPending(property, owner ? owner.name : 'Un utilisateur').catch(() => {});
  }
  res.json({ photos, status: patch.status || property.status });
});

// DELETE /api/properties/:id/photos
router.delete('/:id/photos', auth, async (req, res) => {
  const property = await db.properties.findById(req.params.id);
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const { url } = req.body;
  const photos = (property.photos || []).filter(p => p !== url);
  await db.properties.update({ id: property.id }, { photos: JSON.stringify(photos) });
  res.json({ photos });
});

// POST /api/properties/:id/reviews
router.post('/:id/reviews', auth, async (req, res) => {
  const { rating, comment, contact_request_id } = req.body;
  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Note entre 1 et 5 requise.' });
  const pid = db.toId(req.params.id) ?? 0;

  // Vérifier qu'une demande de contact confirmée ou terminée existe
  const validContact = await db.contact_requests.findOne(
    { property_id: pid, user_id: req.user.id, status: ['confirmed', 'done'] });
  if (!validContact)
    return res.status(403).json({ error: 'Vous devez avoir une demande de contact confirmée pour laisser un avis.' });

  const existing = await db.reviews.findOne({ property_id: pid, author_id: req.user.id });
  if (existing) return res.status(409).json({ error: 'Vous avez déjà laissé un avis pour ce bien.' });

  await db.reviews.insert({
    property_id: pid, author_id: req.user.id,
    contact_request_id: contact_request_id || null,
    rating: Number(rating), comment: comment || '',
  });
  const { rows: [agg] } = await db.pool.query(
    'SELECT AVG(rating)::float AS avg, COUNT(*)::int AS n FROM reviews WHERE property_id = $1', [pid]);
  await db.properties.update({ id: pid }, { rating: Math.round(agg.avg * 100) / 100, reviews: agg.n });
  res.status(201).json({ ok: true });
});

// POST /api/properties/:id/signaler
router.post('/:id/signaler', auth, async (req, res) => {
  const { motif, message } = req.body;
  if (!motif) return res.status(400).json({ error: 'Motif requis.' });
  await db.pool.query(
    'INSERT INTO signalements (property_id, user_id, motif, message) VALUES ($1,$2,$3,$4)',
    [req.params.id, req.user?.id || null, motif, message || null]
  );
  res.json({ ok: true });
});

// GET /api/properties/user/:id — annonces d'un utilisateur avec compteur de contacts
router.get('/user/:id', optionalAuth, async (req, res) => {
  const { pool } = db;
  const uid = Number(req.params.id);
  // Le propriétaire (et les admins) voient aussi ses annonces en attente / refusées ; le public, seulement les publiées
  const self = req.user && (req.user.is_admin || req.user.id === uid);
  // L'annonceur voit aussi les annonces retirées automatiquement (pour les renouveler), pas celles qu'il a archivées lui-même
  const visible = self ? "(p.status != 'archived' OR p.expired_at IS NOT NULL)" : "p.status IN ('active','sold','rented')";
  const params = [uid];
  let ownerOnly = '';   // colonnes réservées à l'annonceur : clics, échéance du rappel, signaux de qualité
  if (self) {
    params.push(expiry.graceDays());
    ownerOnly = `,
       (SELECT COALESCE(SUM(k.n), 0)::int FROM contact_clicks k WHERE k.property_id = p.id AND k.channel = 'call')     AS call_clicks,
       (SELECT COALESCE(SUM(k.n), 0)::int FROM contact_clicks k WHERE k.property_id = p.id AND k.channel = 'whatsapp') AS whatsapp_clicks,
       CASE WHEN p.status = 'active' AND p.expiry_notified_at IS NOT NULL
            THEN p.expiry_notified_at + make_interval(days => $2) END                                                 AS expires_at,
       (SELECT flags FROM listing_quality WHERE property_id = p.id)                                                   AS quality_flags`;
  }
  const r = await pool.query(
    `SELECT p.*,
       u.name  AS owner_name,  u.phone  AS owner_phone,  u.avatar AS owner_avatar,
       a.name  AS agency_name, a.logo   AS agency_logo,  a.phone  AS agency_phone,
       COUNT(c.id)::int AS contact_count${ownerOnly}
     FROM properties p
     LEFT JOIN users    u ON u.id = p.owner_id
     LEFT JOIN agencies a ON a.id = p.agency_id
     LEFT JOIN contact_requests c ON c.property_id = p.id
     WHERE p.owner_id = $1 AND ${visible}
     GROUP BY p.id, u.id, a.id
     ORDER BY p.created_at DESC`,
    params
  );
  res.json(r.rows);
});

module.exports = router;
