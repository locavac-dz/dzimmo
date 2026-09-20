// Clics « Appeler » / « WhatsApp » : compteurs anonymes par annonce, jour et canal, dédoublonnés par visiteur, visibles de l'annonceur seul.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const { AR } = require('../../server/i18n');

let s, clicks, owner, other;
const q = (sql, p) => s.db.pool.query(sql, p);
const total = async (id, channel) => (await q(`SELECT COALESCE(SUM(n), 0)::int n FROM contact_clicks WHERE property_id = $1 AND channel = $2`, [id, channel])).rows[0].n;
const click = (id, body, opts = {}) => s.request('POST', `/api/properties/${id}/click`, { body, ...opts });
const forget = () => q("DELETE FROM rate_limits WHERE key LIKE 'clic:%'");   // oublie les visiteurs déjà comptés (souvenir partagé, table rate_limits)
let n = 0;
async function listing(o, status = 'active') {
  return (await q(`INSERT INTO properties (owner_id, title, description, mode, type_bien, price, wilaya, status, published_at)
                   VALUES ($1, $2, 'D', 'vente', 'villa', 1, 'Oran', $3, NOW()) RETURNING id`, [o.id, `Bien ${++n}`, status])).rows[0].id;
}

test.before(async () => {
  s = await startServer();
  clicks = require('../../server/clicks');            // après startServer : ce module ouvre la connexion à la base
  [owner, other] = [await s.register('clic-proprio'), await s.register('clic-autre')];
});
test.after(async () => { await s.stop(); });
test.beforeEach(forget);

test('un clic sur une annonce active est compté, anonymement, sans connexion ; réponse 204', async () => {
  const id = await listing(owner);
  const r = await click(id, { channel: 'call' });
  assert.equal(r.status, 204);
  assert.equal(r.text, '');
  assert.equal(await total(id, 'call'), 1);
  assert.equal(await total(id, 'whatsapp'), 0);
  assert.equal((await click(id, { channel: 'whatsapp' })).status, 204);
  assert.equal(await total(id, 'whatsapp'), 1, 'chaque canal a son compteur');
});

test('un même visiteur ne compte qu\'une fois par annonce et par canal ; un autre canal, une autre annonce ou un autre visiteur comptent', async () => {
  const [a, b] = [await listing(owner), await listing(owner)];
  for (let i = 0; i < 10; i++) assert.equal((await click(a, { channel: 'call' })).status, 204);
  assert.equal(await total(a, 'call'), 1, 'dix clics du même visiteur = un');
  await click(a, { channel: 'whatsapp' });
  await click(b, { channel: 'call' });
  assert.deepEqual([await total(a, 'call'), await total(a, 'whatsapp'), await total(b, 'call')], [1, 1, 1]);
  // Visiteur différent (autre adresse) : compté
  assert.equal(await clicks.firstRecently('203.0.113.7', a, 'call'), true);
  await clicks.record(a, 'call');
  assert.equal(await total(a, 'call'), 2);
});

test('dédoublonnage partagé entre les workers : de nouveau compté après 10 minutes ; aucune adresse IP en base ; purge', async () => {
  const rateStore = require('../../server/rate-store');
  assert.equal(await clicks.firstRecently('1.1.1.1', 1, 'call'), true);
  assert.equal(await clicks.firstRecently('1.1.1.1', 1, 'call'), false);
  // Vingt clics simultanés (autant de workers) : un seul est « le premier »
  const burst = await Promise.all(Array.from({ length: 20 }, () => clicks.firstRecently('2.2.2.2', 1, 'call')));
  assert.equal(burst.filter(Boolean).length, 1);
  const rows = (await q("SELECT key FROM rate_limits WHERE key LIKE 'clic:%'")).rows;
  assert.equal(rows.length, 2);
  for (const r of rows) assert.doesNotMatch(r.key, /1\.1\.1\.1|2\.2\.2\.2/, 'la clé est un HMAC, pas l\'adresse');
  // Fenêtre écoulée : le visiteur compte de nouveau, et la purge retire les fenêtres terminées
  await q("UPDATE rate_limits SET reset_at = now() - interval '1 second' WHERE key = $1", [rateStore.hashKey('clic', '1.1.1.1|1|call')]);
  assert.equal(await clicks.firstRecently('1.1.1.1', 1, 'call'), true, 'après 10 minutes');
  await q("UPDATE rate_limits SET reset_at = now() - interval '1 second' WHERE key = $1", [rateStore.hashKey('clic', '2.2.2.2|1|call')]);
  assert.equal(await rateStore.purge(), 1);
  assert.equal((await q("SELECT 1 FROM rate_limits WHERE key LIKE 'clic:%'")).rowCount, 1);
});

test('rien n\'est compté pour sa propre annonce, ni pour une annonce non publique ou inconnue ; la réponse ne le révèle pas', async () => {
  const [mine, pending, sold, archived, rejected] = [await listing(owner), await listing(owner, 'pending'), await listing(owner, 'sold'), await listing(owner, 'archived'), await listing(owner, 'rejected')];
  // Le propriétaire connecté clique sur sa propre annonce
  assert.equal((await click(mine, { channel: 'call' }, { token: owner.token })).status, 204);
  assert.equal(await total(mine, 'call'), 0, 'propre annonce');
  // Un autre membre connecté : compté
  assert.equal((await click(mine, { channel: 'call' }, { token: other.token })).status, 204);
  assert.equal(await total(mine, 'call'), 1);
  forget();
  for (const id of [pending, sold, archived, rejected]) {
    const r = await click(id, { channel: 'call' });
    assert.equal(r.status, 204, `annonce ${id}`);
    assert.equal(await total(id, 'call'), 0, `annonce ${id} : non comptée`);
  }
  for (const id of [999999, 0, 'abc', '1.5', '99999999999', '-3']) assert.equal((await click(id, { channel: 'call' })).status, 204, String(id));
  // Jeton invalide ou révoqué : traité comme visiteur anonyme, pas d'erreur
  assert.equal((await click(mine, { channel: 'call' }, { token: 'abc.def.ghi' })).status, 204);
});

