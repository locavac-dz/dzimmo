// ── Signalements d'annonces ──────────────────────────────────────────────────
// Un membre connecté signale une annonce (arnaque, déjà vendue, faux prix…). Les administrateurs voient la file
// (Administration → Signalements). Quand assez de membres DIFFÉRENTS ont signalé la même annonce, elle repasse seule en
// modération (statut « pending » : invisible du public, un administrateur l'approuve ou la refuse). Rien n'est gardé en mémoire :
// tout le calcul se fait en SQL, donc identique quel que soit le worker pm2.
const db     = require('./db');
const ws     = require('./ws');
const mailer = require('./mailer');
const { notif } = require('./messages');

// Motifs proposés par le site (le serveur accepte aussi un texte libre, borné à 200 caractères)
const MOTIFS = ['arnaque', 'indisponible', 'faux', 'photos', 'doublon', 'interdit', 'autre'];

// Nombre de membres différents qui déclenchent le retrait automatique. REPORT_AUTO_HIDE=0 le désactive.
const hideAfter = () => (/^\d{1,3}$/.test(String(process.env.REPORT_AUTO_HIDE ?? '').trim())
  ? Number(process.env.REPORT_AUTO_HIDE) : 3);

const DAILY_MAX = 10;            // signalements par membre et par 24 h
const MIN_ACCOUNT_HOURS = 24;    // un compte trop récent ou sans email confirmé ne compte pas dans le seuil (pas de compte jetable)
const HIDE_REASON = 'Annonce signalée par plusieurs membres';   // traduit par messages.REASONS_AR

const siteUrl = () => mailer.siteUrl();

async function admins() {
  return (await db.pool.query('SELECT id, email, lang FROM users WHERE is_admin = true AND banned = false')).rows;
}

// Prévient les administrateurs (temps réel) qu'une annonce vient d'être signalée
async function notifyAdminsNew(prop) {
  for (const a of await admins()) {
    ws.send(a.id, { type: 'notif', notif_type: 'report_new', ...notif(a.lang, 'report_new', { title: prop.title }),
      link_id: prop.id, time: new Date().toISOString() });
  }
}

// Annonce retirée automatiquement : administrateurs (temps réel + email) et propriétaire (temps réel + email)
async function notifyHidden(row) {
  for (const a of await admins()) {
    ws.send(a.id, { type: 'notif', notif_type: 'report_hidden', ...notif(a.lang, 'report_hidden', { title: row.title }),
      link_id: row.id, time: new Date().toISOString() });
    mailer.mailAdminReported({ to: a.email, lang: a.lang, propertyTitle: row.title, count: row.reporters, url: siteUrl() + '/' }).catch(() => {});
  }
  const owner = await db.users.findById(row.owner_id);
  if (!owner) return;
  ws.send(owner.id, { type: 'notif', notif_type: 'report_owner', ...notif(owner.lang, 'report_owner', { title: row.title }),
    link_id: row.id, time: new Date().toISOString() });
  mailer.mailListingReported({ to: owner.email, lang: owner.lang, name: owner.name, propertyTitle: row.title,
    url: `${siteUrl()}/annonce/${row.id}` }).catch(() => {});
}

// Remet l'annonce en modération si le seuil est atteint. Une seule requête : le décompte et le changement d'état sont atomiques.
//  • seuls comptent les membres distincts, à email confirmé, non suspendus, inscrits depuis plus de 24 h ;
//  • seuls comptent les signalements postérieurs à la dernière décision d'un administrateur (une annonce approuvée n'est pas retirée
//    à nouveau pour d'anciens signalements) ;
//  • jamais pour l'annonce d'un administrateur ou d'un annonceur vérifié : les administrateurs sont prévenus, ils tranchent.
async function hideIfNeeded(propertyId) {
  const min = hideAfter();
  if (!min) return null;
  const r = await db.pool.query(
    `WITH n AS (
       SELECT COUNT(DISTINCT s.user_id)::int AS c
         FROM signalements s
         JOIN users r ON r.id = s.user_id
        WHERE s.property_id = $1 AND s.status = 'pending'
          AND r.email_verified = true AND r.banned = false
          AND r.created_at < NOW() - make_interval(hours => $4)
          AND s.created_at > COALESCE((SELECT moderated_at FROM properties WHERE id = $1), '-infinity'::timestamptz)
     )
     UPDATE properties p
        SET status = 'pending', moderation_reason = $2, moderated_at = NOW(), moderated_by = NULL
       FROM n
      WHERE p.id = $1 AND p.status = 'active' AND n.c >= $3
        AND NOT EXISTS (SELECT 1 FROM users o WHERE o.id = p.owner_id AND (o.is_admin = true OR o.verified_kind IS NOT NULL))
        AND NOT EXISTS (SELECT 1 FROM agencies a WHERE a.owner_id = p.owner_id AND a.verified = true)
    RETURNING p.id, p.title, p.owner_id, n.c AS reporters`,
    [propertyId, HIDE_REASON, min, MIN_ACCOUNT_HOURS]);
  return r.rows[0] || null;
}

// Dépose un signalement. Résultat : 'own' (sa propre annonce), 'limit' (plafond quotidien), 'duplicate' (déjà signalée par ce
// membre et pas encore traitée : réponse identique à un succès, sans nouvelle ligne ni notification) ou 'ok' (avec `hidden`).
async function file(user, prop, motif, message) {
  if (prop.owner_id === user.id) return { result: 'own' };
  const day = (await db.pool.query(
    `SELECT COUNT(*)::int AS n FROM signalements WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`, [user.id])).rows[0].n;
  if (day >= DAILY_MAX) return { result: 'limit' };
  const ins = await db.pool.query(
    `INSERT INTO signalements (property_id, user_id, motif, message) VALUES ($1,$2,$3,$4)
     ON CONFLICT (property_id, user_id) WHERE status = 'pending' DO NOTHING RETURNING id`,
    [prop.id, user.id, motif, message]);
  if (!ins.rowCount) return { result: 'duplicate' };
  notifyAdminsNew(prop).catch(() => {});
  const hidden = await hideIfNeeded(prop.id);
  if (hidden) notifyHidden(hidden).catch(() => {});
  return { result: 'ok', hidden: !!hidden };
}

module.exports = { file, hideIfNeeded, hideAfter, MOTIFS, DAILY_MAX, HIDE_REASON };
