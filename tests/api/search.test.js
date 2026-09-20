// Recherche tolérante de bout en bout : parité SQL / JavaScript de la normalisation, annonces, agences, programmes, déclencheurs, lexique.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');

let s, owner, search;
let n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);
const ch = (...codes) => String.fromCharCode(...codes);   // caractères construits par leur code : aucune séquence d'échappement dans ce fichier

test.before(async () => {
  s = await startServer();
  search = require('../../server/search');
  owner = await s.register('recherche');
  await q('DELETE FROM properties');
  await q('DELETE FROM agencies');
});
test.after(async () => { await s.stop(); });

async function ad(title, over = {}) {
  const o = { description: 'D', mode: 'vente', type_bien: 'villa', wilaya: 'Oran', commune: null, address: null, status: 'active', ...over };
  return (await q(`INSERT INTO properties (owner_id, title, description, mode, type_bien, price, wilaya, commune, address, status, published_at)
                   VALUES ($1, $2, $3, $4, $5, 1000000, $6, $7, $8, $9, NOW()) RETURNING id`,
    [owner.id, title, o.description, o.mode, o.type_bien, o.wilaya, o.commune, o.address, o.status])).rows[0].id;
}
const titles = async (qs, extra = '') => (await s.request('GET', `/api/properties?limit=100${extra}&q=${encodeURIComponent(qs)}`)).body.data.map(p => p.title).sort();

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

// ── Annonces ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('annonces : accents et majuscules sans importance, dans les deux sens', async () => {
  await ad('Villa élégante à Béjaïa', { wilaya: 'Béjaïa', description: 'Proche de la plage' });
  await ad('Terrain AGRICOLE', { type_bien: 'terrain', description: 'Électricité et eau' });
  for (const probe of ['elegante', 'ELEGANTE', 'élégante', 'ÉLÉGANTE', 'élegante', 'bejaia', 'BÉJAÏA', 'béjaia', 'Bejaïa']) assert.deepEqual(await titles(probe), ['Villa élégante à Béjaïa'], probe);
  for (const probe of ['electricite', 'ÉLECTRICITÉ', 'agricole', 'agricolé']) assert.deepEqual(await titles(probe), ['Terrain AGRICOLE'], probe);
  assert.deepEqual(await titles('e' + ch(0x301) + 'le' + ch(0x301) + 'gante'), ['Villa élégante à Béjaïa'], 'saisie avec accents combinants (clavier mobile, copier-coller)');
});

test('annonces : tirets, apostrophes et ponctuation ; ordre des mots libre ; chaque mot doit figurer', async () => {
  await ad("Appartement F3 à Bab-Ezzouar près de l'université", { wilaya: 'Alger', commune: 'Bab Ezzouar' });
  await ad('Villa avec piscine', { wilaya: 'Blida' });
  await ad('Villa sans piscine', { wilaya: 'Blida' });
  for (const probe of ['bab-ezzouar', 'bab ezzouar', 'Bab   Ezzouar', 'ezzouar bab', "l'universite", 'universite', 'BAB_EZZOUAR', 'F3, Bab-Ezzouar!']) assert.deepEqual(await titles(probe), ["Appartement F3 à Bab-Ezzouar près de l'université"], probe);
  assert.deepEqual(await titles('villa piscine'), ['Villa avec piscine', 'Villa sans piscine'], 'les deux mots figurent dans chacune (« sans piscine » contient piscine)');
  assert.deepEqual(await titles('villa avec'), ['Villa avec piscine']);
  assert.deepEqual(await titles('piscine avec villa'), ['Villa avec piscine'], 'ordre libre');
  assert.deepEqual(await titles('villa blida jardin'), [], 'un mot absent : aucun résultat');
  assert.deepEqual(await titles('villa villa VILLA'), await titles('villa'), 'mots répétés : comptés une fois');});

test('annonces : arabe — tachkil, tatwil, hamza, ta marbuta, chiffres indo-arabes', async () => {
  await ad('شقة جميلة للبيع', { type_bien: 'appartement', wilaya: 'Alger' });
  await ad('أرض فلاحية', { type_bien: 'terrain', wilaya: 'Sétif', description: 'قطعة أرض صالحة للزراعة' });
  await ad('F3 مفروش', { type_bien: 'appartement', mode: 'location_courte', wilaya: 'Oran', description: 'كراء يومي' });
  const shadda = ch(0x651), fatha = ch(0x64E);
  for (const probe of ['شقة', 'شقه', 'ش' + fatha + 'ق' + shadda + 'ة', 'جميلة', 'جَميلَة', 'شقة جميلة', 'جميلة شقة']) assert.ok((await titles(probe)).includes('شقة جميلة للبيع'), probe);
  for (const probe of ['أرض', 'ارض', 'إرض', 'آرض', 'فلاحية', 'فلاحيه']) assert.ok((await titles(probe)).includes('أرض فلاحية'), probe);
  assert.deepEqual(await titles('ك' + ch(0x640, 0x640) + 'راء يومي'), ['F3 مفروش'], 'tatwil ignoré');
  assert.ok((await titles('F' + ch(0x663))).includes('F3 مفروش'), 'chiffre indo-arabe : F٣ trouve F3');
  assert.ok((await titles('F' + ch(0x6F3))).includes('F3 مفروش'), 'chiffre persan');
});

