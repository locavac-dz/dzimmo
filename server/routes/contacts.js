const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const mailer = require('../mailer');
const ws     = require('../ws');
const { notif } = require('../messages');

const TYPES_VALIDES   = ['visite', 'info', 'offre'];
const STATUTS_VALIDES = ['pending', 'confirmed', 'rejected', 'done'];
const TIME_RE         = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// GET /api/contacts/mine — demandes envoyées par l'utilisateur
router.get('/mine', auth, async (req, res) => {
  const r = await db.pool.query(
    `SELECT c.id, c.property_id, c.user_id, c.type, c.message,
            c.visit_date::text AS visit_date, c.visit_time,
            c.offer_amount, c.status, c.created_at,
            COALESCE(p.title, '') AS property_title, COALESCE(p.image, '') AS property_image
       FROM contact_requests c
       LEFT JOIN properties p ON p.id = c.property_id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC, c.id DESC`, [req.user.id]);
  res.json(r.rows);
});

// GET /api/contacts/received — demandes reçues sur les annonces du propriétaire
router.get('/received', auth, async (req, res) => {
  const r = await db.pool.query(
    `SELECT c.id, c.property_id, c.user_id, c.type, c.message,
            c.visit_date::text AS visit_date, c.visit_time,
            c.offer_amount, c.status, c.created_at,
            COALESCE(p.title, '') AS property_title, COALESCE(p.image, '') AS property_image,
            COALESCE(u.name, 'Inconnu') AS requester_name, u.phone AS requester_phone
       FROM contact_requests c
       JOIN properties p ON p.id = c.property_id AND p.owner_id = $1
       LEFT JOIN users u ON u.id = c.user_id
      ORDER BY c.created_at DESC, c.id DESC`, [req.user.id]);
  res.json(r.rows);
});

// POST /api/contacts — envoyer une demande de contact
router.post('/', auth, async (req, res) => {
  const { property_id, type, message, visit_date, visit_time, offer_amount } = req.body;
  if (!property_id || !type) return res.status(400).json({ error: 'Annonce et type requis.' });
  if (!TYPES_VALIDES.includes(type)) return res.status(400).json({ error: 'Type invalide.' });

  const property = await db.properties.findById(property_id);
  if (!property || ['pending', 'rejected'].includes(property.status))
    return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id === req.user.id)
    return res.status(400).json({ error: 'Vous ne pouvez pas contacter votre propre annonce.' });

  if (type === 'visite' && !visit_date)
    return res.status(400).json({ error: 'Date de visite requise.' });
  if (type === 'offre' && !offer_amount)
    return res.status(400).json({ error: 'Montant de l\'offre requis.' });

  const cleanTime = (type === 'visite' && typeof visit_time === 'string' && TIME_RE.test(visit_time.trim()))
    ? visit_time.trim() : null;
  if (type === 'visite' && visit_time && !cleanTime)
    return res.status(400).json({ error: 'Heure de visite invalide.' });

  const request = await db.contact_requests.insert({
    property_id: Number(property_id), user_id: req.user.id,
    type, message: message || null,
    visit_date:   visit_date  || null,
    visit_time:   cleanTime,
    offer_amount: offer_amount ? Number(offer_amount) : null,
    status: 'pending',
  });

  const [owner, requester] = await Promise.all([db.users.findById(property.owner_id), db.users.findById(req.user.id)]);
  if (owner?.email) {
    mailer.mailContactRequest({
      ownerName:    owner.name, ownerEmail: owner.email, lang: owner.lang,
      requesterName: requester.name, propertyTitle: property.title,
      type, message, visitDate: visit_date, visitTime: cleanTime, offerAmount: offer_amount,
    });
  }

  // Notifier le propriétaire en temps réel via WebSocket
  ws.send(property.owner_id, {
    type:       'notif',
    notif_type: 'new_contact',
    ...notif(owner?.lang, 'contact_new', { name: requester.name, title: property.title }),
    link_id:    property.id,
    time:       new Date().toISOString(),
  });

  res.status(201).json({ id: request.id });
});

// PUT /api/contacts/:id/status — propriétaire confirme ou rejette
router.put('/:id/status', auth, async (req, res) => {
  const request  = await db.contact_requests.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Demande introuvable.' });

  const property = await db.properties.findById(request.property_id);
  if (!property || property.owner_id !== req.user.id)
    return res.status(403).json({ error: 'Accès refusé.' });

  const { status } = req.body;
  if (!STATUTS_VALIDES.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });

  const patch = { status };
  if (request.status === 'pending' && (status === 'confirmed' || status === 'rejected'))
    patch.responded_at = new Date();
  await db.contact_requests.update({ id: request.id }, patch);

  // Notifier le demandeur en temps réel pour les statuts confirmé/refusé
  if (status === 'confirmed' || status === 'rejected') {
    const requester = await db.users.findById(request.user_id);
    ws.send(request.user_id, {
      type:       'notif',
      notif_type: 'contact_status',
      ...notif(requester?.lang, status === 'confirmed' ? 'contact_confirmed' : 'contact_rejected', { title: property.title }),
      link_id:    property.id,
      time:       new Date().toISOString(),
    });
  }

  res.json({ ok: true });
});

// DELETE /api/contacts/:id — annulation par le demandeur
router.delete('/:id', auth, async (req, res) => {
  const request = await db.contact_requests.findById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Demande introuvable.' });
  if (request.user_id !== req.user.id)
    return res.status(403).json({ error: 'Accès refusé.' });
  await db.contact_requests.delete({ id: request.id });
  res.json({ ok: true });
});

module.exports = router;
