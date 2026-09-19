const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const mailer = require('../mailer');
const ws     = require('../ws');

const TYPES_VALIDES   = ['visite', 'info', 'offre'];
const STATUTS_VALIDES = ['pending', 'confirmed', 'rejected', 'done'];

// GET /api/contacts/mine — demandes envoyées par l'utilisateur
router.get('/mine', auth, async (req, res) => {
  const requests = await db.contact_requests.find(c => c.user_id === req.user.id);
  const result   = await Promise.all(requests.map(async c => {
    const property = await db.properties.findOne(p => p.id === c.property_id);
    return { ...c, property_title: property?.title || '', property_image: property?.image || '' };
  }));
  result.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json(result);
});

// GET /api/contacts/received — demandes reçues sur les annonces du propriétaire
router.get('/received', auth, async (req, res) => {
  const myProps = await db.properties.find(p => p.owner_id === req.user.id);
  const propIds = new Set(myProps.map(p => p.id));
  const requests = await db.contact_requests.find(c => propIds.has(c.property_id));
  const result   = await Promise.all(requests.map(async c => {
    const property  = await db.properties.findOne(p => p.id === c.property_id);
    const requester = await db.users.findOne(u => u.id === c.user_id);
    return {
      ...c,
      property_title: property?.title || '',
      property_image: property?.image || '',
      requester_name:  requester?.name  || 'Inconnu',
      requester_phone: requester?.phone || null,
    };
  }));
  result.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json(result);
});

// POST /api/contacts — envoyer une demande de contact
router.post('/', auth, async (req, res) => {
  const { property_id, type, message, visit_date, offer_amount } = req.body;
  if (!property_id || !type) return res.status(400).json({ error: 'Annonce et type requis.' });
  if (!TYPES_VALIDES.includes(type)) return res.status(400).json({ error: 'Type invalide.' });

  const property = await db.properties.findOne(p => p.id === Number(property_id));
  if (!property || ['pending', 'rejected'].includes(property.status))
    return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id === req.user.id)
    return res.status(400).json({ error: 'Vous ne pouvez pas contacter votre propre annonce.' });

  if (type === 'visite' && !visit_date)
    return res.status(400).json({ error: 'Date de visite requise.' });
  if (type === 'offre' && !offer_amount)
    return res.status(400).json({ error: 'Montant de l\'offre requis.' });

  const request = await db.contact_requests.insert({
    property_id: Number(property_id), user_id: req.user.id,
    type, message: message || null,
    visit_date:   visit_date    || null,
    offer_amount: offer_amount  ? Number(offer_amount) : null,
    status: 'pending',
  });

  const owner     = await db.users.findOne(u => u.id === property.owner_id);
  const requester = await db.users.findOne(u => u.id === req.user.id);
  if (owner?.email) {
    mailer.mailContactRequest({
      ownerName:    owner.name, ownerEmail: owner.email,
      requesterName: requester.name, propertyTitle: property.title,
      type, message, visitDate: visit_date, offerAmount: offer_amount,
    });
  }

  // Notifier le propriétaire en temps réel via WebSocket
  ws.send(property.owner_id, {
    type:       'notif',
    notif_type: 'new_contact',
    title:      'Nouvelle demande de contact',
    body:       `${requester.name} a envoyé une demande pour "${property.title}"`,
    link_id:    property.id,
    time:       new Date().toISOString(),
  });

  res.status(201).json({ id: request.id });
});

// PUT /api/contacts/:id/status — propriétaire confirme ou rejette
router.put('/:id/status', auth, async (req, res) => {
  const request  = await db.contact_requests.findOne(c => c.id === Number(req.params.id));
  if (!request) return res.status(404).json({ error: 'Demande introuvable.' });

  const property = await db.properties.findOne(p => p.id === request.property_id);
  if (!property || property.owner_id !== req.user.id)
    return res.status(403).json({ error: 'Accès refusé.' });

  const { status } = req.body;
  if (!STATUTS_VALIDES.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });

  await db.contact_requests.update(c => c.id === request.id, { status });

  // Notifier le demandeur en temps réel pour les statuts confirmé/refusé
  if (status === 'confirmed' || status === 'rejected') {
    const isConfirmed = status === 'confirmed';
    ws.send(request.user_id, {
      type:       'notif',
      notif_type: 'contact_status',
      title:      isConfirmed ? 'Demande confirmée !' : 'Demande refusée',
      body:       `Votre demande pour "${property.title}" a été ${isConfirmed ? 'confirmée' : 'refusée'}.`,
      link_id:    property.id,
      time:       new Date().toISOString(),
    });
  }

  res.json({ ok: true });
});

// DELETE /api/contacts/:id — annulation par le demandeur
router.delete('/:id', auth, async (req, res) => {
  const request = await db.contact_requests.findOne(c => c.id === Number(req.params.id));
  if (!request) return res.status(404).json({ error: 'Demande introuvable.' });
  if (request.user_id !== req.user.id)
    return res.status(403).json({ error: 'Accès refusé.' });
  await db.contact_requests.delete(c => c.id === request.id);
  res.json({ ok: true });
});

module.exports = router;
