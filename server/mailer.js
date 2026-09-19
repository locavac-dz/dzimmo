const nodemailer = require('nodemailer');

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) return null;
  transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST,
    port:   Number(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  return transporter;
}

async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  if (!t || !to) return;
  try {
    await t.sendMail({
      from: `"DzImmo 🏢" <${process.env.EMAIL_USER}>`,
      to, subject, html,
    });
  } catch (e) {
    console.error('[Mailer]', e.message);
  }
}

// ── Templates ────────────────────────────────────────────
function wrap(content) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f9f9f9;padding:0;margin:0">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1)">
  <div style="background:#0C6E4F;padding:24px 32px;color:#fff">
    <span style="font-size:26px;font-weight:900;letter-spacing:-1px;font-family:Georgia,serif">Dz</span><span style="font-size:26px;font-weight:300;letter-spacing:-1px;font-family:Georgia,serif">Immo</span>
    <span style="margin-left:12px;font-size:12px;opacity:.8;font-weight:400">Annonces immobilières — Algérie</span>
  </div>
  <div style="padding:28px 32px">${content}</div>
  <div style="background:#f1f1f1;padding:16px 32px;font-size:12px;color:#999;text-align:center">
    © 2026 DzImmo · Algérie · <a href="https://dzimmo.dz" style="color:#0C6E4F">Visiter le site</a>
  </div>
