const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const ws     = require('../ws');

// GET /api/messages — conversations de l'utilisateur (une par annonce et interlocuteur, la plus récente d'abord)
router.get('/', auth, async (req, res) => {
  const r = await db.pool.query(
    `WITH mine AS (
       SELECT m.*, CASE WHEN m.from_id = $1 THEN m.to_id ELSE m.from_id END AS other_id
         FROM messages m
        WHERE m.from_id = $1 OR m.to_id = $1
     ), last AS (
       SELECT DISTINCT ON (property_id, other_id) *
         FROM mine
        ORDER BY property_id, other_id, created_at DESC, id DESC
     ), unread AS (
       SELECT property_id, from_id AS other_id, COUNT(*)::int AS n
         FROM messages
        WHERE to_id = $1 AND NOT read
        GROUP BY property_id, from_id
     )
     SELECT l.property_id, l.other_id, l.body AS last_msg, l.created_at AS last_at,
            COALESCE(p.title, '')   AS property_title,
            COALESCE(p.image, '')   AS property_img,
            COALESCE(u.name, 'Inconnu') AS other_name,
            COALESCE(un.n, 0)       AS unread
       FROM last l
       LEFT JOIN properties p ON p.id = l.property_id
       LEFT JOIN users u      ON u.id = l.other_id
       LEFT JOIN unread un    ON un.property_id IS NOT DISTINCT FROM l.property_id AND un.other_id = l.other_id
      ORDER BY l.created_at DESC, l.id DESC`, [req.user.id]);
  res.json(r.rows.map(c => ({ key: `${c.property_id}-${c.other_id}`, ...c })));
});

// GET /api/messages/:property_id/:other_id
router.get('/:property_id/:other_id', auth, async (req, res) => {
  const uid     = req.user.id;
  const pid     = db.toId(req.params.property_id) ?? 0;
  const otherId = db.toId(req.params.other_id) ?? 0;

  const [threadRes, other, property] = await Promise.all([
    db.pool.query(
      `SELECT * FROM messages
        WHERE property_id = $1
          AND ((from_id = $2 AND to_id = $3) OR (from_id = $3 AND to_id = $2))
        ORDER BY created_at, id`, [pid, uid, otherId]),
    db.users.findById(otherId),
    db.properties.findById(pid),
  ]);

  await db.messages.update({ to_id: uid, from_id: otherId, property_id: pid, read: false }, { read: true });

  res.json({ thread: threadRes.rows, other: { id: otherId, name: other?.name }, property: { id: pid, title: property?.title, image: property?.image } });
});

// Statuts d'annonce pour lesquels un visiteur peut engager la conversation avec l'annonceur
const CONTACTABLE = ['active', 'sold', 'rented'];

// Le destinataire d'un premier message est forcément l'annonceur ; ensuite chacun répond dans le fil existant.
// L'annonceur peut aussi écrire à quelqu'un qui lui a envoyé une demande de contact sur cette annonce.
// Sans cette règle, n'importe quel compte pouvait écrire (et faire envoyer un email) à n'importe quel identifiant.
async function canWrite(senderId, recipientId, property) {
  if (recipientId === property.owner_id) {
    if (CONTACTABLE.includes(property.status)) return true;
  }
  const r = await db.pool.query(
    `SELECT 1 FROM messages
      WHERE property_id = $1 AND ((from_id = $2 AND to_id = $3) OR (from_id = $3 AND to_id = $2))
      UNION ALL
     SELECT 1 FROM contact_requests
      WHERE property_id = $1 AND user_id = $3 AND $2 = $4
      LIMIT 1`, [property.id, senderId, recipientId, property.owner_id]);
  return r.rowCount > 0;
}

// POST /api/messages
router.post('/', auth, async (req, res) => {
  const { to_id, property_id, body } = req.body;
  if (!to_id || !property_id || !body?.trim())
    return res.status(400).json({ error: 'Destinataire, annonce et message requis.' });
  if (body.length > 2000)
    return res.status(400).json({ error: 'Le message ne peut pas dépasser 2000 caractères.' });
  const recipientId = db.toId(to_id);
  if (recipientId === req.user.id)
    return res.status(400).json({ error: 'Vous ne pouvez pas vous envoyer un message.' });

  const [property, recipient, sender] = await Promise.all([
    db.properties.findById(property_id), recipientId ? db.users.findById(recipientId) : null, db.users.findById(req.user.id),
  ]);
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (!recipient || recipient.banned) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  if (!(await canWrite(req.user.id, recipientId, property)))
    return res.status(403).json({ error: 'Vous ne pouvez écrire qu\'à l\'annonceur, ou répondre à une personne qui vous a écrit.' });

  const msg = await db.messages.insert({
    from_id: req.user.id, to_id: recipientId,
    property_id: property.id, body: body.trim(), read: false,
  });

  if (recipient.email) {
    require('../mailer').mailNewMessage({
      to: recipient.email, lang: recipient.lang, senderName: sender.name,
      propertyTitle: property.title, preview: body.trim(),
    });
  }
  ws.send(recipientId, {
    type: 'message',
    msg: { ...msg, sender_name: sender.name, property_title: property.title },
  });
  res.status(201).json(msg);
});

// GET /api/messages/unread-count
router.get('/unread-count', auth, async (req, res) => {
  const count = await db.messages.count({ to_id: req.user.id, read: false });
  res.json({ count });
});

module.exports = router;