test('annonces : français ↔ arabe — wilaya, type de bien et mode se cherchent dans les deux écritures', async () => {
  await q('DELETE FROM properties');
  const alger = await ad('Bel appartement', { type_bien: 'appartement', wilaya: 'Alger', mode: 'vente' });
  await ad('Belle villa', { type_bien: 'villa', wilaya: 'Alger', mode: 'location_longue' });
  await ad('Bureau moderne', { type_bien: 'bureau', wilaya: 'Béjaïa', mode: 'location_courte' });
  await ad('Terrain nu', { type_bien: 'terrain', wilaya: 'Constantine', mode: 'vente' });
  // wilaya en arabe → annonces dont la wilaya est écrite en français
  assert.deepEqual(await titles('الجزائر'), ['Bel appartement', 'Belle villa']);
  assert.deepEqual(await titles('بجاية'), ['Bureau moderne']);
  assert.deepEqual(await titles('قسنطينة'), ['Terrain nu']);
  assert.deepEqual(await titles('Alger'), ['Bel appartement', 'Belle villa']);
  // type de bien en arabe
  assert.deepEqual(await titles('شقة'), ['Bel appartement']);
  assert.deepEqual(await titles('فيلا'), ['Belle villa']);
  assert.deepEqual(await titles('مكتب'), ['Bureau moderne']);
  assert.deepEqual(await titles('أرض'), ['Terrain nu']);
  // mode en arabe
  assert.deepEqual(await titles('للبيع'), ['Bel appartement', 'Terrain nu']);
  assert.deepEqual(await titles('للإيجار'), ['Belle villa'], 'location longue durée');
  assert.deepEqual(await titles('موسمي'), ['Bureau moderne'], 'location saisonnière');
  assert.deepEqual(await titles('كراء'), ['Belle villa', 'Bureau moderne'], 'كراء : les deux locations');
  // combinaisons : chaque mot dans son écriture
  assert.deepEqual(await titles('شقة الجزائر'), ['Bel appartement']);
  assert.deepEqual(await titles('شقة alger للبيع'), ['Bel appartement']);
  assert.deepEqual(await titles('villa الجزائر'), ['Belle villa']);
  assert.deepEqual(await titles('شقة بجاية'), [], 'appartement à Béjaïa : aucun');
  // le texte indexé contient bien le nom arabe normalisé de la wilaya
  const text = (await q('SELECT text FROM property_search WHERE property_id = $1', [alger])).rows[0].text;
  assert.ok(text.includes(search.normalize('الجزائر')) && text.includes('alger') && text.includes(search.normalize('شقة')));
});

test('annonces : « % » et « _ » saisis restent cherchés tels quels ; requêtes vides ou non textuelles ignorées ; entrées hostiles inoffensives', async () => {
  await q('DELETE FROM properties');
  await ad('Remise 100% garantie');
  await ad('Villa_neuve');
  await ad('Villa ancienne');
  const all = (await s.request('GET', '/api/properties?limit=100')).body.total;
  assert.equal(all, 3);
  assert.deepEqual(await titles('%'), ['Remise 100% garantie'], '« % » seul : recherche brute, plus de correspondance universelle');
  assert.deepEqual(await titles('_'), ['Villa_neuve']);
  assert.deepEqual(await titles('100%'), ['Remise 100% garantie']);
  for (const empty of ['', '   ', ',;']) assert.equal((await s.request('GET', `/api/properties?q=${encodeURIComponent(empty)}`)).body.total, empty === ',;' ? 0 : 3, JSON.stringify(empty));
  for (const nonText of ['q[]=villa', 'q[a]=villa', 'q[]=villa&q[]=neuve']) assert.equal((await s.request('GET', `/api/properties?${nonText}`)).body.total, 3, nonText + ' : ignoré');
  for (const hostile of ["'; DROP TABLE properties; --", '" OR 1=1 --', "villa' OR 'a'='a", '\\', '%00', 'a'.repeat(5000), '${x}', '<script>1</script>']) {
    const r = await s.request('GET', `/api/properties?q=${encodeURIComponent(hostile)}`);
    assert.equal(r.status, 200, hostile.slice(0, 30));
  }
  assert.equal((await s.request('GET', '/api/properties')).body.total, 3, 'table intacte');
});

