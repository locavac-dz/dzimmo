// Conseils à l'annonceur (server/advice.js) : règles, priorités, plafond, seuils.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { advise, CODES, MAX_ADVICE, MIN_PHOTOS } = require('../../server/advice');

const NOW = Date.parse('2026-09-21T12:00:00Z');
const zeros = () => Array(30).fill(0);
const series = (over = {}) => ({ views: zeros(), favorites: zeros(), clicks: zeros(), ...over });
// Annonce complète, publiée depuis 20 jours
const good = (over = {}) => ({
  status: 'active', type_bien: 'appartement', description: 'x'.repeat(200), photos: ['a', 'b', 'c', 'd', 'e'], image: 'a',
  lat: 36.7, lng: 3.05, video_url: 'https://vimeo.com/123456789', tour_url: null, features: ['parking'], floor: 2,
  published_at: new Date(NOW - 20 * 86400000).toISOString(), ...over,
});
const codes = list => list.map(a => a.code);
const run = (o = {}) => advise({ property: good(), phone: '0550123456', series: series({ views: Array(30).fill(2), favorites: [...Array(29).fill(0), 1] }), now: NOW, ...o });

test('annonce complète avec des visites : un seul message d\'encouragement', () => {
  const r = run();
  assert.deepEqual(r, [{ code: 'all_good', level: 'good', params: {} }]);
});

test('annonce complète mais sans aucune vue : aucun conseil (rien à encourager, rien à reprocher)', () => {
  assert.deepEqual(run({ series: series() , property: good({ published_at: new Date(NOW - 2 * 86400000).toISOString() }) }), []);
});

test('seules les annonces publiées reçoivent des conseils', () => {
  for (const status of ['pending', 'rejected', 'archived', 'sold', 'rented'])
    assert.deepEqual(run({ property: good({ status, photos: [] }) }), [], status);
  assert.deepEqual(advise({ property: null, series: series(), now: NOW }), []);
});

test('photos : urgent sous 3, simple conseil de 3 à 4, rien à partir de 5 ; l\'image seule compte pour une', () => {
  let r = run({ property: good({ photos: ['a', 'b'] }) }).find(a => a.code === 'few_photos');
  assert.deepEqual(r, { code: 'few_photos', level: 'warn', params: { n: 2, min: MIN_PHOTOS } });
  r = run({ property: good({ photos: ['a', 'b', 'c', 'd'] }) }).find(a => a.code === 'few_photos');
  assert.equal(r.level, 'tip');
  assert.equal(run({ property: good({ photos: [] }) }).find(a => a.code === 'few_photos').params.n, 1, 'image de couverture');
  assert.equal(run({ property: good({ photos: [], image: null }) }).find(a => a.code === 'few_photos').params.n, 0);
  assert.ok(!codes(run()).includes('few_photos'));
});

test('description, position, média, équipements et téléphone', () => {
  assert.ok(codes(run({ property: good({ description: 'court' }) })).includes('short_description'));
  assert.ok(codes(run({ property: good({ description: null }) })).includes('short_description'));
  assert.ok(codes(run({ property: good({ lat: null, lng: null }) })).includes('no_location'));
  assert.ok(!codes(run({ property: good({ lat: 0, lng: 0 }) })).includes('no_location'), '0 est une coordonnée valide');
  assert.ok(codes(run({ property: good({ video_url: null, tour_url: null }) })).includes('no_media'));
  assert.ok(!codes(run({ property: good({ video_url: null, tour_url: 'https://kuula.co/share/7Tk4N' }) })).includes('no_media'));
  assert.ok(codes(run({ property: good({ features: [] }) })).includes('no_features'));
  assert.ok(!codes(run({ property: good({ features: [], type_bien: 'terrain' }) })).includes('no_features'), 'un terrain n\'a pas d\'équipements');
  for (const phone of [null, undefined, '', '   ']) assert.ok(codes(run({ phone })).includes('no_phone'), String(phone));
});

test('étage : conseil uniquement pour appartement et bureau, jamais si 0 (rez-de-chaussée)', () => {
  assert.ok(codes(run({ property: good({ floor: null }) })).includes('no_floor'), 'appartement sans étage');
  assert.ok(codes(run({ property: good({ floor: undefined }) })).includes('no_floor'), 'appartement floor undefined');
  assert.ok(!codes(run({ property: good({ floor: 0 }) })).includes('no_floor'), '0 est le rez-de-chaussée');
  assert.ok(!codes(run({ property: good({ floor: 3 }) })).includes('no_floor'), 'étage renseigné');
  assert.ok(codes(run({ property: good({ type_bien: 'bureau', floor: null }) })).includes('no_floor'), 'bureau sans étage');
  for (const t of ['villa', 'maison', 'terrain', 'local_commercial', 'ferme', 'entrepot'])
    assert.ok(!codes(run({ property: good({ type_bien: t, floor: null }) })).includes('no_floor'), `${t} pas d'étage attendu`);
});

