// Déclenche les alertes de recherche quand une annonce devient active.
// Appelé en fire-and-forget depuis properties.js (POST direct) et moderation.js (approbation).
const { pool }        = require('./db');
const { mailSearchAlert } = require('./mailer');
const { sendPush }    = require('./push');
const { send: sendWs } = require('./ws');
const { notif }       = require('./messages');

async function notifyMatchingAlerts(property) {
  if (!property || property.status !== 'active') return;

  const { rows } = await pool.query(`
    SELECT sa.id, sa.user_id, sa.wilaya, sa.mode, sa.type_bien,
           u.name, u.email, u.lang, u.email_verified
      FROM search_alerts sa
      JOIN users u ON u.id = sa.user_id
     WHERE sa.user_id    != $1
       AND u.banned      IS NOT TRUE
       AND (sa.mode      IS NULL OR sa.mode      = $2)
       AND (sa.type_bien IS NULL OR sa.type_bien = $3)
       AND (sa.wilaya    IS NULL OR sa.wilaya    = $4)
       AND (sa.min_price IS NULL OR sa.min_price <= $5)
       AND (sa.max_price IS NULL OR sa.max_price >= $5)
       AND (sa.min_surface IS NULL OR sa.min_surface <= $6)
       AND (sa.rooms     IS NULL OR $7::SMALLINT >= sa.rooms)
       AND (sa.condition IS NULL OR sa.condition = $8)
       AND (sa.commune   IS NULL OR dz_norm($9) = dz_norm(sa.commune))
     LIMIT 500
  `, [
    property.owner_id,
    property.mode       || null,
    property.type_bien  || null,
    property.wilaya     || null,
    property.price      || 0,
    property.surface_m2 ?? 0,
    property.rooms      ?? null,
    property.condition  || null,
    property.commune    || null,
  ]);

  for (const a of rows) {
    const lang = a.lang || 'fr';
    const n    = notif(lang, 'search_alert', { title: property.title });

    sendWs(a.user_id, {
      type: 'notif', notif_type: 'search_alert',
      title: n.title, body: n.body,
      link_id: property.id,
      time: new Date().toISOString(),
    });

    sendPush(a.user_id, {
      title: n.title, body: property.title,
      url:  '/annonce/' + property.id,
      tag:  'search_alert',
    }).catch(() => {});

    if (a.email_verified) {
      mailSearchAlert({
        email: a.email, lang,
        name: a.name,
        properties: [{
          id:     property.id,
          title:  property.title,
          wilaya: property.wilaya,
          price:  property.price,
        }],
        alertCriteria: {
          wilaya:    a.wilaya,
          mode:      a.mode,
          type_bien: a.type_bien,
        },
      }).catch(() => {});
    }
  }
}

module.exports = { notifyMatchingAlerts };
