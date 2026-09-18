const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const ws     = require('../ws');

// GET /api/messages — conversations de l'utilisateur
router.get('/', auth, async (req, res) => {
  const uid  = req.user.id;
  const msgs = await db.messages.find(m => m.from_id === uid || m.to_id === uid);

  const convMap = {};
  for (const m of msgs) {
    const otherId = m.from_id === uid ? m.to_id : m.from_id;
    const key     = `${m.property_id}-${otherId}`;
    if (!convMap[key] || String(m.created_at) > convMap[key].last_at) {
      const other    = await db.users.findOne(u => u.id === otherId);
      const property = await db.properties.findOne(p => p.id === m.property_id);
      convMap[key] = {
        key, property_id: m.property_id,
        property_title: property?.title || '',
        property_img:   property?.image || '',
        other_id:    otherId,
        other_name:  other?.name || 'Inconnu',
        last_msg:    m.body,
        last_at:     String(m.created_at),
        unread: msgs.filter(x => x.from_id === otherId && x.to_id === uid && !x.read && x.property_id === m.property_id).length,
      };
    }
  }
  res.json(Object.values(convMap).sort((a,b) => b.last_at.localeCompare(a.last_at)));
});

// GET /api/messages/:property_id/:other_id
router.get('/:property_id/:other_id', auth, async (req, res) => {
  const uid     = req.user.id;
  const pid     = Number(req.params.property_id);
  const otherId = Number(req.params.other_id);

  const thread = await db.messages.find(m =>
    m.property_id === pid &&
    ((m.from_id === uid && m.to_id === otherId) || (m.from_id === otherId && m.to_id === uid))
  );
  thread.sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)));

  await db.messages.update(
    m => m.to_id === uid && m.from_id === otherId && m.property_id === pid && !m.read,
    { read: true }
  );

  const other    = await db.users.findOne(u => u.id === otherId);
  const property = await db.properties.findOne(p => p.id === pid);
  res.json({ thread, other: { id: otherId, name: other?.name }, property: { id: pid, title: property?.title, image: property?.image } });
});

// POST /api/messages
router.post('/', auth, async (req, res) => {
  const { to_id, property_id, body } = req.body;
  if (!to_id || !property_id || !body?.trim())
    return res.status(400).json({ error: 'Destinataire, annonce et message requis.' });
  if (body.length > 2000)
    return res.status(400).json({ error: 'Le message ne peut pas dépasser 2000 caractères.' });
  if (Number(to_id) === req.user.id)
    return res.status(400).json({ error: 'Vous ne pouvez pas vous envoyer un message.' });

  const property = await db.properties.findOne(p => p.id === Number(property_id));
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });

  const msg = await db.messages.insert({
    from_id: req.user.id, to_id: Number(to_id),
    property_id: Number(property_id), body: body.trim(), read: false,
  });

  const recipient = await db.users.findOne(u => u.id === Number(to_id));
  const sender    = await db.users.findOne(u => u.id === req.user.id);
  if (recipient?.email) {
    require('../mailer').mailNewMessage({
      to: recipient.email, senderName: sender.name,
      propertyTitle: property.title, preview: body.trim(),
    });
  }
  ws.send(to_id, {
    type: 'message',
    msg: { ...msg, sender_name: sender.name, property_title: property.title },
  });
  res.status(201).json(msg);
});

// GET /api/messages/unread-count
router.get('/unread-count', auth, async (req, res) => {
  const count = await db.messages.count(m => m.to_id === req.user.id && !m.read);
  res.json({ count });
});

module.exports = router;
