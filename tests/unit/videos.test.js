// Vidéo et visite virtuelle : reconnaissance des liens, forme canonique, refus des adresses piégées (server/videos.js).
const test   = require('node:test');
const assert = require('node:assert/strict');
const videos = require('../../server/videos');

const YT = 'dQw4w9WgXcQ';
const canon = (kind, v) => (videos.parse(kind, v) || {}).url;

test('YouTube : toutes les formes usuelles donnent la même adresse canonique et un lecteur sans cookie', () => {
  for (const v of [
    `https://www.youtube.com/watch?v=${YT}`, `https://youtube.com/watch?v=${YT}&t=42s`, `https://m.youtube.com/watch?v=${YT}`,
    `https://youtu.be/${YT}`, `https://youtu.be/${YT}?si=abc`, `https://www.youtube.com/embed/${YT}`, `https://www.youtube.com/shorts/${YT}`,
    `https://www.youtube-nocookie.com/embed/${YT}`, `  https://www.youtube.com/live/${YT}  `,
  ]) {
    const r = videos.parse('video', v);
    assert.ok(r, v);
    assert.equal(r.provider, 'youtube');
    assert.equal(r.url, `https://www.youtube.com/watch?v=${YT}`, v);
    assert.equal(r.embed, `https://www.youtube-nocookie.com/embed/${YT}?rel=0&autoplay=1`, v);
  }
});

test('Vimeo : vidéo publique, non répertoriée (clé) et lecteur', () => {
  assert.equal(canon('video', 'https://vimeo.com/123456789'), 'https://vimeo.com/123456789');
  assert.equal(canon('video', 'https://www.vimeo.com/123456789/abcdef1234'), 'https://vimeo.com/123456789/abcdef1234');
  assert.equal(canon('video', 'https://player.vimeo.com/video/123456789?h=abcdef1234&dnt=1'), 'https://vimeo.com/123456789/abcdef1234');
  const r = videos.parse('video', 'https://vimeo.com/123456789/abcdef1234');
  assert.equal(r.embed, 'https://player.vimeo.com/video/123456789?dnt=1&autoplay=1&h=abcdef1234');
  assert.equal(videos.parse('video', 'https://vimeo.com/123456789').embed, 'https://player.vimeo.com/video/123456789?dnt=1&autoplay=1');
});

test('Matterport et Kuula : visites virtuelles', () => {
  assert.equal(canon('tour', 'https://my.matterport.com/show/?m=SxQL3iGyoDo'), 'https://my.matterport.com/show/?m=SxQL3iGyoDo');
  assert.equal(canon('tour', 'https://my.matterport.com/show/?m=SxQL3iGyoDo&brand=0&play=1'), 'https://my.matterport.com/show/?m=SxQL3iGyoDo');
  assert.equal(videos.parse('tour', 'https://my.matterport.com/show/?m=SxQL3iGyoDo').embed, 'https://my.matterport.com/show/?m=SxQL3iGyoDo&play=1');
  assert.equal(canon('tour', 'https://kuula.co/share/7Tk4N'), 'https://kuula.co/share/7Tk4N');
  assert.equal(canon('tour', 'https://kuula.co/post/7Tk4N'), 'https://kuula.co/share/7Tk4N', 'post et share désignent la même visite');
  assert.equal(canon('tour', 'https://kuula.co/share/collection/7Kd2L?logo=1'), 'https://kuula.co/share/collection/7Kd2L');
  assert.match(videos.parse('tour', 'https://kuula.co/share/7Tk4N').embed, /^https:\/\/kuula\.co\/share\/7Tk4N\?/);
});

test('chaque type n\'accepte que ses fournisseurs (une visite n\'est pas une vidéo, et inversement)', () => {
  assert.equal(videos.parse('tour', `https://www.youtube.com/watch?v=${YT}`), null);
  assert.equal(videos.parse('tour', 'https://vimeo.com/123456789'), null);
  assert.equal(videos.parse('video', 'https://my.matterport.com/show/?m=SxQL3iGyoDo'), null);
  assert.equal(videos.parse('video', 'https://kuula.co/share/7Tk4N'), null);
});