test('annonces : 8 mots au plus comptés ; se combine avec les autres filtres et la pagination', async () => {
  await q('DELETE FROM properties');
  for (let i = 0; i < 25; i++) await ad(`Appartement lumineux numéro ${i}`, { type_bien: 'appartement', wilaya: i % 2 ? 'Alger' : 'Oran', mode: i < 10 ? 'vente' : 'location_longue' });
  const page1 = (await s.request('GET', '/api/properties?q=' + encodeURIComponent('Lumineux appartement') + '&limit=10&page=1')).body;
  assert.deepEqual([page1.total, page1.data.length, page1.pages], [25, 10, 3]);
  const alger = (await s.request('GET', '/api/properties?limit=100&wilaya=Alger&q=lumineux')).body;
  assert.equal(alger.total, 12);
  assert.ok(alger.data.every(p => p.wilaya === 'Alger'));
  assert.equal((await s.request('GET', '/api/properties?limit=100&mode=vente&q=' + encodeURIComponent('الجزائر'))).body.total, 5, 'filtre mode + wilaya cherchée en arabe');
  // Plafond de 8 mots : le neuvième n'est pas exigé, les huit premiers le sont
  await ad('w1 w2 w3 w4 w5 w6 w7 w8 w9', { type_bien: 'maison', wilaya: 'Tizi Ouzou' });
  const words = n => Array.from({ length: n }, (_, i) => 'w' + (i + 1));
  assert.deepEqual(await titles(words(8).join(' ') + ' zzzabsent'), ['w1 w2 w3 w4 w5 w6 w7 w8 w9'], 'le 9e mot (absent) est ignoré');
  assert.deepEqual(await titles(words(9).join(' ')), ['w1 w2 w3 w4 w5 w6 w7 w8 w9']);
  assert.deepEqual(await titles('zzzabsent ' + words(7).join(' ')), [], 'un mot absent parmi les 8 premiers : aucun résultat');
  // Mots répétés : comptés une fois (donc 3 mots distincts ici, pas 9)
  assert.equal((await s.request('GET', '/api/properties?limit=100&q=' + encodeURIComponent('appartement lumineux numéro appartement lumineux numéro appartement lumineux numéro'))).body.total, 25);
});

// ── Déclencheurs ────────────────────────────────────────────────────────────────────────────────────────────────────
test('déclencheurs : le texte suit chaque création, modification et suppression, quelle que soit l\'origine (SQL, API)', async () => {
  await q('DELETE FROM properties');
  const id = await ad('Ancien titre unique', { commune: 'Kouba' });
  assert.deepEqual(await titles('unique kouba'), ['Ancien titre unique']);
  await q(`UPDATE properties SET title = 'Nouveau titre rénové' WHERE id = $1`, [id]);
  assert.deepEqual(await titles('unique'), [], 'l\'ancien mot ne trouve plus rien');
  assert.deepEqual(await titles('renove'), ['Nouveau titre rénové']);
  await q(`UPDATE properties SET commune = 'Hydra' WHERE id = $1`, [id]);
  assert.deepEqual(await titles('hydra'), ['Nouveau titre rénové']);
  assert.deepEqual(await titles('kouba'), []);
  await q(`UPDATE properties SET wilaya = 'Tipaza', type_bien = 'terrain', mode = 'location_courte' WHERE id = $1`, [id]);
  assert.deepEqual(await titles('تيبازة'), ['Nouveau titre rénové'], 'wilaya changée : nom arabe suivi');
  assert.deepEqual(await titles('أرض موسمي'), ['Nouveau titre rénové']);
  // une modification sans rapport (prix, vues) ne casse rien ; par l'API : même chose
  await q('UPDATE properties SET price = 5, views = 9 WHERE id = $1', [id]);
  assert.deepEqual(await titles('hydra'), ['Nouveau titre rénové']);
  const put = await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { title: 'Titre via API élégant', description: 'Vue sur mer' } });
  assert.equal(put.status, 200);
  await q("UPDATE properties SET status = 'active' WHERE id = $1", [id]);   // modifiée par son propriétaire : repassée en modération, on la remet en ligne
  assert.deepEqual(await titles('elegant mer'), ['Titre via API élégant']);
  const created = await s.request('POST', '/api/properties', { token: owner.token, body: { title: 'Créée par API à Béjaïa', mode: 'vente', type_bien: 'villa', price: 1, wilaya: 'Béjaïa' } });
  assert.equal(created.status, 201);
  assert.equal((await q('SELECT COUNT(*)::int c FROM property_search WHERE property_id = $1', [created.body.id])).rows[0].c, 1);
  // suppression : la ligne de recherche disparaît avec l'annonce
  await q('DELETE FROM properties WHERE id = $1', [id]);
  assert.equal((await q('SELECT COUNT(*)::int c FROM property_search WHERE property_id = $1', [id])).rows[0].c, 0);
  // colonnes vides : pas d'erreur
  await q(`INSERT INTO properties (owner_id, title, description, mode, type_bien, price, wilaya, status, published_at) VALUES ($1, 'Sans détails', NULL, 'vente', 'villa', 1, 'Oran', 'active', NOW())`, [owner.id]);
  assert.deepEqual(await titles('details'), ['Sans détails']);
});