test('prix : seul le signal « prix élevé » est rapporté, en pourcentage au-dessus de la médiane', () => {
  const r = run({ quality: { flags: ['price_high'], ratio: 1.62 } }).find(a => a.code === 'price_high');
  assert.deepEqual(r, { code: 'price_high', level: 'warn', params: { pct: 62 } });
  assert.ok(!codes(run({ quality: { flags: ['price_low'], ratio: 0.4 } })).includes('price_high'));
  assert.ok(!codes(run({ quality: { flags: ['duplicate_own'] } })).includes('price_high'));
  assert.ok(!codes(run({ quality: null })).includes('price_high'));
});

test('visibilité : peu de vues après une semaine, mais pas sur une annonce toute neuve', () => {
  const few = series({ views: [...Array(23).fill(0), 1, 0, 0, 1, 0, 0, 1] });
  assert.deepEqual(run({ series: few }).find(a => a.code === 'low_visibility'), { code: 'low_visibility', level: 'tip', params: { n: 3 } });
  const fresh = good({ published_at: new Date(NOW - 2 * 86400000).toISOString() });
  assert.ok(!codes(run({ series: few, property: fresh })).includes('low_visibility'));
});

test('baisse des vues : moins de la moitié de la semaine précédente (et pas de « peu de vues » en double)', () => {
  const v = [...Array(16).fill(0), ...Array(7).fill(4), ...Array(7).fill(1)];   // 28 puis 7 vues
  const r = run({ series: series({ views: v }) });
  assert.deepEqual(r.find(a => a.code === 'views_drop'), { code: 'views_drop', level: 'warn', params: { pct: 75 } });
  assert.ok(!codes(r).includes('low_visibility'));
  // semaine précédente trop faible pour parler de baisse
  const small = [...Array(16).fill(0), ...Array(7).fill(1), ...Array(7).fill(0)];
  assert.ok(!codes(run({ series: series({ views: small }) })).includes('views_drop'));
  // baisse modérée
  const mild = [...Array(16).fill(0), ...Array(7).fill(4), ...Array(7).fill(3)];
  assert.ok(!codes(run({ series: series({ views: mild }) })).includes('views_drop'));
});

test('beaucoup de vues sans réaction : conseil, sauf si un favori, un clic ou une demande existe', () => {
  const views = Array(30).fill(2);   // 60 vues
  const none = run({ series: series({ views }) });
  assert.deepEqual(none.find(a => a.code === 'no_engagement'), { code: 'no_engagement', level: 'warn', params: { views: 60 } });
  assert.ok(!codes(none).includes('all_good'));
  for (const over of [{ favorites: [1, ...Array(29).fill(0)] }, { clicks: [...Array(29).fill(0), 1] }])
    assert.ok(!codes(run({ series: series({ views, ...over }) })).includes('no_engagement'), JSON.stringify(over));
  assert.ok(!codes(run({ series: series({ views }), contacts30: 1 })).includes('no_engagement'), 'une demande de contact suffit');
  // trop peu de vues pour conclure
  assert.ok(!codes(run({ series: series({ views: Array(30).fill(1).map((v, i) => i < 10 ? v : 0) }) })).includes('no_engagement'));
});

test("au plus 4 conseils, dans l'ordre de priorité ; tous les codes produits sont connus", () => {
  const r = advise({
    property: good({ photos: [], image: null, description: '', lat: null, lng: null, video_url: null, features: [] }),
    phone: '', series: series({ views: Array(30).fill(2) }), quality: { flags: ['price_high'], ratio: 2 }, now: NOW,
  });
  assert.equal(r.length, MAX_ADVICE);
  assert.deepEqual(codes(r), ['price_high', 'few_photos', 'no_phone', 'no_engagement']);
  for (const a of r) assert.ok(CODES.includes(a.code));
  // sans limite, tous les autres seraient là : l'ordre de CODES est celui de la priorité
  assert.deepEqual(CODES.filter(c => c !== 'all_good').slice(0, 4), codes(r));
});

test("les paramètres sont des nombres (jamais du texte venu de l'annonce)", () => {
  const r = advise({
    property: good({ photos: [], description: '<img src=x onerror=alert(1)>', lat: null }), phone: '', series: series({ views: Array(30).fill(2) }),
    quality: { flags: ['price_high'], ratio: 1.5 }, now: NOW,
  });
  for (const a of advise({ property: good({ description: '<b>', lat: null, video_url: null, features: [] }), phone: '0550', series: series({ views: Array(30).fill(2), favorites: [1, ...Array(29).fill(0)] }), now: NOW }).concat(r))
    for (const v of Object.values(a.params)) assert.equal(typeof v, 'number');
});
