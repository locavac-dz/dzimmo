// ── Vérification des annonceurs ──────────────────────────────────────────────
// Un utilisateur envoie un justificatif (pièce d'identité, ou registre de commerce / agrément pour un
// professionnel) ; un administrateur l'examine puis approuve ou refuse. Approuvé : users.verified_kind
// ('identity' | 'business') alimente le badge public ; « business » vérifie aussi l'agence du compte, qui publie
// alors sans modération. Les justificatifs (données sensibles, loi 18-07) restent dans un dossier privé, hors de
// public/, et sont supprimés dès la décision : on ne garde que le résultat.
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const sharp  = require('sharp');
const db     = require('./db');
const ws     = require('./ws');
const mailer = require('./mailer');
const { notif, translateReason } = require('./messages');

const KINDS = {
  identity: ['cni', 'passeport', 'permis'],
  business: ['registre_commerce', 'agrement'],
};
const MAX_FILES = 2;                        // recto + verso
const FILE_NAME = /^[a-f0-9]{32}\.webp$/;   // seuls des noms que nous avons générés sont lus ou supprimés

const dir = () => process.env.VERIFICATION_DIR
  || path.join(__dirname, '..', 'private', 'verification');

const siteUrl = () => (process.env.APP_URL || 'http://localhost:3001').replace(/\/+$/, '');

// Vérifie que le buffer est une vraie image, retire ses métadonnées (EXIF, GPS), la réduit et l'enregistre en WebP
async function saveImage(buffer) {
  const name = crypto.randomBytes(16).toString('hex') + '.webp';
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  await sharp(buffer, { failOn: 'error' })
    .rotate()
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(path.join(dir(), name));
  return name;
}

function filePath(name) {
  if (!FILE_NAME.test(String(name))) return null;
  return path.join(dir(), name);
}

// Supprime des fichiers (ceux qui n'existent plus sont ignorés)
async function removeFiles(names) {
  await Promise.all((names || []).map(async n => {
    const p = filePath(n);
    if (!p) return;
    try { await fs.promises.unlink(p); } catch (e) { if (e.code !== 'ENOENT') console.error('[verification] suppression :', e.message); }
  }));
}

// Approuve ou refuse une demande en cours (transaction) ; renvoie la demande à jour, ou null si elle n'est plus en cours.
async function decide(id, adminId, { approve, reason }) {
  const client = await db.pool.connect();
  let files = [], request;
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM verification_requests WHERE id = $1 FOR UPDATE', [id]);
    request = found.rows[0];
    if (!request || request.status !== 'pending') { await client.query('ROLLBACK'); return null; }
    files = request.files || [];

    await client.query(
      `UPDATE verification_requests
          SET status = $1, reason = $2, reviewed_by = $3, reviewed_at = NOW(), files = '[]'
        WHERE id = $4`,
      [approve ? 'approved' : 'rejected', approve ? null : reason, adminId, id]);

    if (approve) {
      // « business » ne peut pas être rétrogradé en « identity » par une vérification d'identité ultérieure
      await client.query(
        `UPDATE users
            SET verified_kind = CASE WHEN verified_kind = 'business' THEN 'business' ELSE $1 END, verified_at = NOW()
          WHERE id = $2`, [request.kind, request.user_id]);
      if (request.kind === 'business')
        await client.query('UPDATE agencies SET verified = true WHERE owner_id = $1', [request.user_id]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await removeFiles(files);            // après la validation de la transaction : jamais de fichier supprimé pour rien
  return { ...request, status: approve ? 'approved' : 'rejected', files: [] };
}

// Retire la vérification d'un compte (fraude constatée après coup) ; l'agence perd aussi son statut vérifié
async function revoke(userId) {
  const r = await db.pool.query(
    'UPDATE users SET verified_kind = NULL, verified_at = NULL WHERE id = $1 AND verified_kind IS NOT NULL RETURNING id', [userId]);
  if (!r.rowCount) return false;
  await db.pool.query('UPDATE agencies SET verified = false WHERE owner_id = $1', [userId]);
  return true;
}

// Supprime les fichiers en attente d'un compte (suppression du compte)
async function purgeUser(userId) {
  const r = await db.pool.query(
    `SELECT files FROM verification_requests WHERE user_id = $1 AND status = 'pending'`, [userId]);
  await removeFiles(r.rows.flatMap(x => x.files || []));
}

// ── Notifications ────────────────────────────────────────────────────────────
async function notifyAdminsPending(user, request) {
  const admins = (await db.pool.query(
    'SELECT id, email, lang FROM users WHERE is_admin = true AND banned = false')).rows;
  for (const a of admins) {
    ws.send(a.id, {
      type: 'notif', notif_type: 'verification_pending',
      ...notif(a.lang, 'verif_pending', { name: user.name }),
      link_id: request.id, time: new Date().toISOString(),
    });
    mailer.mailAdminVerificationPending({
      to: a.email, lang: a.lang, ownerName: user.name, kind: request.kind, url: `${siteUrl()}/`,
    }).catch(() => {});
  }
}

async function notifyUserDecision(request, approved, reason) {
  const user = await db.users.findById(request.user_id);
  if (!user) return;
  ws.send(user.id, {
    type: 'notif', notif_type: 'verification_decision',
    ...(approved
      ? notif(user.lang, 'verif_approved', { name: user.name })
      : notif(user.lang, 'verif_rejected', { name: user.name, reason: translateReason(reason, user.lang) })),
    time: new Date().toISOString(),
  });
  mailer.mailVerificationDecision({
    to: user.email, lang: user.lang, name: user.name, kind: request.kind, approved, reason, url: `${siteUrl()}/`,
  }).catch(() => {});
}

module.exports = {
  KINDS, MAX_FILES, dir, saveImage, filePath, removeFiles, decide, revoke, purgeUser,
  notifyAdminsPending, notifyUserDecision,
};