const BAD = [
  // schémas et hôtes
  `http://www.youtube.com/watch?v=${YT}`, `//www.youtube.com/watch?v=${YT}`, `www.youtube.com/watch?v=${YT}`, `javascript:alert(1)`,
  `data:text/html,<script>alert(1)</script>`, `ftp://www.youtube.com/watch?v=${YT}`, `https://evil.example/watch?v=${YT}`,
  `https://www.youtube.com.evil.example/watch?v=${YT}`, `https://evil.example/www.youtube.com/watch?v=${YT}`,
  `https://user:pw@www.youtube.com/watch?v=${YT}`, `https://www.youtube.com:8443/watch?v=${YT}`, `https://youtube.com@evil.example/watch?v=${YT}`,
  `https://youtu.be.evil.example/${YT}`, `https://vimeo.com.evil.example/123456789`, `https://notvimeo.com/123456789`,
  // identifiants invalides ou chemins détournés
  'https://www.youtube.com/watch?v=court', `https://www.youtube.com/watch?v=${YT}x`, 'https://www.youtube.com/watch', 'https://www.youtube.com/',
  `https://www.youtube.com/watch/${YT}`, `https://www.youtube.com/embed/${YT}/extra`, `https://www.youtube.com/playlist?list=${YT}`,
  `https://www.youtube.com/watch?v=${YT}"onload="x`, `https://www.youtube.com/watch?v=${YT}' onload='x`, `https://www.youtube.com/watch?v=${YT}<b>`,
  'https://vimeo.com/abc', 'https://vimeo.com/123', 'https://vimeo.com/123456789/zz', 'https://vimeo.com/123456789/abcdef1234/x', 'https://vimeo.com/channels/x',
  'https://player.vimeo.com/123456789', 'https://player.vimeo.com/video/123456789?h=XYZ',
  // espaces, retours à la ligne, longueur, types
  `https://www.youtube.com/watch?v=${YT} x`, `https://www.youtube.com/watch?v=${YT}\nx`, `https://www.youtube.com/watch?v=${YT}&x=` + 'a'.repeat(300),
  '', '   ', 123, null, undefined, {}, [], [`https://youtu.be/${YT}`], true,
];

test('adresses piégées ou mal formées : toutes refusées comme vidéo', () => {
  for (const v of BAD) assert.equal(videos.parse('video', v), null, String(v));
});

const BAD_TOUR = [
  'http://my.matterport.com/show/?m=SxQL3iGyoDo', 'https://my.matterport.com.evil.example/show/?m=SxQL3iGyoDo', 'https://matterport.com/show/?m=SxQL3iGyoDo',
  'https://my.matterport.com/show/?m=court', 'https://my.matterport.com/show/', 'https://my.matterport.com/models/SxQL3iGyoDo', 'https://my.matterport.com/show/x/?m=SxQL3iGyoDo',
  'https://my.matterport.com/show/?m=SxQL3iGyoDo"><script>', 'https://user@my.matterport.com/show/?m=SxQL3iGyoDo',
  'https://kuula.co/share/', 'https://kuula.co/share/ab', 'https://kuula.co/share/abcdefghijklmn', 'https://kuula.co/share/7Tk4N/extra', 'https://kuula.co/x/7Tk4N',
  'https://kuula.co.evil.example/share/7Tk4N', 'https://kuula.co/share/7Tk4N"onload="x', 'https://kuula.co:444/share/7Tk4N', 'https://kuula.co/share/collection/', 'https://kuula.co/share/7Tk4N/collection/AbCd1', 'https://kuula.co/post/7Tk4N/collection/AbCd1', 'https://mls.kuu.la/share/7Tk4N',
];

test('adresses piégées ou mal formées : toutes refusées comme visite virtuelle', () => {
  for (const v of BAD_TOUR) assert.equal(videos.parse('tour', v), null, String(v));
});

test('invalid : vide ou absent = rien à vérifier ; sinon le message du champ fautif', () => {
  assert.equal(videos.invalid({}), null);
  assert.equal(videos.invalid(), null);
  assert.equal(videos.invalid({ video_url: '', tour_url: null }), null);
  assert.equal(videos.invalid({ video_url: `https://youtu.be/${YT}`, tour_url: 'https://kuula.co/share/7Tk4N' }), null);
  assert.equal(videos.invalid({ video_url: 'https://evil.example/x' }), videos.BAD_VIDEO);
  assert.equal(videos.invalid({ tour_url: 'https://evil.example/x' }), videos.BAD_TOUR);
  assert.equal(videos.invalid({ video_url: 42 }), videos.BAD_VIDEO);
});

test('clean : l\'adresse canonique, ou null pour un champ vidé ou refusé ; describe relit une valeur stockée', () => {
  assert.equal(videos.clean('video', `https://youtu.be/${YT}`), `https://www.youtube.com/watch?v=${YT}`);
  assert.equal(videos.clean('video', ''), null);
  assert.equal(videos.clean('video', undefined), null);
  assert.equal(videos.clean('tour', 'https://evil.example/x'), null);
  assert.equal(videos.describe('video', null), null);
  assert.equal(videos.describe('video', 'n\'importe quoi'), null);
  assert.equal(videos.describe('tour', 'https://kuula.co/share/7Tk4N').provider, 'kuula');
});

test('les formes canoniques produites respectent la forme imposée à la base (CANONICAL)', () => {
  for (const [kind, v] of [['video', `https://youtu.be/${YT}`], ['video', 'https://vimeo.com/123456789/abcdef1234'], ['video', 'https://vimeo.com/123456789'],
                           ['tour', 'https://my.matterport.com/show/?m=SxQL3iGyoDo'], ['tour', 'https://kuula.co/post/7Tk4N'], ['tour', 'https://kuula.co/share/collection/7Kd2L']]) {
    assert.match(videos.parse(kind, v).url, videos.CANONICAL[kind], v);
  }
});
