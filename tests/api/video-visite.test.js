// Vidéo et visite virtuelle d'une annonce : création, modification, modération, fiche, contrainte de la base, politique de sécurité.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers/server');
const { AR } = require('../../server/i18n');
const videos = require('../../server/videos');

const YT = 'dQw4w9WgXcQ';
let s, owner, admin, other, n = 0;
const q = (sql, p) => s.db.pool.query(sql, p);
const base = over => ({ title: 'Annonce vidéo ' + ++n, mode: 'vente', type_bien: 'villa', price: 9000000, wilaya: 'Oran', ...over });
const create = (body, user = owner, headers) => s.request('POST', '/api/properties', { token: user.token, body: base(body), headers });
const row = async id => (await q('SELECT video_url, tour_url, status FROM properties WHERE id = $1', [id])).rows[0];

test.before(async () => {
  s = await startServer();
  owner = await s.register('vid');
  other = await s.register('vid-autre');
  admin = await s.makeAdmin(await s.register('vid-admin'));
});
test.after(async () => { await s.stop(); });

test('création : les liens saisis sont enregistrés sous leur forme canonique', async () => {
  const r = await create({ video_url: `https://youtu.be/${YT}?si=x`, tour_url: 'https://kuula.co/post/7Tk4N' });
  assert.equal(r.status, 201);
  assert.deepEqual(await row(r.body.id), { video_url: `https://www.youtube.com/watch?v=${YT}`, tour_url: 'https://kuula.co/share/7Tk4N', status: 'pending' });
});

test('création sans lien, ou avec des champs vides : aucune vidéo', async () => {
  for (const extra of [{}, { video_url: '', tour_url: '' }, { video_url: null, tour_url: null }]) {
    const r = await create(extra);
    assert.equal(r.status, 201);
    const p = await row(r.body.id);
    assert.equal(p.video_url, null); assert.equal(p.tour_url, null);
  }
});

test('création : une adresse refusée donne 400, en français et en arabe, et rien n\'est créé', async () => {
  const before = (await q('SELECT COUNT(*)::int c FROM properties')).rows[0].c;
  for (const [body, msg] of [
    [{ video_url: 'https://evil.example/x' }, videos.BAD_VIDEO],
    [{ video_url: 'javascript:alert(1)' }, videos.BAD_VIDEO],
    [{ video_url: `https://www.youtube.com/watch?v=${YT}"onload="x` }, videos.BAD_VIDEO],
    [{ video_url: 'https://kuula.co/share/7Tk4N' }, videos.BAD_VIDEO],        // une visite n'est pas une vidéo
    [{ video_url: { a: 1 } }, videos.BAD_VIDEO],
    [{ tour_url: `https://youtu.be/${YT}` }, videos.BAD_TOUR],
    [{ tour_url: 'http://my.matterport.com/show/?m=SxQL3iGyoDo' }, videos.BAD_TOUR],
  ]) {
    const fr = await create(body);
    assert.equal(fr.status, 400, JSON.stringify(body));
    assert.equal(fr.body.error, msg);
    const ar = await create(body, owner, { 'X-Lang': 'ar' });
    assert.equal(ar.status, 400);
    assert.equal(ar.body.error, AR[msg]);
    assert.match(ar.body.error, /[؀-ۿ]/);
  }
  assert.equal((await q('SELECT COUNT(*)::int c FROM properties')).rows[0].c, before);
});

