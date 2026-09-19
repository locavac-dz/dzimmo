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
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    try {
      const url = await processImage(req.file.buffer);
      res.json({ url });
    } catch (e) {
      console.error('[upload] Erreur compression :', e.message);
      res.status(500).json({ error: 'Erreur lors du traitement de l\'image.' });
    }
  });
});

// POST /api/upload/multiple — upload de plusieurs images (max 10)
router.post('/multiple', auth, (req, res) => {
  upload.array('files', 10)(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files?.length) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    try {
      const urls = await Promise.all(req.files.map(f => processImage(f.buffer)));
      res.json({ urls });
    } catch (e) {
      console.error('[upload] Erreur compression :', e.message);
      res.status(500).json({ error: 'Erreur lors du traitement des images.' });
    }
  });
});

module.exports = router;
