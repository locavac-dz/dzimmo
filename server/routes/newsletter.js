// ── Newsletter publique : inscription, confirmation, désinscription ──────────────────────────────────────────────────
// Voir server/newsletter.js. Aucune de ces routes ne renvoie un jeton ni ne révèle si une adresse est déjà inscrite.
const router     = require('express').Router();
const db         = require('../db');
const mailer     = require('../mailer');
const newsletter = require('../newsletter');

const { EMAIL_OK } = mailer;

// Identifiant et jeton d'un lien : dans le corps JSON (pages du site) ou dans l'adresse (appel « un clic » des messageries, RFC 8058)
const idOf    = req => { const v = req.body?.e ?? req.query.e; return (typeof v === 'string' && /^\d{1,10}$/.test(v)) || Number.isInteger(v) ? db.toId(v) : null; };
const tokenOf = req => { const v = req.body?.t ?? req.query.t; return typeof v === 'string' ? v : ''; };

// POST /api/newsletter/subscribe { email, lang }
router.post('/subscribe', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL_OK.test(email)) return res.status(400).json({ error: 'Adresse email invalide.' });
  // Sans SMTP, aucun email de confirmation ne partirait : on ne fait pas croire au visiteur qu'il est inscrit
  if (!mailer.configured()) return res.status(503).json({ error: 'Inscription momentanément indisponible. Réessayez plus tard.' });
  await newsletter.subscribe(email, req.body.lang === 'ar' || req.get('X-Lang') === 'ar' ? 'ar' : 'fr');
  res.json({ ok: true });
});

// POST /api/newsletter/confirm { e, t } : lien de l'email de confirmation
router.post('/confirm', async (req, res) => {
  const id = idOf(req);
  if (id === null || !(await newsletter.confirm(id, tokenOf(req))))
    return res.status(400).json({ error: 'Lien invalide ou expiré.' });
  res.json({ ok: true });
});

// POST /api/newsletter/unsubscribe { e, t } : lien de désinscription des envois, ou bouton « Se désabonner » de la messagerie
router.post('/unsubscribe', async (req, res) => {
  const id = idOf(req);
  if (id === null || !(await newsletter.unsubscribe(id, tokenOf(req))))
    return res.status(400).json({ error: 'Lien invalide ou expiré.' });
  res.json({ ok: true });
});

module.exports = router;
