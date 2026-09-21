// Alerte de baisse de prix : règle pure (seuil, plancher des 30 jours), textes de la notification et du profil en français et en arabe.
const test   = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/front');

const app = read('app.js');
const css = read('app.css');
const { dropInfo, money, MIN_PERCENT } = require('../../server/price-drop');
const { notif } = require('../../server/messages');

test('dropInfo : baisse d\'au moins 3 % (arrondie à l\'entier inférieur), sinon rien', () => {
  assert.deepEqual(dropInfo(10000000, 9000000), { percent: 10 });
  assert.deepEqual(dropInfo(10000000, 9700000), { percent: 3 });
  assert.equal(dropInfo(10000000, 9710000), null, '2,9 % : sous le seuil');
  assert.equal(dropInfo(10000000, 10000000), null);
  assert.equal(dropInfo(10000000, 11000000), null, 'hausse');
  assert.equal(MIN_PERCENT, 3);
});

test('dropInfo : le nouveau prix doit aussi passer sous le plus bas des 30 derniers jours', () => {
  assert.equal(dropInfo(12000000, 10500000, 10000000), null, 'remonté de 10 M à 12 M puis « baissé » à 10,5 M');
  assert.equal(dropInfo(12000000, 10000000, 10000000), null, 'égal au plus bas : pas une nouveauté');
  assert.deepEqual(dropInfo(12000000, 9000000, 10000000), { percent: 25 });
  assert.deepEqual(dropInfo(10000000, 9000000), { percent: 10 }, 'sans historique : le prix précédent fait plancher');
});

test('dropInfo : valeurs absurdes refusées (jamais de NaN, de zéro ni de négatif)', () => {
  for (const [o, n] of [[0, 0], [-5, -10], ['abc', 1], [1000, 'x'], [null, 500], [1000, undefined], [Infinity, 1]])
    assert.equal(dropInfo(o, n), null, `${o} → ${n}`);
});

test('money : DZD en français, د.ج en arabe ; langue inconnue = français', () => {
  assert.match(money('fr', 9000000), /9\D000\D000 DZD$/);
  assert.match(money('ar', 9000000), /د\.ج$/);
  assert.match(money('xx', 9000000), /DZD$/);
});

test('notification : titre et texte en français et en arabe, avec titre, prix et pourcentage', () => {
  const p = { title: 'Villa X', price: '9 000 000 DZD', percent: 10 };
  const fr = notif('fr', 'price_drop', p), ar = notif('ar', 'price_drop', p);
  assert.match(fr.body, /Villa X/); assert.match(fr.body, /9 000 000 DZD/); assert.match(fr.body, /10 %/);
  assert.match(ar.title, /[؀-ۿ]/); assert.match(ar.body, /Villa X/); assert.match(ar.body, /10/);
});

test('profil : case « Alertes de baisse de prix » envoyée à l\'API, textes FR et AR, pastille 📉, style sans style en ligne', () => {
  assert.match(app, /id="p-notify-drop"\$\{currentUser\.notify_price_drop === false \? '' : ' checked'\}/, 'cochée par défaut');
  assert.match(app, /notify_price_drop = !!document\.getElementById\('p-notify-drop'\)\?\.checked/);
  assert.match(app, /api\('\/auth\/profile', 'PUT', \{ name, phone, bio, notify_price_drop \}\)/);
  for (const key of ['prof_notify_drop', 'prof_notify_drop_hint']) {
    const all = [...app.matchAll(new RegExp(String.raw`\b${key}:\s*'((?:\\.|[^'\\])*)'`, 'g'))].map(m => m[1]);
    assert.equal(all.length, 2, key + ' : une entrée par langue');
    assert.match(all[1], /[؀-ۿ]/, key + ' en arabe');
  }
  assert.match(app, /price_drop:'📉'/);
  assert.match(css, /\.profile-check \{[^}]*display: flex/);
});
