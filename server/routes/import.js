// Import en lot d'annonces par fichier CSV.
// POST /api/import         → { created, errors: [{line, error}] }
// GET  /api/import/template → fichier CSV exemple à remplir

const router = require('express').Router();
const multer = require('multer');
const auth   = require('../middleware/auth');
const db     = require('../db');

const MODES_VALIDES = ['vente', 'location_longue', 'location_courte'];
const TYPES_VALIDES = ['appartement', 'villa', 'maison', 'bureau', 'local_commercial', 'terrain', 'ferme', 'entrepot'];
const WILAYAS_SET   = new Set(require('../wilayas'));
const MAX_LIGNES    = 200;

const UPLOAD_ERRORS = {
  LIMIT_FILE_SIZE: 'CSV trop volumineux (2 Mo maximum).',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// Analyse une ligne CSV ; gère les guillemets doubles (RFC 4180)
function csvLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (!lines.length) return null;
  const headers = csvLine(lines[0]).map(h => h.trim().toLowerCase());
  return { headers, rows: lines.slice(1).map(l => csvLine(l)) };
}

// GET /api/import/template — modèle CSV à remplir
router.get('/template', (_, res) => {
  const csv = [
    'titre,mode,type,prix,wilaya,commune,description,surface,pieces,salles',
    '"Villa de standing","vente","villa","25000000","Alger","Ben Aknoun","Belle villa avec jardin",250,5,3',
    '"Appartement F3","location_longue","appartement","60000","Oran","Bir El Djir","Appartement meublé",90,3,2',
    '"Local commercial","vente","local_commercial","8000000","Constantine","","Local en RDC",120,,',
  ].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="dzimmo-import-modele.csv"');
  // BOM UTF-8 pour que Excel reconnaisse l'encodage automatiquement
  res.send('﻿' + csv);
});

// POST /api/import — traitement du CSV
router.post('/', auth, (req, res) => {
  upload.single('file')(req, res, async err => {
    if (err) return res.status(400).json({ error: UPLOAD_ERRORS[err.code] || 'Erreur interne du serveur.' });

    if (!req.file) return res.status(400).json({ error: 'Fichier CSV requis.' });

    const text   = req.file.buffer.toString('utf-8').replace(/^﻿/, '');
    const parsed = parseCSV(text);
    if (!parsed) return res.status(400).json({ error: 'Fichier CSV vide ou invalide.' });

    const { headers, rows } = parsed;
    const required = ['titre', 'mode', 'type', 'prix', 'wilaya'];
    const missing  = required.filter(c => !headers.includes(c));
    if (missing.length) return res.status(400).json({ error: 'Colonnes requises manquantes.' });

    const dataRows = rows.filter(r => r.some(c => c.trim()));
    if (!dataRows.length) return res.status(400).json({ error: 'Fichier CSV vide ou invalide.' });
    if (dataRows.length > MAX_LIGNES)
      return res.status(400).json({ error: `CSV trop long (${MAX_LIGNES} lignes maximum).` });

    const get = (row, col) => {
      const i = headers.indexOf(col);
      return i >= 0 ? (row[i] || '').trim() : '';
    };

    const results = { created: 0, errors: [] };

    for (let i = 0; i < dataRows.length; i++) {
      const row     = dataRows[i];
      const lineNum = i + 2; // +1 en-tête, base-1

      const title     = get(row, 'titre');
      const mode      = get(row, 'mode');
      const type_bien = get(row, 'type');
      const priceStr  = get(row, 'prix');
      const wilaya    = get(row, 'wilaya');

      if (!title || !mode || !type_bien || !priceStr || !wilaya) {
        results.errors.push({ line: lineNum, error: 'Champs obligatoires : titre, mode, type, prix, wilaya.' }); continue;
      }
      if (!MODES_VALIDES.includes(mode)) {
        results.errors.push({ line: lineNum, error: 'Mode invalide.' }); continue;
      }
      if (!TYPES_VALIDES.includes(type_bien)) {
        results.errors.push({ line: lineNum, error: 'Type de bien invalide.' }); continue;
      }
      const price = Number(priceStr.replace(/[\s ]/g, ''));
      if (!isFinite(price) || price <= 0) {
        results.errors.push({ line: lineNum, error: 'Prix invalide.' }); continue;
      }
      if (!WILAYAS_SET.has(wilaya)) {
        results.errors.push({ line: lineNum, error: 'Wilaya invalide.' }); continue;
      }

      const surfaceVal = Number(get(row, 'surface'));
      const roomsVal   = Number(get(row, 'pieces'));
      const bathsVal   = Number(get(row, 'salles'));

      try {
        await db.properties.insert({
          owner_id:    req.user.id,
          title:       title.slice(0, 200),
          mode, type_bien, price, wilaya,
          commune:     get(row, 'commune').slice(0, 100) || null,
          description: get(row, 'description').slice(0, 3000),
          surface_m2:  isFinite(surfaceVal) && surfaceVal > 0 ? surfaceVal : null,
          rooms:       isFinite(roomsVal)   && roomsVal   > 0 ? roomsVal   : null,
          baths:       isFinite(bathsVal)   && bathsVal   > 0 ? bathsVal   : null,
          image:       '',
          photos:      JSON.stringify([]),
          features:    JSON.stringify([]),
          status:      'pending',
          published_at: null,
        });
        results.created++;
      } catch {
        results.errors.push({ line: lineNum, error: 'Erreur interne du serveur.' });
      }
    }

    res.json(results);
  });
});

module.exports = router;