test('canal ou corps invalide : 400, message traduit ; rien n\'est enregistré', async () => {
  const id = await listing(owner);
  const bad = [undefined, null, '', 'sms', 'CALL', 'call ', 42, ['call'], { channel: 'call' }, "call'; DROP TABLE contact_clicks; --"];
  for (const channel of bad) {
    const r = await click(id, { channel });
    assert.equal(r.status, 400, JSON.stringify(channel));
    assert.equal(r.body.error, 'Action invalide.');
  }
  assert.equal((await click(id, {})).status, 400);
  assert.equal((await s.request('POST', `/api/properties/${id}/click`)).status, 400, 'sans corps');
  assert.equal((await click(id, { channel: 'x' }, { headers: { 'X-Lang': 'ar' } })).body.error, AR['Action invalide.']);
  assert.equal((await q('SELECT COUNT(*)::int c FROM contact_clicks WHERE property_id = $1', [id])).rows[0].c, 0);
});

test('vie privée : la table ne contient ni adresse IP ni identifiant de visiteur', async () => {
  const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'contact_clicks' AND table_schema = current_schema() ORDER BY ordinal_position`)).rows.map(r => r.column_name);
  assert.deepEqual(cols, ['property_id', 'day', 'channel', 'n']);
  const id = await listing(owner);
  await click(id, { channel: 'call' });
  const rows = (await q('SELECT * FROM contact_clicks WHERE property_id = $1', [id])).rows;
  assert.equal(rows.length, 1);
  assert.doesNotMatch(JSON.stringify(rows), /127\.0\.0\.1|::1|::ffff/);
});

test('un compteur par jour : les clics de jours différents sont séparés, le total les additionne', async () => {
  const id = await listing(owner);
  await q(`INSERT INTO contact_clicks (property_id, day, channel, n) VALUES ($1, CURRENT_DATE - 45, 'call', 7), ($1, CURRENT_DATE - 10, 'call', 3), ($1, CURRENT_DATE - 10, 'whatsapp', 2)`, [id]);
  await click(id, { channel: 'call' });
  const days = (await q(`SELECT COUNT(*)::int c FROM contact_clicks WHERE property_id = $1 AND channel = 'call'`, [id])).rows[0].c;
  assert.equal(days, 3);
  const t = await clicks.totalsForOwner(owner.id);
  assert.ok(t.calls >= 11 && t.calls_30d >= 4);
  assert.ok(t.calls > t.calls_30d, 'le total inclut les clics de plus de 30 jours');
});

test('l\'annonceur voit ses compteurs (tableau de bord et statistiques) ; les autres et le public non', async () => {
  const o = await s.register('clic-stats');
  const [a, b] = [await listing(o), await listing(o)];
  await q(`INSERT INTO contact_clicks (property_id, day, channel, n) VALUES ($1, CURRENT_DATE, 'call', 4), ($1, CURRENT_DATE, 'whatsapp', 1), ($2, CURRENT_DATE - 60, 'call', 6)`, [a, b]);
  const me = (await s.request('GET', '/api/stats/me', { token: o.token })).body;
  assert.deepEqual([me.calls, me.whatsapps, me.calls_30d, me.whatsapps_30d], [10, 1, 4, 1]);
  const list = (await s.request('GET', `/api/properties/user/${o.id}`, { token: o.token })).body;
  assert.deepEqual([list.find(p => p.id === a).call_clicks, list.find(p => p.id === a).whatsapp_clicks, list.find(p => p.id === b).call_clicks], [4, 1, 6]);
  const seenByOther = (await s.request('GET', `/api/properties/user/${o.id}`, { token: other.token })).body;
  const seenByPublic = (await s.request('GET', `/api/properties/user/${o.id}`)).body;
  for (const rows of [seenByOther, seenByPublic]) for (const p of rows) { assert.ok(!('call_clicks' in p)); assert.ok(!('whatsapp_clicks' in p)); }
  // Ni la fiche publique ni la liste ne les exposent
  const detail = (await s.request('GET', `/api/properties/${a}`)).body;
  assert.ok(!('call_clicks' in detail) && !('whatsapp_clicks' in detail));
  assert.equal((await s.request('GET', '/api/stats/me')).status, 401);
  const noClicks = (await s.request('GET', '/api/stats/me', { token: other.token })).body;
  assert.deepEqual([noClicks.calls, noClicks.whatsapps], [0, 0]);
});

test('suppression d\'une annonce : ses compteurs disparaissent avec elle', async () => {
  const id = await listing(owner);
  await click(id, { channel: 'call' });
  await q('DELETE FROM properties WHERE id = $1', [id]);
  assert.equal((await q('SELECT COUNT(*)::int c FROM contact_clicks WHERE property_id = $1', [id])).rows[0].c, 0);
});

test('clics simultanés de visiteurs différents : aucun n\'est perdu (incrément atomique)', async () => {
  const id = await listing(owner);
  await Promise.all(Array.from({ length: 40 }, () => clicks.record(id, 'call')));
  assert.equal(await total(id, 'call'), 40);
  assert.equal((await q('SELECT COUNT(*)::int c FROM contact_clicks WHERE property_id = $1', [id])).rows[0].c, 1, 'une seule ligne par jour et par canal');
});

test('canaux acceptés : « call » et « whatsapp » seulement', () => {
  assert.deepEqual(clicks.CHANNELS, ['call', 'whatsapp']);
});
