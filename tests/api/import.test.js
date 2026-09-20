// Import d'annonces en lot par fichier CSV (POST /api/import).
// Vérifie la validation des colonnes, la création en modération, les erreurs par ligne et l'isolation.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, agent, other;
const q = (sql, p) => s.db.pool.query(sql, p);

test.before(async () => {
  s = await startServer();
  agent = await s.register('agent');
  other = await s.register('other');
});
test.after(async () => { await s.stop(); });

// Envoie un CSV au serveur avec fetch + FormData
async function postCSV(token, csvText, filename = 'annonces.csv') {
  const { Blob, FormData } = globalThis;
  const form = new FormData();
  form.append('file', new Blob([csvText], { type: 'text/csv' }), filename);
  const res = await fetch(s.base + '/api/import', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'X-Lang': 'fr' },
    body: form,
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const HEADER = 'titre,mode,type,prix,wilaya';
const LIGNE_OK = '"Villa test","vente","villa","15000000","Alger"';

test('non authentifié : 401', async () => {
  const r = await postCSV(null, HEADER + '\n' + LIGNE_OK);
  assert.equal(r.status, 401);
});

test('pas de fichier : 400', async () => {
  const res = await fetch(s.base + '/api/import', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + agent.token, 'X-Lang': 'fr' },
    // pas de body
  });
  assert.equal(res.status, 400);
  const d = await res.json();
  assert.ok(d.error, 'message d\'erreur attendu');
});

test('CSV valide : annonces créées avec status pending', async () => {
  const csv = [HEADER, LIGNE_OK, '"Appart F3","location_longue","appartement","50000","Oran"'].join('\n');
  const r = await postCSV(agent.token, csv);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.created, 2);
  assert.equal(r.body.errors.length, 0);

  // Vérifier que les annonces ont bien le statut pending et appartiennent à l'agent
  const { rows } = await q('SELECT status, owner_id FROM properties WHERE owner_id = $1 ORDER BY id DESC LIMIT 2', [agent.id]);
  assert.equal(rows.length, 2);
  rows.forEach(p => assert.equal(p.status, 'pending'));
  rows.forEach(p => assert.equal(p.owner_id, agent.id));
});

test('CSV avec erreurs de validation : erreurs par ligne retournées', async () => {
  const csv = [
    HEADER,
    '"Villa OK","vente","villa","9000000","Alger"',     // ligne 2 : OK
    '"Sans titre","vente","villa","9000000","Alger"'.replace('"Sans titre"', '""'), // ligne 3 : titre vide
    '"Mode invalide","invalide","villa","9000000","Alger"', // ligne 4 : mode inconnu
    '"Prix négatif","vente","villa","-100","Alger"',    // ligne 5 : prix invalide
    '"Wilaya inconnue","vente","villa","5000000","Mars"', // ligne 6 : wilaya inconnue
  ].join('\n');

  const r = await postCSV(agent.token, csv);
  assert.equal(r.status, 200);
  assert.equal(r.body.created, 1, 'une seule ligne valide');
  assert.equal(r.body.errors.length, 4);
  const nums = r.body.errors.map(e => e.line);
  assert.deepEqual(nums.sort((a, b) => a - b), [3, 4, 5, 6]);
});

test('colonne requise manquante : 400', async () => {
  const r = await postCSV(agent.token, 'titre,mode,type,wilaya\n"Villa","vente","villa","Alger"');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /colonne/i);
});

test('CSV vide (seulement l\'en-tête) : 400', async () => {
  const r = await postCSV(agent.token, HEADER);
  assert.equal(r.status, 400);
});

test('template CSV : 200, téléchargeable', async () => {
  const res = await fetch(s.base + '/api/import/template', {
    headers: { Authorization: 'Bearer ' + agent.token },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  const text = await res.text();
  assert.match(text, /titre,mode,type,prix,wilaya/);
  // Contient au moins une ligne d'exemple
  assert.ok(text.split('\n').length >= 2, 'au moins une ligne exemple');
});

test('isolation : les annonces importées appartiennent uniquement à l\'importateur', async () => {
  const csv = [HEADER, '"Annonce other","vente","villa","9000000","Alger"'].join('\n');
  await postCSV(other.token, csv);

  const agentProps = await q('SELECT id FROM properties WHERE owner_id = $1', [agent.id]);
  const otherProps = await q('SELECT id FROM properties WHERE owner_id = $1', [other.id]);

  const agentIds = new Set(agentProps.rows.map(p => p.id));
  for (const p of otherProps.rows) assert.ok(!agentIds.has(p.id), 'l\'annonce de other ne doit pas être dans agent');
});

test('champs optionnels : surface, pièces, salles, commune, description', async () => {
  const csv = [
    HEADER + ',commune,description,surface,pieces,salles',
    '"Appart","vente","appartement","8000000","Batna","Timgad","Belle vue",85,3,1',
  ].join('\n');
  const r = await postCSV(agent.token, csv);
  assert.equal(r.status, 200);
  assert.equal(r.body.created, 1);

  const { rows } = await q(
    'SELECT surface_m2, rooms, baths, commune, description FROM properties WHERE owner_id = $1 ORDER BY id DESC LIMIT 1',
    [agent.id]);
  const p = rows[0];
  assert.equal(Number(p.surface_m2), 85);
  assert.equal(Number(p.rooms), 3);
  assert.equal(Number(p.baths), 1);
  assert.equal(p.commune, 'Timgad');
  assert.equal(p.description, 'Belle vue');
});
