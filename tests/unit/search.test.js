// Recherche tolérante (server/search.js) : normalisation, mots de la requête, condition SQL, lexique. Aucune base nécessaire.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const search = require('../../server/search');
const WILAYAS = require('../../server/wilayas');
const WILAYAS_AR = require('../../server/wilayas-ar');

const { normalize, tokens, condition } = search;
const ch = (...codes) => String.fromCharCode(...codes);   // caractères construits par leur code : aucune séquence d'échappement dans ce fichier

test('normalize : accents, casse, ponctuation (français)', () => {
  const cases = [
    ['Élégant', 'elegant'], ['ÉLÉGANT', 'elegant'], ['élégant', 'elegant'], ['Béjaïa', 'bejaia'], ['BÉJAÏA', 'bejaia'], ['Bâtisseurs', 'batisseurs'],
    ['Crêperie Noël', 'creperie noel'], ['  Bab-Ezzouar  ', 'bab ezzouar'], ["l'ancien", 'l ancien'], ['Hydra, Alger.', 'hydra alger'],
    ['F3/F4 (90m²)', 'f3 f4 90m'], ['100% garanti', '100 garanti'], ['Œuvre', 'oeuvre'], ['Æsop', 'aesop'], ['Straße', 'strasse'], ['Ørsted', 'orsted'],
    ['Łódź', 'lodz'], ['Đà Nẵng', 'da nang'], ['Ñandú', 'nandu'], ['Çà et là', 'ca et la'], ['ÀÉÎÖÛ', 'aeiou'], ['%', ''], ['', ''], ['   ', ''],
  ];
  for (const [input, want] of cases) assert.equal(normalize(input), want, JSON.stringify(input));
  assert.equal(normalize(null), ''); assert.equal(normalize(undefined), ''); assert.equal(normalize(42), '42');
});

test('normalize : formes décomposées (lettre + accent combinant) = formes composées', () => {
  assert.equal(normalize('e' + ch(0x301) + 'te' + ch(0x301)), 'ete');
  assert.equal(normalize('E' + ch(0x301) + 'GYPTE'), 'egypte');
  assert.equal(normalize('a' + ch(0x300) + ' la carte'), 'a la carte');
  assert.equal(normalize('Be' + ch(0x301) + 'ja' + ch(0x308) + 'ia'), 'bejaia');
});

test('normalize : arabe — tachkil, tatwil, alif à hamza, alif maqsura, ta marbuta, chiffres', () => {
  const chaddaFatha = ch(0x64E, 0x651);
  assert.equal(normalize('ش' + chaddaFatha + 'ق' + chaddaFatha + 'ة'), normalize('شقة'), 'voyelles brèves et chadda ignorées');
  assert.equal(normalize('شقة'), 'شقه', 'ta marbuta = ha');
  assert.equal(normalize('ك' + ch(0x640, 0x640) + 'راء'), 'كراء', 'tatwil retiré');
  assert.equal(normalize('أحمد إبراهيم آمنة ٱلله'), 'احمد ابراهيم امنه الله', 'alif à hamza, madda et wasla → alif');
  assert.equal(normalize('مدرسى'), 'مدرسي', 'alif maqsura = ya');
  assert.equal(normalize('مؤسسة ئ'), 'موسسه ي', 'hamza sur waw et sur ya');
  assert.equal(normalize('الجزائر ٣ غرف'), 'الجزاير 3 غرف');
  assert.equal(normalize('٠١٢٣٤٥٦٧٨٩'), '0123456789', 'chiffres indo-arabes');
  assert.equal(normalize('۰۱۲۳۴۵۶۷۸۹'), '0123456789', 'chiffres persans');
  assert.equal(normalize('F٣'), 'f3');
  assert.equal(normalize('کیف'), 'كيف', 'variantes persanes du clavier');
  assert.equal(normalize('شقة، جميلة! (٢ غرف)'), 'شقه جميله 2 غرف', 'ponctuation arabe et latine');
  assert.equal(normalize('Alger الجزائر'), 'alger الجزاير', 'écritures mélangées : chacune normalisée');
});

test('normalize : idempotent, jamais de séparateur au bord, jamais de double espace', () => {
  const corpus = ['Élégante villa à Béjaïa !', '  شَقَّة   جميلة  ', 'F٣  --  Bab-Ezzouar', "l'entrée", 'ÀÉÎ ÔÛ — 100% (ok)', '', '%%%', 'x'.repeat(50), 'شقة' + ch(0x64B) + '?'];
  for (const s of corpus) {
    const n = normalize(s);
    assert.equal(normalize(n), n, JSON.stringify(s));
    assert.doesNotMatch(n, /^ | $|  /, JSON.stringify(n));
    assert.match(n, /^[a-z0-9 ء-ي]*$/, 'seulement des lettres latines, chiffres et lettres arabes');
  }
});

