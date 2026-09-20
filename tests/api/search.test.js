// Recherche tolérante : parité de la normalisation SQL (dz_norm) et JavaScript (normalize), caractère par caractère.
// Les tests de comportement (annonces, agences, programmes, déclencheurs, lexique) viennent avec le branchement de la recherche.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, search;
const q = (sql, p) => s.db.pool.query(sql, p);
const ch = (...codes) => String.fromCharCode(...codes);   // caractères construits par leur code : aucune séquence d'échappement dans ce fichier

test.before(async () => { s = await startServer(); search = require('../../server/search'); });
test.after(async () => { await s.stop(); });

// ── Parité : dz_norm (SQL) = normalize (JavaScript), caractère par caractère ────────────────────────────────────────
test('parité : dz_norm() et normalize() donnent le même résultat sur tous les caractères des blocs latin et arabe, formes décomposées et textes aléatoires', async () => {
  const strings = [];
  for (let cp = 0x20; cp <= 0x24F; cp++) strings.push(ch(cp));                 // ASCII, Latin-1, Latin étendu A et B
  for (let cp = 0x600; cp <= 0x6FF; cp++) strings.push(ch(cp));                // bloc arabe (lettres, tachkil, chiffres indo-arabes et persans)
  for (const base of ['e', 'A', 'o', 'N', 'u', 'I']) for (let cp = 0x300; cp <= 0x36F; cp++) strings.push(base + ch(cp));   // lettre + marque combinante
  for (const base of ['ش', 'ا', 'و', 'ي', 'ة']) for (let cp = 0x64B; cp <= 0x65F; cp++) strings.push(base + ch(cp));       // lettre arabe + tachkil
  strings.push('', ' ', '   ', 'Œuvre ŒUF æ Æ ß ẞ', 'Élégant Béjaïa', 'شَقَّة كـراء', 'F٣ ۴', "l'ancien-Bab/Ezzouar (100%)", 'x'.repeat(500));
  // Textes aléatoires (générateur congruentiel à graine fixe : reproductible)
  const pool = [...strings.filter(x => x.length === 1), ' ', '-', "'", '.', ',', '%', '_', '(', ')'];
  let seed = 123456789;
  const rnd = m => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
  for (let i = 0; i < 3000; i++) strings.push(Array.from({ length: 1 + rnd(30) }, () => pool[rnd(pool.length)]).join(''));
  const mismatches = [];
  for (let i = 0; i < strings.length; i += 1000) {
    const chunk = strings.slice(i, i + 1000);
    const sql = (await q('SELECT dz_norm(t.s) AS n FROM unnest($1::text[]) WITH ORDINALITY AS t(s, i) ORDER BY t.i', [chunk])).rows.map(r => r.n);
    chunk.forEach((str, j) => { if (sql[j] !== search.normalize(str)) mismatches.push(`U+${[...str].map(c => c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join('+')} : SQL « ${sql[j]} » ≠ JS « ${search.normalize(str)} »`); });
  }
  assert.deepEqual(mismatches.slice(0, 15), [], `${mismatches.length} divergence(s) sur ${strings.length} textes`);
  assert.ok(strings.length > 1500);
  assert.equal((await q('SELECT dz_norm(NULL) AS n')).rows[0].n, '', 'NULL : chaîne vide, comme normalize(null)');
});
