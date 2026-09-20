const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');
const projects = require('../projects');

// GET /api/projects — programmes neufs publics : ?wilaya= &status= &agency_id= &q= &sort=recent|price|name &page= &per_page=
router.get('/', async (req, res) => {
  res.json(await projects.list(req.query));
});

// GET /api/projects/mine — programmes de son agence, y compris masqués (promoteur non vérifié)
router.get('/mine', auth, async (req, res) => {
  res.json(await projects.ofOwner(req.user.id));
});

// GET /api/projects/:id — un programme (les lots se lisent par /api/properties?project_id=)
router.get('/:id', optionalAuth, async (req, res) => {
  const p = await projects.get(req.params.id, req.user ? req.user.id : null);
  if (!p) return res.status(404).json({ error: 'Programme introuvable.' });
  res.json(p);
});

// Agence du compte : seul un promoteur dont le registre / l'agrément est vérifié publie un programme
async function promoterOf(user) {
  const mine = await db.agencies.findOne({ owner_id: user.id });
  if (!mine) return { error: 'Aucune agence trouvée.', status: 404 };
  if (mine.kind !== 'promoteur' || !mine.verified)
    return { error: 'Seuls les promoteurs vérifiés peuvent publier un programme.', status: 403 };
  return { agency: mine };
}

// POST /api/projects
router.post('/', auth, async (req, res) => {
  const who = await promoterOf(req.user);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const { values, error } = projects.cleanProject(req.body, { creating: true });
  if (error) return res.status(400).json({ error });
  const created = await db.pool.query(
    `INSERT INTO projects (agency_id, ${Object.keys(values).join(', ')})
     VALUES ($1, ${Object.keys(values).map((_, i) => '$' + (i + 2)).join(', ')}) RETURNING id`,
    [who.agency.id, ...Object.values(values)]);
  res.status(201).json({ id: created.rows[0].id });
});

// Programme modifiable : celui de son agence (ou n'importe lequel pour un admin)
async function editable(req, res) {
  const found = await db.pool.query(
    'SELECT j.id, a.owner_id FROM projects j JOIN agencies a ON a.id = j.agency_id WHERE j.id = $1', [db.toId(req.params.id) ?? 0]);
  const row = found.rows[0];
  if (!row) { res.status(404).json({ error: 'Programme introuvable.' }); return null; }
  if (row.owner_id !== req.user.id && !req.user.is_admin) { res.status(403).json({ error: 'Accès refusé.' }); return null; }
  return row;
}

// PUT /api/projects/:id
router.put('/:id', auth, async (req, res) => {
  const row = await editable(req, res);
  if (!row) return;
  const { values, error } = projects.cleanProject(req.body);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(values);
  if (keys.length)
    await db.pool.query(`UPDATE projects SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [row.id, ...Object.values(values)]);
  res.json({ ok: true });
});

// DELETE /api/projects/:id — les lots restent en ligne, détachés du programme
router.delete('/:id', auth, async (req, res) => {
  const row = await editable(req, res);
  if (!row) return;
  await db.pool.query('DELETE FROM projects WHERE id = $1', [row.id]);
  res.json({ ok: true });
});

module.exports = router;