</div></body></html>`;
}

function mailWelcome({ name, email }) {
  return sendMail({
    to: email, subject: '🏠 Bienvenue sur DzImmo !',
    html: wrap(`
      <h2 style="color:#222;margin-top:0">Bienvenue, ${esc(name)} ! 🎉</h2>
      <p>Votre compte DzImmo est prêt. Vous pouvez dès maintenant :</p>
      <ul style="line-height:2;color:#444">
        <li>🔍 Rechercher des biens à vendre ou à louer dans toute l'Algérie</li>
        <li>💬 Contacter directement propriétaires et agences</li>
        <li>📌 Publier vos annonces immobilières gratuitement</li>
        <li>❤️ Sauvegarder vos biens favoris</li>
      </ul>
      <a href="https://dzimmo.dz" style="display:inline-block;background:#0C6E4F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:8px">Découvrir les annonces →</a>
    `),
  });
}

function mailVerifyEmail({ name, email, verifyUrl }) {
  return sendMail({
    to: email, subject: '✅ Confirmez votre adresse email — DzImmo',
    html: wrap(`
      <h2 style="color:#222;margin-top:0">Confirmez votre adresse email</h2>
      <p>Bonjour <strong>${esc(name)}</strong>,</p>
      <p>Pour activer votre compte DzImmo, confirmez votre adresse email :</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${verifyUrl}" style="display:inline-block;background:#0C6E4F;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Confirmer mon email →</a>
      </div>
      <p style="font-size:13px;color:#666">Ce lien est valable <strong>24 heures</strong>.</p>
    `),
  });
}

function mailPasswordReset({ name, email, resetUrl }) {
  return sendMail({
    to: email, subject: '🔑 Réinitialisation de votre mot de passe — DzImmo',
    html: wrap(`
      <h2 style="color:#222;margin-top:0">Réinitialisation du mot de passe</h2>
      <p>Bonjour <strong>${esc(name)}</strong>,</p>
      <p>Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${resetUrl}" style="display:inline-block;background:#0C6E4F;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Réinitialiser mon mot de passe →</a>
      </div>
      <p style="font-size:13px;color:#666">Ce lien est valable <strong>1 heure</strong>.</p>
    `),
  });
}

function mailContactRequest({ ownerName, ownerEmail, requesterName, propertyTitle, type, message, visitDate, offerAmount }) {
  const typeLabel = { visite: 'Demande de visite', info: 'Demande de renseignement', offre: 'Offre de prix' }[type] || type;
  const extraInfo = type === 'visite' && visitDate
    ? `<p style="margin:4px 0"><strong>📅 Date souhaitée :</strong> ${esc(visitDate)}</p>`
    : type === 'offre' && offerAmount
    ? `<p style="margin:4px 0"><strong>💰 Offre proposée :</strong> ${Number(offerAmount).toLocaleString('fr-DZ')} DZD</p>`
    : '';
  return sendMail({
    to: ownerEmail, subject: `📩 ${typeLabel} — ${propertyTitle}`,
    html: wrap(`
      <h2 style="color:#222;margin-top:0">Nouvelle demande sur votre annonce 📩</h2>
      <p>Bonjour <strong>${esc(ownerName)}</strong>,</p>
      <p><strong>${esc(requesterName)}</strong> a envoyé une <strong>${esc(typeLabel.toLowerCase())}</strong> pour votre bien <strong>${esc(propertyTitle)}</strong>.</p>
      <div style="background:#f0fdf4;border-radius:10px;padding:16px;margin:20px 0;border-left:4px solid #0C6E4F">
        <p style="margin:4px 0"><strong>👤 Demandeur :</strong> ${esc(requesterName)}</p>
        <p style="margin:4px 0"><strong>📋 Type :</strong> ${esc(typeLabel)}</p>
        ${extraInfo}
        ${message ? `<p style="margin:4px 0"><strong>💬 Message :</strong> ${esc(message)}</p>` : ''}
      </div>
      <a href="https://dzimmo.dz" style="display:inline-block;background:#0C6E4F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Répondre sur DzImmo →</a>
    `),
  });
}

function mailNewMessage({ to, senderName, propertyTitle, preview }) {
  return sendMail({
    to, subject: `💬 Nouveau message de ${senderName}`,
    html: wrap(`
      <h2 style="margin-top:0">Vous avez un nouveau message</h2>
      <p><strong>${esc(senderName)}</strong> vous a envoyé un message concernant <strong>${esc(propertyTitle)}</strong> :</p>
      <div style="background:#f9f9f9;border-left:4px solid #0C6E4F;padding:12px 16px;border-radius:0 8px 8px 0;margin:16px 0;font-style:italic;color:#444">
        "${esc(preview.length > 120 ? preview.slice(0, 120) + '…' : preview)}"
      </div>
      <a href="https://dzimmo.dz" style="display:inline-block;background:#0C6E4F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Répondre sur DzImmo →</a>
    `),
  });
}

function mailSearchAlert({ email, name, properties, alertCriteria }) {
  const modeLabel = {
    vente: 'Vente', location_longue: 'Location longue', location_courte: 'Location courte',
  }[alertCriteria.mode] || 'Tous modes';
  const typeLabel = alertCriteria.type_bien || 'Tous types';
  const wilayaLabel = alertCriteria.wilaya || 'Toutes les wilayas';
  const criteria = [wilayaLabel, modeLabel, typeLabel].join(' · ');

  const rows = properties.map(p => `
    <tr>
      <td style="padding:.6rem .5rem;border-bottom:1px solid #f0f0f0">
        <strong>${esc(p.title)}</strong><br>
        <span style="font-size:.83rem;color:#666">${esc(p.wilaya)}</span>
      </td>
      <td style="padding:.6rem .5rem;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;font-weight:700;color:#0C6E4F">
        ${Number(p.price).toLocaleString('fr-DZ')} DZD
      </td>
    </tr>`).join('');

  return sendMail({
    to: email,
    subject: `🔔 ${properties.length} nouvelle${properties.length > 1 ? 's' : ''} annonce${properties.length > 1 ? 's' : ''} — ${criteria}`,
    html: wrap(`
      <h2 style="color:#222;margin-top:0">🔔 Nouvelles annonces pour votre alerte</h2>
      <p>Bonjour <strong>${esc(name)}</strong>,</p>
      <p><strong>${properties.length}</strong> nouvelle${properties.length > 1 ? 's' : ''} annonce${properties.length > 1 ? 's' : ''} correspond${properties.length > 1 ? 'ent' : ''} à votre alerte :</p>
      <div style="background:#f0fdf4;border-radius:8px;padding:8px 14px;margin:12px 0;font-size:.88rem;color:#0C6E4F;font-weight:600">
        ${esc(criteria)}
      </div>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">${rows}</table>
      <div style="text-align:center;margin:20px 0">
        <a href="${process.env.APP_URL || 'https://dzimmo.dz'}" style="display:inline-block;background:#0C6E4F;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700">
          Voir toutes les annonces →
        </a>
      </div>
      <p style="font-size:.8rem;color:#aaa;margin-top:1.5rem">
        Vous recevez cet email car vous avez activé une alerte sur DzImmo.
        Gérez vos alertes depuis votre espace personnel.
      </p>
    `),
  });
}

module.exports = {
  sendMail,
  mailWelcome, mailVerifyEmail, mailPasswordReset,
  mailContactRequest, mailNewMessage, mailSearchAlert,
};