test('les réponses de l\'API n\'exposent pas le texte de recherche (tables à part)', async () => {
  const id = await ad('Vérification des réponses');
  const list = (await s.request('GET', '/api/properties?limit=5')).body.data[0];
  const one = (await s.request('GET', `/api/properties/${id}`)).body;
  for (const row of [list, one]) for (const k of Object.keys(row)) assert.ok(!/search|text$/.test(k), `champ inattendu : ${k}`);
});

// ── Performance ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('performance : 5 000 annonces, recherche à plusieurs mots en moins de 2 secondes', async () => {
  await q('DELETE FROM properties');
  await q(`INSERT INTO properties (owner_id, title, description, mode, type_bien, price, wilaya, commune, status, published_at)
           SELECT $1, 'Appartement F' || (g % 5 + 1) || ' à ' || (ARRAY['Hydra','Kouba','Bab Ezzouar','Cheraga','Dely Ibrahim'])[g % 5 + 1] || ' n°' || g,
                  'Bel appartement lumineux, cuisine équipée, proche des commerces et du tramway. Référence ' || g, 'vente', 'appartement', 1000000 + g, 'Alger', 'Alger', 'active', NOW()
             FROM generate_series(1, 5000) g`, [owner.id]);
  assert.equal((await q('SELECT COUNT(*)::int c FROM property_search')).rows[0].c, 5000);
  // Meilleure de trois mesures : les fichiers de test tournent en parallèle, une seule mesure dépendrait de la charge de la machine
  let r, ms = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    r = await s.request('GET', '/api/properties?limit=12&q=' + encodeURIComponent('appartement lumineux hydra الجزائر'));
    ms = Math.min(ms, Date.now() - t0);
  }
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 1000);
  assert.ok(ms < 2000, `recherche : ${ms} ms`);
  await q('DELETE FROM properties');
});

// ── Lexique ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('lexique : synchronisé au démarrage, sans effet s\'il est à jour, recalcule les textes s\'il a changé, sûr en concurrence', async () => {
  const size = async () => (await q('SELECT COUNT(*)::int c FROM search_lexicon')).rows[0].c;
  assert.equal(await size(), search.LEXICON.length, 'rempli au démarrage');
  assert.equal(await search.sync(s.db.pool), false, 'à jour : rien à faire');
  // Un terme modifié à la main est ramené à la référence, et les textes sont recalculés
  const id = await ad('Test lexique', { wilaya: 'Alger', type_bien: 'appartement' });
  await q(`UPDATE search_lexicon SET terms = 'zzz' WHERE kind = 'wilaya' AND key = 'Alger'`);
  await q('SELECT dz_reindex_search()');
  assert.deepEqual(await titles('الجزائر'), [], 'lexique altéré : le nom arabe n\'est plus indexé');
  assert.equal(await search.sync(s.db.pool), true);
  assert.deepEqual(await titles('الجزائر'), ['Test lexique'], 'lexique restauré, textes recalculés');
  // Lexique vidé : trois démarrages simultanés (pm2 cluster) n'entrent pas en conflit ; un seul met à jour
  await q('DELETE FROM search_lexicon');
  const results = await Promise.all([search.sync(s.db.pool), search.sync(s.db.pool), search.sync(s.db.pool)]);
  assert.deepEqual(results.filter(Boolean).length, 1, 'une seule des trois synchronisations a travaillé');
  assert.equal(await size(), search.LEXICON.length);
  assert.deepEqual(await titles('شقة قسنطينة'), [], 'et les textes sont corrects');
  assert.deepEqual(await titles('شقة الجزائر'), ['Test lexique']);
  await q('DELETE FROM properties WHERE id = $1', [id]);
});

