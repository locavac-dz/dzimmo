// Mise à la une d'une annonce par son propriétaire (server/featured.js) : formules publiques, commande, confirmation du paiement.
const router   = require('express').Router();
const db       = require('../db');
const auth     = require('../middleware/auth');
const featured = require('../featured');
const payments = require('../payments');

const CLOSED = 'Les mises à la une ne sont pas ouvertes pour le moment.';

// GET /api/promotions/plans — formules et prix (DZD) ; `enabled: false` : le site masque le bouton
router.get('/plans', (req, res) => {
  const on = featured.enabled();
  res.json({ enabled: on, currency: 'DZD', plans: on ? featured.plans() : [], simulated: on && payments.simulated() });
});

// POST /api/promotions { property_id, days } — commande d'une formule pour une annonce publiée de l'annonceur
router.post('/', auth, async (req, res) => {
  if (!featured.enabled()) return res.status(503).json({ error: CLOSED });
  const { property_id, days } = req.body || {};
  const plan = featured.plans().find(p => p.days === Number(days));
  if (!plan) return res.status(400).json({ error: 'Formule invalide.' });
  const property = await db.properties.findById(property_id);
  if (!property) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (property.owner_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  if (property.status !== 'active') return res.status(409).json({ error: 'Seule une annonce publiée peut être mise à la une.' });

  // Une seule commande en attente par annonce : une nouvelle remplace l'ancienne (jamais deux paiements à confirmer pour la même chose)
  await db.pool.query(
    `UPDATE promotions SET status = 'cancelled' WHERE property_id = $1 AND owner_id = $2 AND status = 'pending'`, [property.id, req.user.id]);
  const row = (await db.pool.query(
    `INSERT INTO promotions (property_id, owner_id, days, amount, provider) VALUES ($1, $2, $3, $4, $5) RETURNING id, days, amount, provider`,
    [property.id, req.user.id, plan.days, plan.price, payments.provider()])).rows[0];
  let checkout;
  try { checkout = await payments.checkout(row); }
  catch (e) {
    await db.pool.query(`UPDATE promotions SET status = 'cancelled' WHERE id = $1`, [row.id]);
    console.error('[promotions] paiement indisponible :', e.message);
    return res.status(503).json({ error: "Le paiement en ligne n'est pas disponible." });
  }
  res.status(201).json({ id: row.id, days: row.days, amount: Number(row.amount), currency: 'DZD', ...checkout });
});

// POST /api/promotions/:id/simulate — confirmation du paiement SIMULÉ (développement seulement : 404 dès que le mode simulé est fermé)
router.post('/:id/simulate', auth, async (req, res) => {
  if (!payments.simulated()) return res.status(404).json({ error: 'Route introuvable.' });
  const promo = (await db.pool.query('SELECT id, owner_id, status FROM promotions WHERE id = $1', [db.toId(req.params.id) ?? 0])).rows[0];
  if (!promo) return res.status(404).json({ error: 'Paiement introuvable.' });
  if (promo.owner_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé.' });
  const until = await featured.activate(promo.id);
  if (!until) return res.status(409).json({ error: "Ce paiement n'est plus en attente." });
  res.json({ ok: true, featured_until: until });
});

module.exports = router;