test('tokens : sans doublon, 8 mots au plus de 40 caractères au plus, [] si la requête n\'est pas un texte', () => {
  assert.deepEqual(tokens('Villa  villa VILLA piscine, Alger !!'), ['villa', 'piscine', 'alger']);
  assert.deepEqual(tokens('شَقَّة جميلة'), ['شقه', 'جميله']);
  assert.equal(tokens('a b c d e f g h i j k l').length, 8);
  assert.equal(tokens('x'.repeat(500))[0].length, 40);
  assert.ok(tokens('mot '.repeat(1000)).length <= 8, 'requête très longue : plafonnée');
  for (const nonText of [undefined, null, 42, true, {}, ['a'], ['a', 'b'], () => 1]) assert.deepEqual(tokens(nonText), []);
  assert.deepEqual(tokens(''), []); assert.deepEqual(tokens('  ,;  '), []); assert.deepEqual(tokens('%'), []);
});

test('condition : un LIKE par mot (ET), valeurs en paramètres et jamais dans le SQL ; repli brut pour une requête sans mot cherchable', () => {
  const params = [];
  const arg = v => { params.push(v); return '$' + params.length; };
  const sql = condition("Élégante villa'; DROP TABLE x; --", 's.text', ['p.title'], arg);
  assert.equal(sql, 's.text LIKE $1 AND s.text LIKE $2 AND s.text LIKE $3 AND s.text LIKE $4 AND s.text LIKE $5');
  assert.deepEqual(params, ['%elegante%', '%villa%', '%drop%', '%table%', '%x%']);
  assert.doesNotMatch(sql, /DROP|elegante|'/i, 'aucune donnée de la requête dans le texte SQL');
  assert.ok(params.every(p => /^%[a-z0-9ء-ي]+%$/.test(p)), 'paramètres : mots normalisés entourés de %, sans joker à neutraliser');
  // Repli : « % » seul n'a pas de mot cherchable : recherche brute avec joker neutralisé (comme avant)
  const p2 = [];
  const raw = condition('%', 's.text', ['p.title', 'p.commune'], v => { p2.push(v); return '$' + p2.length; });
  assert.equal(raw, '(p.title ILIKE $1 OR p.commune ILIKE $1)');
  assert.deepEqual(p2, ['%' + ch(92) + '%%']);
  for (const none of [undefined, null, '', '   ', 42, ['a']]) assert.equal(condition(none, 's.text', ['p.title'], () => '$1'), null, JSON.stringify(none));
});

test('lexique : toutes les wilayas (nom arabe identique à wilayas-ar.js), tous les types et modes', () => {
  const byKind = k => search.LEXICON.filter(r => r.kind === k);
  assert.deepEqual(byKind('wilaya').map(r => r.key).sort(), Object.keys(WILAYAS_AR).sort());
  assert.deepEqual(Object.keys(WILAYAS_AR).sort(), [...WILAYAS].sort(), 'chaque wilaya du référentiel a son nom arabe');
  for (const r of byKind('wilaya')) assert.equal(r.terms, WILAYAS_AR[r.key]);
  assert.deepEqual(byKind('type').map(r => r.key).sort(), ['appartement', 'bureau', 'entrepot', 'ferme', 'local_commercial', 'maison', 'terrain', 'villa']);
  assert.deepEqual(byKind('mode').map(r => r.key).sort(), ['location_courte', 'location_longue', 'vente']);
  assert.deepEqual(byKind('kind').map(r => r.key).sort(), ['agence', 'promoteur']);
  const keys = search.LEXICON.map(r => r.kind + '|' + r.key);
  assert.equal(new Set(keys).size, keys.length, 'pas de doublon');
  for (const r of search.LEXICON) assert.ok(r.terms.trim(), `${r.kind}/${r.key} : termes vides`);
  for (const r of byKind('type')) assert.ok(tokens(r.terms).length >= 2, `${r.key} : au moins un mot français et un mot arabe`);
});

test('sources : aucune séquence d\'échappement transformée en caractère de contrôle ou en marque combinante invisible', () => {
  const control = new RegExp('[' + ch(0) + '-' + ch(8) + ch(11) + ch(12) + ch(14) + '-' + ch(31) + ch(127) + ']');
  const combining = new RegExp('[' + ch(0x300) + '-' + ch(0x36F) + ']');
  for (const f of ['server/search.js', 'server/migrations/012_search.sql', 'tests/unit/search.test.js', 'tests/api/search.test.js']) {
    const file = path.join(__dirname, '..', '..', f);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, control, f + ' : caractère de contrôle');
    // Les sources du serveur écrivent les marques combinantes par échappement visible, jamais en clair
    if (f.startsWith('server/')) assert.doesNotMatch(text, combining, f + ' : marque combinante littérale (utiliser une séquence d\'échappement)');
  }
});
