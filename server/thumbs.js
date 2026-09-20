// ── Miniatures des photos : /uploads/thumbs/<largeur>/<nom>.webp ─────────────────────────────────────────────────────
// Les envois sont réduits à 1920 px (routes/upload.js) : une carte d'annonce de 312 px de large chargeait donc 170 Ko et plus pour rien.
// Les miniatures sont générées à la première demande, puis conservées sur disque : express.static, placé avant cette route, les sert
// ensuite directement (en-têtes « immuable » de app.js). Aucune migration, aucun envoi à retraiter : les photos déjà en ligne en
// bénéficient aussitôt.
// Sûreté : largeurs de la liste WIDTHS seulement, nom de fichier strict (pas de « / », pas de « .. »), original obligatoire.
// Le stockage est donc borné : au plus WIDTHS.length miniatures par photo envoyée.
const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

// sharp garde par défaut les fichiers lus ouverts (cache de 20 fichiers) : sous Windows, une photo lue ne peut alors plus être supprimée ni remplacée
sharp.cache({ files: 0 });

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const THUMB_DIR  = path.join(UPLOAD_DIR, 'thumbs');
const WIDTHS     = [480, 960];
const NAME       = /^[\w.-]+\.webp$/i;     // les envois sont toujours convertis en WebP (routes/upload.js)
const QUALITY    = 76;

const pending = new Map();                 // miniature en cours de création : deux demandes simultanées n'en font qu'une

// Chemin de la miniature d'un fichier de /uploads, ou null si la demande n'est pas valide
function thumbPath(width, name) {
  const w = Number(width);
  if (!WIDTHS.includes(w) || String(w) !== String(width) || typeof name !== 'string' || !NAME.test(name)) return null;
  return { dest: path.join(THUMB_DIR, String(w), name), source: path.join(UPLOAD_DIR, name), width: w };
}

async function make({ dest, source, width }) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;   // écrit à part, renommé d'un bloc : jamais de fichier à moitié écrit
  try {
    await sharp(source).resize({ width, withoutEnlargement: true }).webp({ quality: QUALITY }).toFile(tmp);
    fs.renameSync(tmp, dest);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* rien à nettoyer */ }
    throw e;
  }
}

// Route Express : à monter APRÈS express.static (les miniatures existantes ne passent jamais ici)
async function serve(req, res, next) {
  const t = thumbPath(req.params.width, req.params.name);
  if (!t) return next();
  try {
    if (!fs.existsSync(t.dest)) {
      if (!pending.has(t.dest)) pending.set(t.dest, make(t).finally(() => pending.delete(t.dest)));
      if (!(await pending.get(t.dest))) return next();          // original absent : 404 ordinaire
    }
  } catch (e) {
    console.warn('[miniatures] ' + t.source + ' : ' + e.message);   // original illisible : 404 plutôt qu'une erreur 500
    return next();
  }
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(t.dest);
}

module.exports = { WIDTHS, thumbPath, serve, THUMB_DIR };
