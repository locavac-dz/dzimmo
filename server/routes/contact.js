// ── Formulaire de la page Contact (visiteur → équipe du site) ────────────────
// À ne pas confondre avec /api/contacts (demandes de contact sur une annonce).
// Avant : le formulaire postait vers une route inexistante et affichait « Message envoyé » : tous les messages étaient perdus.
// Le message part par email à CONTACT_EMAIL, sinon aux administrateurs ; il n'est ni stocké ni journalisé (loi 18-07).
// Si aucun envoi n'aboutit, on le dit (503) : le visiteur sait qu'il doit écrire autrement.
const router = require('express').Router();
const db     = require('../db');
const mailer = require('../mailer');

const { EMAIL_OK } = mailer;
const MAX_ADMIN = 10;

// Texte saisi : chaîne seulement, sans caractères de contrôle (hors retours à la ligne du message)
const clean = (v, multiline) => typeof v !== 'string' ? ''
  : v.replace(multiline ? /[^\P{Cc}\n\r\t]/gu : /\p{Cc}/gu, ' ').trim();

async function recipients() {
  const to = (process.env.CONTACT_EMAIL || '').trim();
  if (to && EMAIL_OK.test(to)) return [{ email: to, lang: 'fr' }];
  return (await db.pool.query(
    'SELECT email, lang FROM users WHERE is_admin = true AND banned = false ORDER BY id LIMIT $1', [MAX_ADMIN])).rows;
}

// POST /api/contact
router.post('/', async (req, res) => {
  const body    = req.body || {};
  const name    = clean(body.name);
  const email   = clean(body.email).toLowerCase();
  const message = clean(body.message, true);
  const subject = Object.hasOwn(mailer.CONTACT_SUBJECTS.fr, body.subject) ? body.subject : 'autre';

  if (!name || !message) return res.status(400).json({ error: 'Nom et message requis.' });
  if (name.length > 100) return res.status(400).json({ error: 'Nom trop long (100 caractères maximum).' });
  if (email.length > 254 || !EMAIL_OK.test(email)) return res.status(400).json({ error: 'Adresse email invalide.' });
  if (message.length < 10)   return res.status(400).json({ error: 'Message trop court (10 caractères minimum).' });
  if (message.length > 5000) return res.status(400).json({ error: 'Message trop long (5000 caractères maximum).' });

  const sent = await Promise.all((await recipients()).map(r =>
    mailer.mailSiteContact({ to: r.email, lang: r.lang, name, email, subject, message })));
  if (!sent.some(Boolean))
    return res.status(503).json({ error: "Votre message n'a pas pu être envoyé. Réessayez plus tard." });
  res.json({ ok: true });
});

module.exports = router;
