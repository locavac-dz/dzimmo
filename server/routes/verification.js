// Vérification d'un annonceur, côté demandeur : envoi du justificatif, suivi de la demande, annulation.
// L'examen par un administrateur est dans routes/admin-verifications.js.
const router = require('express').Router();
const multer = require('multer');
const db     = require('../db');
const auth   = require('../middleware/auth');
const V      = require('../verification');

const MAX_SIZE_MB = 8;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024, files: V.MAX_FILES },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Format non supporté. Utilisez JPEG, PNG ou WebP.'));
  },
});
// Erreurs de multer (en anglais) : messages français stables, donc traduisibles
const UPLOAD_ERRORS = {
  LIMIT_FILE_SIZE: `Fichier trop volumineux (${MAX_SIZE_MB} Mo maximum).`,
  LIMIT_FILE_COUNT: `Trop de fichiers (${V.MAX_FILES} maximum).`,
  LIMIT_UNEXPECTED_FILE: 'Fichier inattendu.',
};

// Demande la plus récente du compte, sans les noms de fichiers
const publicRequest = r => !r ? null : ({
  id: r.id, kind: r.kind, doc_type: r.doc_type, reference: r.reference, status: r.status,
  reason: r.reason, created_at: r.created_at, reviewed_at: r.reviewed_at,
});

// GET /api/verification/me — état de la vérification du compte
router.get('/me', auth, async (req, res) => {
  const [user, last, agency] = await Promise.all([
    db.users.findById(req.user.id),
    db.pool.query('SELECT * FROM verification_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [req.user.id]),
    db.agencies.findOne({ owner_id: req.user.id }),
  ]);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  res.json({
    verified_kind: user.verified_kind || null,
    verified_at: user.verified_at || null,
    agency: agency ? { id: agency.id, name: agency.name, verified: !!agency.verified } : null,
    request: publicRequest(last.rows[0]),
  });
});

// POST /api/verification — multipart : kind, doc_type, reference (professionnels), consent, files (1 à 2 photos)
router.post('/', auth, (req, res) => {
  upload.array('files', V.MAX_FILES)(req, res, async err => {
    if (err) return res.status(400).json({ error: UPLOAD_ERRORS[err.code] || err.message });
    const { kind, doc_type, consent } = req.body;
    const reference = String(req.body.reference || '').trim();
    const uploads = req.files || [];
    const saved = [];
    // Les fichiers déjà écrits partent AVANT la réponse d'erreur : le client qui reçoit un refus ne doit jamais voir d'orphelin
    const cleanBeforeReply = async () => { const names = saved.splice(0); await V.removeFiles(names); };
    try {
      // Tout est validé avant d'écrire le moindre fichier
      if (!Object.hasOwn(V.KINDS, kind)) return res.status(400).json({ error: 'Type de vérification invalide.' });
      if (!V.KINDS[kind].includes(doc_type)) return res.status(400).json({ error: 'Type de document invalide.' });
      if (kind === 'business' && (reference.length < 3 || reference.length > 40))
        return res.status(400).json({ error: 'Numéro du registre de commerce ou de l\'agrément requis.' });
      if (!['true', 'on', '1'].includes(String(consent)))
        return res.status(400).json({ error: 'Votre consentement est requis pour examiner le justificatif.' });
      if (!uploads.length) return res.status(400).json({ error: 'Au moins un justificatif (photo) est requis.' });

      const user = await db.users.findById(req.user.id);
      if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
      if (user.verified_kind === 'business' || user.verified_kind === kind)
        return res.status(409).json({ error: 'Votre compte est déjà vérifié.' });

      for (const f of uploads) {
        try { saved.push(await V.saveImage(f.buffer)); }
        catch { return res.status(400).json({ error: 'Ce justificatif n\'est pas une image valide.' }); }
      }

      const r = await db.pool.query(
        `INSERT INTO verification_requests (user_id, kind, doc_type, reference, files)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.user.id, kind, doc_type, kind === 'business' ? reference : null, JSON.stringify(saved)]);
      saved.length = 0;   // conservés : rattachés à la demande
      V.notifyAdminsPending(user, r.rows[0]).catch(() => {});
      res.status(201).json({ id: r.rows[0].id, status: 'pending' });
    } catch (e) {
      if (e.code === '23505') { await cleanBeforeReply(); return res.status(409).json({ error: 'Une demande de vérification est déjà en cours.' }); }
      // Hors d'une route asynchrone : une erreur non traitée ici ferait tomber le processus
      console.error('[verification]', e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur interne du serveur.' });
    } finally {
      await V.removeFiles(saved);   // demande refusée ou en erreur : aucun fichier orphelin
    }
  });
});

// DELETE /api/verification/:id — le demandeur retire sa demande en cours (ses fichiers sont supprimés)
router.delete('/:id', auth, async (req, res) => {
  const id = db.toId(req.params.id);
  const r = id && await db.pool.query(
    `DELETE FROM verification_requests WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING files`,
    [id, req.user.id]);
  if (!r || !r.rowCount) return res.status(404).json({ error: 'Demande introuvable.' });
  await V.removeFiles(r.rows[0].files);
  res.json({ ok: true });
});

module.exports = router;