// ── Agences et programmes ───────────────────────────────────────────────────────────────────────────────────────────
test('agences : accents, arabe, wilaya en arabe, type de professionnel', async () => {
  const mk = async (name, over = {}) => (await q(
    `INSERT INTO agencies (owner_id, name, kind, wilaya, commune, tagline, description) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [(await s.register('ag' + ++n)).id, name, over.kind || 'agence', over.wilaya || 'Alger', over.commune || null, over.tagline || null, over.description || null])).rows[0].id;
  await mk('Agence Générale Immobilière', { commune: 'Hydra', tagline: 'Spécialiste des résidences de standing' });
  await mk('Les Bâtisseurs de la Mitidja', { kind: 'promoteur', wilaya: 'Blida', tagline: 'Résidences neuves' });
  await mk('وكالة النور العقارية', { wilaya: 'Oran' });
  const names = async qs => (await s.request('GET', `/api/agencies?per_page=100&q=${encodeURIComponent(qs)}`)).body.items.map(a => a.name).sort();
  assert.deepEqual(await names('generale'), ['Agence Générale Immobilière']);
  assert.deepEqual(await names('BATISSEURS mitidja'), ['Les Bâtisseurs de la Mitidja']);
  assert.deepEqual(await names('residences standing'), ['Agence Générale Immobilière']);
  assert.deepEqual(await names('hydra'), ['Agence Générale Immobilière']);
  assert.deepEqual(await names('النور'), ['وكالة النور العقارية']);
  assert.deepEqual(await names('العقاريه'), ['وكالة النور العقارية'], 'ta marbuta');
  assert.deepEqual(await names('البليدة'), ['Les Bâtisseurs de la Mitidja'], 'wilaya en arabe');
  assert.deepEqual(await names('وهران'), ['وكالة النور العقارية']);
  assert.deepEqual(await names('مروج'), ['Les Bâtisseurs de la Mitidja'], 'type de professionnel en arabe');
  assert.deepEqual(await names('promoteur'), ['Les Bâtisseurs de la Mitidja']);
  assert.deepEqual(await names('%'), [], '« % » seul : recherche brute, sans correspondance universelle');
  assert.equal((await names('')).length, 3, 'requête vide : tout');
  // Changement de nom : suivi par le déclencheur
  await q(`UPDATE agencies SET name = 'Nouvelle Étoile' WHERE name = 'Agence Générale Immobilière'`);
  assert.deepEqual(await names('etoile'), ['Nouvelle Étoile']);
  assert.deepEqual(await names('generale'), []);
});

test('programmes : accents, arabe, wilaya en arabe', async () => {
  const uid = (await s.register('prog' + ++n)).id;
  const agency = (await q(`INSERT INTO agencies (owner_id, name, kind, wilaya, verified) VALUES ($1, 'Promoteur Test', 'promoteur', 'Alger', true) RETURNING id`, [uid])).rows[0].id;
  const mk = (name, wilaya, commune, description) => q(
    `INSERT INTO projects (agency_id, name, wilaya, commune, description) VALUES ($1, $2, $3, $4, $5)`, [agency, name, wilaya, commune, description]);
  await mk('Résidence Les Jasmins', 'Blida', 'Boufarik', 'Logements de standing');
  await mk('Cité El Amel', 'Alger', 'Rouiba', null);
  await mk('إقامة الياسمين', 'Oran', null, null);
  const names = async qs => (await s.request('GET', `/api/projects?per_page=100&q=${encodeURIComponent(qs)}`)).body.items.map(p => p.name).sort();
  assert.deepEqual(await names('residence jasmins'), ['Résidence Les Jasmins']);
  assert.deepEqual(await names('BOUFARIK'), ['Résidence Les Jasmins']);
  assert.deepEqual(await names('standing'), ['Résidence Les Jasmins']);
  assert.deepEqual(await names('البليدة'), ['Résidence Les Jasmins'], 'wilaya en arabe');
  assert.deepEqual(await names('الجزائر'), ['Cité El Amel']);
  assert.deepEqual(await names('الياسمين'), ['إقامة الياسمين']);
  assert.deepEqual(await names('اقامة'), ['إقامة الياسمين'], 'hamza ignorée');
  assert.deepEqual(await names('cite amel'), ['Cité El Amel']);
  assert.deepEqual(await names('مشروع'), ['Cité El Amel', 'Résidence Les Jasmins', 'إقامة الياسمين'], 'mot arabe « programme »');
});
