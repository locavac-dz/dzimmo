// Vérification des annonceurs, côté administration : file des demandes, consultation du justificatif,
// décision, retrait d'une vérification. Monté sous /api/admin/verifications.
const router = require('express').Router();
const fs     = require('fs');
const db     = require('../db');
const admin  = require('../middleware/admin');
const V      = require('../verification');
const audit  = require('../audit');
const { paginate } = require('../pagination');

// GET /api/admin/verifications?status=pending|approved|rejected — file paginée (les plus anciennes d'abord en attente)
router.get('/', admin, async (req, res) => {
  const status = ['approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const [list, counts] = await Promise.all([
    paginate(db.pool, {
      defaut: 10, query: req.query, params: [status], where: 'WHERE v.status = $1', countFrom: 'verification_requests v',
      orderBy: `v.created_at ${status === 'pending' ? 'ASC' : 'DESC'}, v.id`,
      columns: `v.id, v.kind, v.doc_type, v.reference, v.status, v.reason, v.created_at, v.reviewed_at,
                jsonb_array_length(v.files) AS files_count,
                u.id AS user_id, u.name AS user_name, u.email AS user_email, u.phone AS user_phone,
                u.email_verified AS user_email_verified, u.created_at AS user_since, u.verified_kind AS user_verified_kind,
                a.name AS agency_name`,
      from: `verification_requests v
             JOIN users u ON u.id = v.user_id
             LEFT JOIN agencies a ON a.owner_id = u.id`,
    }),
    db.pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending FROM verification_requests`),
  ]);
  res.json({ ...list, counts: counts.rows[0] });
});

// GET /api/admin/verifications/:id/files/:n — justificatif (image), jamais mis en cache ni exposé publiquement
router.get('/:id/files/:n', admin, async (req, res) => {
  const id = db.toId(req.params.id);
  const n = /^\d$/.test(req.params.n) ? Number(req.params.n) : -1;
  const r = id && await db.pool.query(
    `SELECT files FROM verification_requests WHERE id = $1 AND status = 'pending'`, [id]);
  const file = r && r.rows[0] && V.filePath((r.rows[0].files || [])[n]);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Justificatif introuvable.' });
  res.set({
    'Content-Type': 'image/webp',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': 'inline; filename="justificatif.webp"',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
});

// PUT /api/admin/verifications/:id/decision — { decision: 'approve' | 'reject', reason }
router.put('/:id/decision', admin, async (req, res) => {
  const { decision } = req.body;
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Décision invalide.' });
  const approve = decision === 'approve';
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  if (!approve && reason.length < 5)
    return res.status(400).json({ error: 'Un motif de refus (5 caractères minimum) est obligatoire.' });
  const id = db.toId(req.params.id);
  const request = id && await V.decide(id, req.user.id, { approve, reason });
  if (!request) {
    const exists = id && await db.pool.query('SELECT 1 FROM verification_requests WHERE id = $1', [id]);
    return exists && exists.rowCount
      ? res.status(409).json({ error: 'Demande déjà traitée.' })
      : res.status(404).json({ error: 'Demande introuvable.' });
  }
  V.notifyUserDecision(request, approve, reason).catch(() => {});
  audit.log(req.user.id, approve ? 'verify_user' : 'reject_verification', 'user', request.user_id,
    approve ? { kind: request.kind } : { kind: request.kind, reason }).catch(() => {});
  res.json({ ok: true, status: request.status });
});

// PUT /api/admin/verifications/revoke/:userId — retire la vérification d'un compte (fraude constatée après coup)
router.put('/revoke/:userId', admin, async (req, res) => {
  const uid = db.toId(req.params.userId) ?? 0;
  const ok = await V.revoke(uid);
  if (!ok) return res.status(404).json({ error: 'Ce compte n\'est pas vérifié.' });
  audit.log(req.user.id, 'revoke_verification', 'user', uid).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
