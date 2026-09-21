// ── Newsletter : inscription à double confirmation, envois par lots, désinscription ──────────────────────────────────
// Une adresse n'est destinataire qu'après avoir cliqué le lien reçu par email (confirmed_at). Chaque envoi porte un lien de
// désinscription et les en-têtes List-Unsubscribe (RFC 8058). Rien n'est gardé en mémoire : les inscriptions, la file d'envoi et
// les réservations vivent dans PostgreSQL, donc tous les workers pm2 voient le même état (comme server/expiry.js).
//
// Jetons : HMAC du secret du serveur, de l'usage et de l'identifiant de l'inscrit. Ils ne sont JAMAIS renvoyés par l'API : ils
// n'existent que dans les emails. (Avant, la route d'inscription renvoyait le jeton de désinscription à quiconque tapait l'adresse.)
const crypto = require('crypto');
const db     = require('./db');
const mailer = require('./mailer');

const CONFIRM_RESEND_MINUTES = 10;   // deux emails de confirmation pour une même adresse : 10 minutes d'écart au moins
const UNCONFIRMED_DAYS       = 7;    // une inscription jamais confirmée est effacée au bout de 7 jours
const BATCH                  = 100;  // destinataires traités à chaque passage de la tâche planifiée (chaque minute)
const MAX_ATTEMPTS           = 5;    // tentatives d'envoi par destinataire, espacées de RETRY_MINUTES
const RETRY_MINUTES          = 10;
const SUBJECT_MAX            = 150;
const BODY_MAX               = 10000;

