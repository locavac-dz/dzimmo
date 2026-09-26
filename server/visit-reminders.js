// Rappels J-1 pour les visites confirmées du lendemain.
// Envoyé à 08:00 chaque matin (server/cron.js) par l'instance 0 uniquement.
// Email aux deux parties (visiteur + annonceur) + notification WebSocket.
// Sans SMTP, seules les notifications WS sont envoyées (pas d'erreur).

const { pool } = require('./db');
const mailer   = require('./mailer');
const ws       = require('./ws');
const { notif } = require('./messages');
const { siteUrl } = mailer;

async function sendVisitReminders() {
  // Visites confirmées dont la date est exactement demain (dans le fuseau du serveur)
  const r = await pool.query(`
    SELECT c.id, c.user_id, c.visit_date, c.visit_time, c.property_id,
           p.title        AS property_title,
           p.owner_id,
           u_req.name     AS requester_name, u_req.email AS requester_email, u_req.lang AS requester_lang, u_req.email_verified AS requester_verified,
           u_own.name     AS owner_name,     u_own.email AS owner_email,     u_own.lang AS owner_lang,   u_own.email_verified AS owner_verified
      FROM contact_requests c
      JOIN properties p   ON p.id = c.property_id
      JOIN users u_req ON u_req.id = c.user_id
      JOIN users u_own ON u_own.id = p.owner_id
     WHERE c.status      = 'confirmed'
       AND c.visit_date  = (CURRENT_DATE + INTERVAL '1 day')::date
  `);

  let sent = 0;
  for (const row of r.rows) {
    const propertyUrl = `${siteUrl()}/annonce/${row.property_id}`;

    // E-mail au visiteur (si adresse confirmée)
    if (row.requester_email && row.requester_verified) {
      mailer.mailVisitReminder({
        email: row.requester_email, lang: row.requester_lang,
        recipientName: row.requester_name, requesterName: row.requester_name,
        ownerName: row.owner_name, propertyTitle: row.property_title,
        visitDate: String(row.visit_date).slice(0, 10), visitTime: row.visit_time,
        propertyUrl, role: 'requester',
      });
      sent++;
    }

    // E-mail à l'annonceur (si adresse confirmée)
    if (row.owner_email && row.owner_verified) {
      mailer.mailVisitReminder({
        email: row.owner_email, lang: row.owner_lang,
        recipientName: row.owner_name, requesterName: row.requester_name,
        ownerName: row.owner_name, propertyTitle: row.property_title,
        visitDate: String(row.visit_date).slice(0, 10), visitTime: row.visit_time,
        propertyUrl, role: 'owner',
      });
      sent++;
    }

    // Notification WebSocket au visiteur
    ws.send(row.user_id, {
      type: 'notif', notif_type: 'visit_reminder',
      ...notif(row.requester_lang, 'visit_reminder', { title: row.property_title }),
      link_id: row.property_id,
      time:    new Date().toISOString(),
    });

    // Notification WebSocket à l'annonceur
    ws.send(row.owner_id, {
      type: 'notif', notif_type: 'visit_reminder',
      ...notif(row.owner_lang, 'visit_reminder', { title: row.property_title }),
      link_id: row.property_id,
      time:    new Date().toISOString(),
    });
  }

  return sent;
}

module.exports = { sendVisitReminders };
