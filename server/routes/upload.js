const router  = require('express').Router();
const multer  = require('multer');
const sharp   = require('sharp');
const path    = require('path');
const fs      = require('fs');
const auth    = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES      = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MAX_SIZE_MB         = 10; // tolérance upload brut — sharp compressera ensuite

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_TYPES.includes(file.mimetype) && ALLOWED_EXTENSIONS.includes(ext))
      cb(null, true);
    else cb(new Error('Format non supporté. Utilisez JPEG, PNG ou WebP.'));
  },
});

// Erreurs de multer (en anglais) : messages français stables, donc traduisibles
const UPLOAD_ERRORS = {
  LIMIT_FILE_SIZE: `Fichier trop volumineux (${MAX_SIZE_MB} Mo maximum).`,
  LIMIT_FILE_COUNT: 'Trop de fichiers (10 maximum).',
  LIMIT_UNEXPECTED_FILE: 'Fichier inattendu.',
};
const uploadErrorMessage = err => UPLOAD_ERRORS[err.code] || err.message;
const UNREADABLE = 'Image illisible ou corrompue.';

// Compresse et sauvegarde un buffer image → WebP ≤ 1920 px, qualité 82
async function processImage(buffer) {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
  const dest     = path.join(UPLOAD_DIR, filename);
  await sharp(buffer)
    .rotate()                          // respecte l'orientation EXIF
    .resize({ width: 1920, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(dest);
  return `/uploads/${filename}`;
}

// POST /api/upload — upload d'une image
router.post('/', auth, (req, res) => {
  upload.single('file')(req, res, async err => {
    if (err) return res.status(400).json({ error: uploadErrorMessage(err) });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    try {
      const url = await processImage(req.file.buffer);
      res.json({ url });
    } catch (e) {
      // Fichier renommé en .png, image tronquée… : c'est le fichier envoyé qui est en cause, pas le serveur (400 et non 500)
      res.status(400).json({ error: UNREADABLE });
    }
  });
});

// POST /api/upload/multiple — upload de plusieurs images (max 10)
router.post('/multiple', auth, (req, res) => {
  upload.array('files', 10)(req, res, async err => {
    if (err) return res.status(400).json({ error: uploadErrorMessage(err) });
    if (!req.files?.length) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    // Tout ou rien : si une image est illisible, celles déjà écrites sont retirées (sinon des fichiers sans annonce s'accumulaient)
    const done = await Promise.allSettled(req.files.map(f => processImage(f.buffer)));
    if (done.some(d => d.status === 'rejected')) {
      for (const d of done) if (d.status === 'fulfilled') fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(d.value))).catch(() => {});
      return res.status(400).json({ error: UNREADABLE });
    }
    res.json({ urls: done.map(d => d.value) });
  });
});

module.exports = router;