// ── Jetons ───────────────────────────────────────────────────────────────────
function token(purpose, id) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`newsletter:${purpose}:${Number(id)}`).digest('hex').slice(0, 40);
}
function validToken(purpose, id, given) {
  if (typeof given !== 'string' || !Number.isInteger(Number(id))) return false;
  const a = Buffer.from(token(purpose, id)), b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Pages du site (confirmation / désinscription en un clic) et adresse appelée en POST par les messageries (List-Unsubscribe)
const confirmUrl     = id => `${mailer.siteUrl()}/newsletter/confirmation?e=${Number(id)}&t=${token('confirm', id)}`;
const unsubscribeUrl = id => `${mailer.siteUrl()}/newsletter/desinscription?e=${Number(id)}&t=${token('unsub', id)}`;
const oneClickUrl    = id => `${mailer.siteUrl()}/api/newsletter/unsubscribe?e=${Number(id)}&t=${token('unsub', id)}`;

// ── Inscription ──────────────────────────────────────────────────────────────
// Réponse identique que l'adresse soit nouvelle, en attente ou déjà confirmée : personne ne peut sonder la liste.
// L'email de confirmation part au plus une fois toutes les CONFIRM_RESEND_MINUTES pour une même adresse (réservation atomique en SQL,
// valable pour tous les workers) : on ne peut pas s'en servir pour inonder la boîte d'un tiers.
async function subscribe(email, lang) {
  lang = lang === 'ar' ? 'ar' : 'fr';
  const row = (await db.pool.query(
    `INSERT INTO newsletter_subscribers AS s (email, lang) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET lang = CASE WHEN s.confirmed_at IS NULL THEN EXCLUDED.lang ELSE s.lang END
     RETURNING s.id, s.confirmed_at`, [email, lang])).rows[0];
  if (row.confirmed_at) return false;                                  // déjà abonné : rien à envoyer
  const claim = await db.pool.query(
    `UPDATE newsletter_subscribers SET confirm_sent_at = NOW()
      WHERE id = $1 AND confirmed_at IS NULL
        AND (confirm_sent_at IS NULL OR confirm_sent_at < NOW() - make_interval(mins => $2))
      RETURNING lang`, [row.id, CONFIRM_RESEND_MINUTES]);
  if (!claim.rowCount) return false;                                   // un email vient déjà de partir
  // L'envoi n'est pas attendu (temps de réponse identique dans tous les cas). S'il échoue, la réservation est rendue :
  // le visiteur pourra réessayer tout de suite.
  mailer.mailNewsletterConfirm({ to: email, lang: claim.rows[0].lang, confirmUrl: confirmUrl(row.id) })
    .then(ok => ok || db.pool.query('UPDATE newsletter_subscribers SET confirm_sent_at = NULL WHERE id = $1', [row.id]))
    .catch(() => {});
  return true;
}

// Lien de confirmation : true si l'inscription est (ou était déjà) confirmée, false si le lien est faux ou l'inscription effacée
async function confirm(id, given) {
  if (!validToken('confirm', id, given)) return false;
  const r = await db.pool.query(
    'UPDATE newsletter_subscribers SET confirmed_at = COALESCE(confirmed_at, NOW()) WHERE id = $1 RETURNING id', [Number(id)]);
  return r.rowCount > 0;
}

// Désinscription : la ligne est supprimée (plus aucune donnée personnelle). Idempotent : le jeton ne dépend que de l'identifiant,
// donc un second clic sur le même lien réussit aussi. Les envois encore en attente pour cet inscrit disparaissent avec lui.
async function unsubscribe(id, given) {
  if (!validToken('unsub', id, given)) return false;
  await db.pool.query('DELETE FROM newsletter_deliveries WHERE subscriber_id = $1 AND sent_at IS NULL', [Number(id)]);
  await db.pool.query('DELETE FROM newsletter_subscribers WHERE id = $1', [Number(id)]);
  return true;
}

// Inscriptions jamais confirmées (dont les anciens inscrits, qui n'avaient donné aucun consentement) : effacées après 7 jours
async function purgeUnconfirmed() {
  const r = await db.pool.query(
    `DELETE FROM newsletter_subscribers
      WHERE confirmed_at IS NULL AND COALESCE(confirm_sent_at, created_at) < NOW() - make_interval(days => $1)`, [UNCONFIRMED_DAYS]);
  return r.rowCount;
}

// ── Campagnes (administration) ───────────────────────────────────────────────
// Texte saisi : chaîne seulement, sans caractères de contrôle (hors retours à la ligne du texte)
const clean = (v, multiline) => typeof v !== 'string' ? ''
  : v.replace(multiline ? /[^\P{Cc}\n\r\t]/gu : /\p{Cc}/gu, ' ').trim();

// Une langue est « remplie » quand elle a son sujet ET son texte ; il en faut au moins une, et une langue commencée doit être complète.
// Un abonné reçoit sa langue, ou l'autre à défaut.
function parseCampaign(body = {}) {
  const c = {};
  for (const l of ['fr', 'ar']) { c['subject_' + l] = clean(body['subject_' + l]); c['body_' + l] = clean(body['body_' + l], true); }
  const filled = l => c['subject_' + l] && c['body_' + l];
  const started = l => c['subject_' + l] || c['body_' + l];
  if (!(filled('fr') || filled('ar')) || ['fr', 'ar'].some(l => started(l) && !filled(l)))
    return { error: 'Renseignez le sujet et le texte, au moins dans une langue (une langue commencée doit être complète).' };
  if (c.subject_fr.length > SUBJECT_MAX || c.subject_ar.length > SUBJECT_MAX) return { error: 'Sujet trop long (150 caractères maximum).' };
  if (c.body_fr.length > BODY_MAX || c.body_ar.length > BODY_MAX) return { error: 'Texte trop long (10 000 caractères maximum).' };
  return { campaign: c };
}

// Version envoyée à un abonné : sa langue si elle est remplie, sinon l'autre
function versionFor(c, lang) {
  const l = c['subject_' + lang] && c['body_' + lang] ? lang : (lang === 'ar' ? 'fr' : 'ar');
  return { lang: l, subject: c['subject_' + l], body: c['body_' + l] };
}

// Crée la campagne et met en file un envoi par abonné confirmé, en une seule requête (atomique)
async function createCampaign(c, adminId) {
  const r = await db.pool.query(
    `WITH c AS (
       INSERT INTO newsletter_campaigns (subject_fr, body_fr, subject_ar, body_ar, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id),
     q AS (
       INSERT INTO newsletter_deliveries (campaign_id, subscriber_id)
       SELECT c.id, s.id FROM c CROSS JOIN newsletter_subscribers s WHERE s.confirmed_at IS NOT NULL RETURNING 1)
     SELECT c.id, (SELECT COUNT(*)::int FROM q) AS recipients FROM c`,
    [c.subject_fr, c.body_fr, c.subject_ar, c.body_ar, adminId]);
  return r.rows[0];
}

async function cancelCampaign(id) {
  const r = await db.pool.query('UPDATE newsletter_campaigns SET canceled_at = COALESCE(canceled_at, NOW()) WHERE id = $1 RETURNING id', [id]);
  return r.rowCount > 0;
}

// Un aperçu envoyé à l'administrateur lui-même (un envoi ne se rattrape pas) : le lien de désinscription mène à la page d'accueil
function sendTest(c, to, lang) {
  const v = versionFor(c, lang);
  return mailer.mailNewsletter({ to, lang: v.lang, subject: '[TEST] ' + v.subject, body: v.body,
    unsubscribeUrl: mailer.siteUrl(), oneClickUrl: mailer.siteUrl() + '/api/newsletter/unsubscribe' });
}

// Requête SQL de la liste des campagnes : envoyés, échecs définitifs et restants par campagne (une requête, pas une boucle)
const CAMPAIGNS_FROM = `(
  SELECT c.id, c.subject_fr, c.subject_ar, c.created_at, c.canceled_at,
         COUNT(d.id)::int AS total,
         COUNT(d.sent_at)::int AS sent,
         COUNT(*) FILTER (WHERE d.sent_at IS NULL AND d.attempts >= ${MAX_ATTEMPTS})::int AS failed
    FROM newsletter_campaigns c LEFT JOIN newsletter_deliveries d ON d.campaign_id = c.id
   GROUP BY c.id) c`;

// ── Envoi par lots (tâche planifiée, chaque minute) ──────────────────────────
// Réservation atomique (FOR UPDATE SKIP LOCKED) : deux passages, ou deux instances, ne prennent jamais le même destinataire.
// Une réservation qui n'aboutit pas (SMTP en panne, processus arrêté) redevient disponible après RETRY_MINUTES, MAX_ATTEMPTS fois.
// Un destinataire qui s'est désinscrit entre-temps, ou une campagne annulée, sont écartés par la requête elle-même.
// (Un arrêt brutal entre l'envoi et son enregistrement peut, très rarement, envoyer le même message une seconde fois.)
async function sendDue(limit = BATCH) {
  if (!mailer.configured()) return { sent: 0, failed: 0 };
  const due = (await db.pool.query(
    `WITH pick AS (
       SELECT d.id FROM newsletter_deliveries d
         JOIN newsletter_campaigns c   ON c.id = d.campaign_id
         JOIN newsletter_subscribers s ON s.id = d.subscriber_id
        WHERE d.sent_at IS NULL AND d.attempts < $2 AND c.canceled_at IS NULL AND s.confirmed_at IS NOT NULL
          AND (d.tried_at IS NULL OR d.tried_at < NOW() - make_interval(mins => $3))
        ORDER BY d.id LIMIT $1 FOR UPDATE OF d SKIP LOCKED),
     upd AS (
       UPDATE newsletter_deliveries d SET attempts = d.attempts + 1, tried_at = NOW()
         FROM pick WHERE d.id = pick.id RETURNING d.id, d.campaign_id, d.subscriber_id)
     SELECT upd.id, s.id AS subscriber_id, s.email, s.lang, c.subject_fr, c.body_fr, c.subject_ar, c.body_ar
       FROM upd JOIN newsletter_subscribers s ON s.id = upd.subscriber_id JOIN newsletter_campaigns c ON c.id = upd.campaign_id
      ORDER BY upd.id`, [limit, MAX_ATTEMPTS, RETRY_MINUTES])).rows;
  let sent = 0, failed = 0;
  for (const d of due) {
    const v = versionFor(d, d.lang);
    const ok = await mailer.mailNewsletter({ to: d.email, lang: v.lang, subject: v.subject, body: v.body,
      unsubscribeUrl: unsubscribeUrl(d.subscriber_id), oneClickUrl: oneClickUrl(d.subscriber_id) });
    if (ok) { await db.pool.query('UPDATE newsletter_deliveries SET sent_at = NOW() WHERE id = $1', [d.id]); sent++; }
    else failed++;
  }
  return { sent, failed };
}

module.exports = {
  CONFIRM_RESEND_MINUTES, UNCONFIRMED_DAYS, BATCH, MAX_ATTEMPTS, RETRY_MINUTES, SUBJECT_MAX, BODY_MAX, CAMPAIGNS_FROM,
  token, validToken, confirmUrl, unsubscribeUrl, oneClickUrl,
  subscribe, confirm, unsubscribe, purgeUnconfirmed,
  parseCampaign, versionFor, createCampaign, cancelCampaign, sendTest, sendDue,
};
