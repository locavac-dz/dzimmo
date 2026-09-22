const router = require('express').Router();
const db     = require('../db');
const search = require('../search');

const SQL = text => `
  SELECT p.id, p.title, p.wilaya, p.price, p.mode, p.type_bien
    FROM properties p
    JOIN property_search s ON s.property_id = p.id
   WHERE p.status = 'active' AND ${text}
   LIMIT 8`;

async function query(q) {
  const params = [];
  const push = v => { params.push(v); return '$' + params.length; };
  const text = search.condition(q, 's.text', ['p.title', 'p.commune', 'p.wilaya'], push);
  if (!text) return [];
  return (await db.pool.query(SQL(text), params)).rows;
}

// GET /api/search/suggest?q=… — autocomplétion avec 2ème passe tolérante (sans pg_trgm).
// Passe 1 : correspondance sous-chaîne exacte (normalisée). Passe 2 (si < 3 résultats) :
// chaque mot ≥ 5 caractères est tronqué d'1 char pour tolérer une lettre en trop à la fin.
router.get('/suggest', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) return res.json([]);

  let rows = await query(q);

  if (rows.length < 3) {
    const words = search.tokens(q);
    const shorter = words.map(w => w.length >= 5 ? w.slice(0, -1) : w).join(' ');
    if (shorter !== search.tokens(q).join(' ') && shorter.trim()) {
      const rows2 = await query(shorter);
      const seen  = new Set(rows.map(r => r.id));
      rows = [...rows, ...rows2.filter(r => !seen.has(r.id))].slice(0, 8);
    }
  }

  res.json(rows);
});

module.exports = router;
