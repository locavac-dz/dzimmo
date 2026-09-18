const router = require('express').Router();
const db     = require('../db');
const admin  = require('../middleware/admin');

// GET /api/stats — statistiques globales (admin)
router.get('/', admin, async (req, res) => {
  const [users, properties, contacts, agencies] = await Promise.all([
    db.users.count(),
    db.properties.count(),
    db.contact_requests.count(),
    db.agencies.count(),
  ]);

  const active  = await db.properties.count(p => p.status === 'active');
  const sold    = await db.properties.count(p => p.status === 'sold');
  const rented  = await db.properties.count(p => p.status === 'rented');
  const pending = await db.contact_requests.count(c => c.status === 'pending');

  res.json({ users, properties, contacts, agencies, active, sold, rented, pending_contacts: pending });
});

// GET /api/stats/me — statistiques du propriétaire connecté
router.get('/me', require('../middleware/auth'), async (req, res) => {
  const uid = req.user.id;
  const myProps   = await db.properties.find(p => p.owner_id === uid);
  const propIds   = new Set(myProps.map(p => p.id));
  const contacts  = await db.contact_requests.find(c => propIds.has(c.property_id));
  const totalViews = myProps.reduce((s, p) => s + (p.views || 0), 0);

  res.json({
    properties:   myProps.length,
    active:       myProps.filter(p => p.status === 'active').length,
    contacts:     contacts.length,
    pending:      contacts.filter(c => c.status === 'pending').length,
    total_views:  totalViews,
  });
});

module.exports = router;