test('modification : ajout, remplacement et retrait ; un lien refusé laisse l\'annonce intacte', async () => {
  const id = (await create({ video_url: `https://youtu.be/${YT}` }, admin)).body.id;   // admin : publiée directement
  assert.equal((await row(id)).status, 'active');

  let r = await s.request('PUT', `/api/properties/${id}`, { token: admin.token, body: { tour_url: 'https://my.matterport.com/show/?m=SxQL3iGyoDo' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await row(id), { video_url: `https://www.youtube.com/watch?v=${YT}`, tour_url: 'https://my.matterport.com/show/?m=SxQL3iGyoDo', status: 'active' });

  r = await s.request('PUT', `/api/properties/${id}`, { token: admin.token, body: { video_url: 'https://vimeo.com/123456789' } });
  assert.equal(r.status, 200);
  assert.equal((await row(id)).video_url, 'https://vimeo.com/123456789');

  r = await s.request('PUT', `/api/properties/${id}`, { token: admin.token, body: { video_url: 'https://evil.example/x', title: 'Titre piégé' } });
  assert.equal(r.status, 400);
  assert.equal((await row(id)).video_url, 'https://vimeo.com/123456789');
  assert.notEqual((await q('SELECT title FROM properties WHERE id = $1', [id])).rows[0].title, 'Titre piégé');

  r = await s.request('PUT', `/api/properties/${id}`, { token: admin.token, body: { video_url: '', tour_url: null } });
  assert.equal(r.status, 200);
  const after = await row(id);
  assert.equal(after.video_url, null); assert.equal(after.tour_url, null);
});

test('modification : un tiers ne peut pas modifier les liens d\'une annonce', async () => {
  const id = (await create({})).body.id;
  const r = await s.request('PUT', `/api/properties/${id}`, { token: other.token, body: { video_url: `https://youtu.be/${YT}` } });
  assert.equal(r.status, 403);
  assert.equal((await row(id)).video_url, null);
});

test('modération : changer la vidéo d\'une annonce validée la remet en attente (un compte non fiable)', async () => {
  const id = (await create({})).body.id;
  await q(`UPDATE properties SET status = 'active', published_at = now() WHERE id = $1`, [id]);
  await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { video_url: `https://youtu.be/${YT}` } });
  assert.equal((await row(id)).status, 'pending');

  // un lien identique (même forme canonique) n'est pas un changement de contenu
  await q(`UPDATE properties SET status = 'active' WHERE id = $1`, [id]);
  const same = await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { video_url: `https://www.youtube.com/watch?v=${YT}&t=5` } });
  assert.equal(same.status, 200);
  assert.equal((await row(id)).status, 'active', 'même vidéo : pas de nouvelle modération');

  await s.request('PUT', `/api/properties/${id}`, { token: owner.token, body: { tour_url: 'https://kuula.co/share/7Tk4N' } });
  assert.equal((await row(id)).status, 'pending', 'une visite ajoutée est aussi contrôlée');
});

test('fiche : le serveur renvoie le fournisseur, l\'adresse canonique et l\'adresse d\'incrustation reconstruite', async () => {
  const id = (await create({ video_url: `https://www.youtube.com/watch?v=${YT}&t=9`, tour_url: 'https://my.matterport.com/show/?m=SxQL3iGyoDo' }, admin)).body.id;
  const r = await s.request('GET', `/api/properties/${id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.video, { provider: 'youtube', url: `https://www.youtube.com/watch?v=${YT}`, embed: `https://www.youtube-nocookie.com/embed/${YT}?rel=0&autoplay=1` });
  assert.deepEqual(r.body.tour, { provider: 'matterport', url: 'https://my.matterport.com/show/?m=SxQL3iGyoDo', embed: 'https://my.matterport.com/show/?m=SxQL3iGyoDo&play=1' });
  // la liste porte seulement l'adresse canonique (pastille de la carte)
  const list = await s.request('GET', '/api/properties?limit=100');
  const item = list.body.data.find(p => p.id === id);
  assert.equal(item.video_url, `https://www.youtube.com/watch?v=${YT}`);
  assert.equal(item.video, undefined);
});

test('fiche sans vidéo : video et tour valent null', async () => {
  const id = (await create({}, admin)).body.id;
  const r = await s.request('GET', `/api/properties/${id}`);
  assert.equal(r.body.video, null);
  assert.equal(r.body.tour, null);
});

test('base de données : la contrainte refuse toute valeur qui n\'est pas une adresse canonique, même en SQL direct', async () => {
  const id = (await create({}, admin)).body.id;
  const set = (col, v) => q(`UPDATE properties SET ${col} = $2 WHERE id = $1`, [id, v]);
  for (const v of ['https://evil.example/x', `http://www.youtube.com/watch?v=${YT}`, 'javascript:alert(1)', `https://www.youtube.com/watch?v=${YT}"`,
                   `https://www.youtube.com/watch?v=${YT}&x=1`, 'https://vimeo.com/abc', ''])
    await assert.rejects(set('video_url', v), /properties_video_url_check/, v);
  for (const v of ['https://evil.example/x', 'https://my.matterport.com/show/?m=court', 'https://kuula.co/share/7Tk4N"onload="x', 'https://kuula.co/share/collection', `https://youtu.be/${YT}`])
    await assert.rejects(set('tour_url', v), /properties_tour_url_check/, v);
  await set('video_url', `https://www.youtube.com/watch?v=${YT}`);
  await set('video_url', 'https://vimeo.com/123456789/abcdef1234');
  await set('tour_url', 'https://kuula.co/share/collection/7Kd2L');
  await set('tour_url', null);
});

test('politique de sécurité : seuls les lecteurs de vidéo et de visite virtuelle peuvent être incrustés', async () => {
  const r = await s.request('GET', '/');
  const csp = r.headers.get('content-security-policy');
  const frame = (csp.match(/frame-src ([^;]*)/) || [])[1];
  assert.ok(frame, 'frame-src défini');
  const hosts = frame.split(' ').filter(x => x.startsWith('https://')).filter(h => !/google/.test(h)).sort();
  assert.deepEqual(hosts, ['https://kuula.co', 'https://my.matterport.com', 'https://player.vimeo.com', 'https://www.youtube-nocookie.com']);
  assert.match(csp, /object-src 'none'/);
});
