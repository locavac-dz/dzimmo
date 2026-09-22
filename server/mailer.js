const nodemailer = require('nodemailer');
const WILAYAS_AR = require('./wilayas-ar');
const { translateReason } = require('./messages');

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

// Adresse publique du site dans les emails : APP_URL (exigée en production par config-check), jamais un domaine écrit en dur
// (une préproduction envoyait ses membres vers le site de production).
const siteUrl = () => (process.env.APP_URL || 'http://localhost:3001').replace(/\/+$/, '');

// Expéditeur : EMAIL_FROM (« Nom <adresse> » ou adresse seule) s'il est valide, sinon le compte SMTP. Un retour à la ligne y est refusé
// (injection d'en-têtes) ; config-check signale une valeur invalide au démarrage.
const FROM_OK = /^(?:[^<>\r\n"@,;]{1,80}\s)?<?[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+>?$/;
// Adresse seule (destinataire CONTACT_EMAIL, adresse de réponse d'un visiteur) : ni espace, ni séparateur de liste, ni chevrons
const EMAIL_OK = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
function sender(env = process.env) {
  const from = (env.EMAIL_FROM || '').trim();
  return from && FROM_OK.test(from) ? from : `"DzImmo 🏢" <${env.EMAIL_USER}>`;
}

// Renvoie true si le serveur SMTP a accepté le message, false sinon (SMTP non configuré, destinataire absent, refus) :
// la plupart des appelants l'ignorent ; le formulaire de contact s'en sert pour ne pas annoncer un envoi qui n'a pas eu lieu.
async function sendMail({ to, subject, html, replyTo, headers }) {
  const t = getTransporter();
  if (!t || !to) return false;
  try {
    await t.sendMail({
      from: sender(),
      to, subject, html,
      ...(replyTo ? { replyTo } : {}),
      ...(headers ? { headers } : {}),
    });
    return true;
  } catch (e) {
    // Les erreurs SMTP citent souvent le destinataire : pas d'adresse email dans les journaux (loi 18-07)
    console.error('[Mailer]', String(e.message).replace(/[^\s<>"']+@[^\s<>"']+/g, '<adresse>'));
    return false;
  }
}

// Le serveur SMTP est-il renseigné ? (une route dont l'email est le résultat le vérifie avant d'enregistrer quoi que ce soit)
const configured = () => !!getTransporter();

// ── Langue (français / arabe) ────────────────────────────────────────────────
// Chaque email est rédigé dans la langue du destinataire (users.lang). Les gabarits build*() sont
// des fonctions pures { subject, html } : testables sans SMTP ; mail*() les envoie.
const UI = {
  fr: { dir: 'ltr', align: 'left',  tagline: 'Annonces immobilières — Algérie', country: 'Algérie', visit: 'Visiter le site', hello: 'Bonjour', dzd: 'DZD', arrow: '→' },
  ar: { dir: 'rtl', align: 'right', tagline: 'إعلانات عقارية — الجزائر',        country: 'الجزائر', visit: 'زيارة الموقع',    hello: 'مرحباً', dzd: 'د.ج', arrow: '←' },
};
const ui = lang => UI[lang === 'ar' ? 'ar' : 'fr'];
const pick = (lang, fr, ar) => (lang === 'ar' ? ar : fr);

const MODES = {
  fr: { vente: 'Vente', location_longue: 'Location longue', location_courte: 'Location courte', all: 'Tous modes' },
  ar: { vente: 'بيع', location_longue: 'إيجار طويل الأمد', location_courte: 'إيجار قصير الأمد', all: 'جميع العمليات' },
};
const TYPES = {
  fr: { appartement: 'Appartement', villa: 'Villa', maison: 'Maison', bureau: 'Bureau', local_commercial: 'Local commercial',
        terrain: 'Terrain', ferme: 'Ferme', entrepot: 'Entrepôt', all: 'Tous types' },
  ar: { appartement: 'شقة', villa: 'فيلا', maison: 'منزل', bureau: 'مكتب', local_commercial: 'محل تجاري',
        terrain: 'أرض', ferme: 'مزرعة', entrepot: 'مستودع', all: 'جميع الأنواع' },
};
const wilayaName = (lang, w) => (w ? (lang === 'ar' && WILAYAS_AR[w]) || w : pick(lang, 'Toutes les wilayas', 'جميع الولايات'));
const fmt = n => Number(n).toLocaleString('fr-DZ');

// « N nouvelles annonces » : l'arabe distingue 1, 2 (duel), 3-10 (pluriel) puis 11+ (singulier)
function newAds(lang, n) {
  if (lang !== 'ar') return `nouvelle${n > 1 ? 's' : ''} annonce${n > 1 ? 's' : ''}`;
  const m = n % 100;
  return n === 1 ? 'إعلان جديد' : n === 2 ? 'إعلانان جديدان' : (m >= 3 && m <= 10) ? 'إعلانات جديدة' : 'إعلاناً جديداً';
}

// ── Gabarit commun ───────────────────────────────────────────────────────────
function wrap(content, lang) {
  const u = ui(lang);
  return `<!DOCTYPE html><html lang="${lang === 'ar' ? 'ar' : 'fr'}" dir="${u.dir}"><body dir="${u.dir}" style="font-family:Arial,sans-serif;background:#f9f9f9;padding:0;margin:0;direction:${u.dir};text-align:${u.align}">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1);direction:${u.dir};text-align:${u.align}">
  <div style="background:#0C6E4F;padding:24px 32px;color:#fff">
    <span dir="ltr" style="font-size:26px;font-weight:900;letter-spacing:-1px;font-family:Georgia,serif">Dz</span><span dir="ltr" style="font-size:26px;font-weight:300;letter-spacing:-1px;font-family:Georgia,serif">Immo</span>
    <span style="margin:0 12px;font-size:12px;opacity:.8;font-weight:400">${u.tagline}</span>
  </div>
  <div style="padding:28px 32px">${content}</div>
  <div style="background:#f1f1f1;padding:16px 32px;font-size:12px;color:#999;text-align:center">
    © 2026 DzImmo · ${u.country} · <a href="${esc(siteUrl())}" style="color:#0C6E4F">${u.visit}</a>
  </div>
</div></body></html>`;
}

const button = (href, label, lang, big) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#0C6E4F;color:#fff;padding:${big ? '14px 32px' : '12px 24px'};border-radius:${big ? 10 : 8}px;text-decoration:none;font-weight:700${big ? ';font-size:15px' : ''}">${label} ${ui(lang).arrow}</a>`;
const centered = html => `<div style="text-align:center;margin:28px 0">${html}</div>`;

// ── Gabarits ─────────────────────────────────────────────────────────────────
function buildWelcome(lang, { name }) {
  const li = pick(lang,
    ['🔍 Rechercher des biens à vendre ou à louer dans toute l\'Algérie', '💬 Contacter directement propriétaires et agences',
     '📌 Publier vos annonces immobilières gratuitement', '❤️ Sauvegarder vos biens favoris'],
    ['🔍 البحث عن عقارات للبيع أو للإيجار في كامل الجزائر', '💬 التواصل مباشرة مع المالكين والوكالات',
     '📌 نشر إعلاناتك العقارية مجاناً', '❤️ حفظ عقاراتك المفضلة']);
  return {
    subject: pick(lang, '🏠 Bienvenue sur DzImmo !', '🏠 مرحباً بك في DzImmo!'),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, `Bienvenue, ${esc(name)} ! 🎉`, `مرحباً بك، ${esc(name)}! 🎉`)}</h2>
      <p>${pick(lang, 'Votre compte DzImmo est prêt. Vous pouvez dès maintenant :', 'حسابك في DzImmo جاهز. يمكنك الآن:')}</p>
      <ul style="line-height:2;color:#444">${li.map(x => `<li>${x}</li>`).join('')}</ul>
      ${button(siteUrl(), pick(lang, 'Découvrir les annonces', 'اكتشف الإعلانات'), lang)}
    `, lang),
  };
}

function buildVerifyEmail(lang, { name, verifyUrl }) {
  return {
    subject: pick(lang, '✅ Confirmez votre adresse email — DzImmo', '✅ أكِّد عنوان بريدك الإلكتروني — DzImmo'),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Confirmez votre adresse email', 'أكِّد عنوان بريدك الإلكتروني')}</h2>
      <p>${ui(lang).hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang, 'Pour activer votre compte DzImmo, confirmez votre adresse email :', 'لتفعيل حسابك في DzImmo، أكِّد عنوان بريدك الإلكتروني:')}</p>
      ${centered(button(verifyUrl, pick(lang, 'Confirmer mon email', 'تأكيد بريدي الإلكتروني'), lang, true))}
      <p style="font-size:13px;color:#666">${pick(lang, 'Ce lien est valable <strong>24 heures</strong>.', 'هذا الرابط صالح لمدة <strong>24 ساعة</strong>.')}</p>
    `, lang),
  };
}

function buildPasswordReset(lang, { name, resetUrl }) {
  return {
    subject: pick(lang, '🔑 Réinitialisation de votre mot de passe — DzImmo', '🔑 إعادة تعيين كلمة المرور — DzImmo'),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Réinitialisation du mot de passe', 'إعادة تعيين كلمة المرور')}</h2>
      <p>${ui(lang).hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang, 'Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :', 'اضغط على الزر أدناه لاختيار كلمة مرور جديدة:')}</p>
      ${centered(button(resetUrl, pick(lang, 'Réinitialiser mon mot de passe', 'إعادة تعيين كلمة المرور'), lang, true))}
      <p style="font-size:13px;color:#666">${pick(lang, 'Ce lien est valable <strong>1 heure</strong>.', 'هذا الرابط صالح لمدة <strong>ساعة واحدة</strong>.')}</p>
    `, lang),
  };
}

function buildContactRequest(lang, { ownerName, requesterName, propertyTitle, type, message, visitDate, visitTime, offerAmount }) {
  const labels = pick(lang,
    { visite: 'Demande de visite', info: 'Demande de renseignement', offre: 'Offre de prix' },
    { visite: 'طلب زيارة', info: 'طلب معلومات', offre: 'عرض سعر' });
  const typeLabel = labels[type] || type;
  const dateStr = visitDate
    ? visitTime
      ? `${esc(visitDate)} ${pick(lang, 'à', 'الساعة')} ${esc(visitTime)}`
      : esc(visitDate)
    : '';
  const extra = type === 'visite' && visitDate
    ? `<p style="margin:4px 0"><strong>${pick(lang, '📅 Date souhaitée :', '📅 التاريخ المطلوب:')}</strong> ${dateStr}</p>`
    : type === 'offre' && offerAmount
    ? `<p style="margin:4px 0"><strong>${pick(lang, '💰 Offre proposée :', '💰 العرض المقترح:')}</strong> ${fmt(offerAmount)} ${ui(lang).dzd}</p>`
    : '';
  return {
    subject: `📩 ${typeLabel} — ${propertyTitle}`,
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Nouvelle demande sur votre annonce 📩', 'طلب جديد على إعلانك 📩')}</h2>
      <p>${ui(lang).hello} <strong>${esc(ownerName)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang,
        `<strong>${esc(requesterName)}</strong> a envoyé une <strong>${esc(typeLabel.toLowerCase())}</strong> pour votre bien <strong>${esc(propertyTitle)}</strong>.`,
        `أرسل <strong>${esc(requesterName)}</strong> <strong>${esc(typeLabel)}</strong> بخصوص عقارك <strong>${esc(propertyTitle)}</strong>.`)}</p>
      <div style="background:#f0fdf4;border-radius:10px;padding:16px;margin:20px 0;border-${lang === 'ar' ? 'right' : 'left'}:4px solid #0C6E4F">
        <p style="margin:4px 0"><strong>${pick(lang, '👤 Demandeur :', '👤 صاحب الطلب:')}</strong> ${esc(requesterName)}</p>
        <p style="margin:4px 0"><strong>${pick(lang, '📋 Type :', '📋 النوع:')}</strong> ${esc(typeLabel)}</p>
        ${extra}
        ${message ? `<p style="margin:4px 0"><strong>${pick(lang, '💬 Message :', '💬 الرسالة:')}</strong> ${esc(message)}</p>` : ''}
      </div>
      ${button(siteUrl(), pick(lang, 'Répondre sur DzImmo', 'الرد على DzImmo'), lang)}
    `, lang),
  };
}

// Rappel J-1 envoyé aux deux parties (visiteur et annonceur) pour une visite confirmée
function buildVisitReminder(lang, { recipientName, requesterName, ownerName, propertyTitle, visitDate, visitTime, propertyUrl, role }) {
  const dateStr = visitTime
    ? `${esc(visitDate)} ${pick(lang, 'à', 'الساعة')} ${esc(visitTime)}`
    : esc(visitDate);
  const intro = role === 'requester'
    ? pick(lang,
        `Vous avez une visite confirmée pour <strong>${esc(propertyTitle)}</strong> demain${visitTime ? ` à <strong>${esc(visitTime)}</strong>` : ''}.`,
        `لديك زيارة مؤكدة لـ <strong>${esc(propertyTitle)}</strong> غداً${visitTime ? ` الساعة <strong>${esc(visitTime)}</strong>` : ''}.`)
    : pick(lang,
        `<strong>${esc(requesterName)}</strong> a confirmé une visite pour <strong>${esc(propertyTitle)}</strong> demain${visitTime ? ` à <strong>${esc(visitTime)}</strong>` : ''}.`,
        `أكّد <strong>${esc(requesterName)}</strong> زيارة لـ <strong>${esc(propertyTitle)}</strong> غداً${visitTime ? ` الساعة <strong>${esc(visitTime)}</strong>` : ''}.`);
  return {
    subject: pick(lang, `🗓️ Rappel de visite — ${propertyTitle}`, `🗓️ تذكير بالزيارة — ${propertyTitle}`),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, '📅 Rappel de visite demain', '📅 تذكير بالزيارة غداً')}</h2>
      <p>${ui(lang).hello} <strong>${esc(recipientName)}</strong>${pick(lang, ',', '،')}</p>
      <p>${intro}</p>
      <div style="background:#f0fdf4;border-radius:10px;padding:16px;margin:20px 0;border-${lang === 'ar' ? 'right' : 'left'}:4px solid #0C6E4F">
        <p style="margin:4px 0"><strong>${pick(lang, '🏠 Bien :', '🏠 العقار:')}</strong> ${esc(propertyTitle)}</p>
        <p style="margin:4px 0"><strong>${pick(lang, '📅 Date :', '📅 التاريخ:')}</strong> ${dateStr}</p>
        ${role === 'owner' ? `<p style="margin:4px 0"><strong>${pick(lang, '👤 Visiteur :', '👤 الزائر:')}</strong> ${esc(requesterName)}</p>` : ''}
      </div>
      ${button(propertyUrl, pick(lang, 'Voir l\'annonce', 'عرض الإعلان'), lang)}
    `, lang),
  };
}

function buildNewMessage(lang, { senderName, propertyTitle, preview }) {
  const text = preview.length > 120 ? preview.slice(0, 120) + '…' : preview;
  return {
    subject: pick(lang, `💬 Nouveau message de ${senderName}`, `💬 رسالة جديدة من ${senderName}`),
    html: wrap(`
      <h2 style="margin-top:0">${pick(lang, 'Vous avez un nouveau message', 'لديك رسالة جديدة')}</h2>
      <p>${pick(lang,
        `<strong>${esc(senderName)}</strong> vous a envoyé un message concernant <strong>${esc(propertyTitle)}</strong> :`,
        `أرسل لك <strong>${esc(senderName)}</strong> رسالة بخصوص <strong>${esc(propertyTitle)}</strong>:`)}</p>
      <div style="background:#f9f9f9;border-${lang === 'ar' ? 'right' : 'left'}:4px solid #0C6E4F;padding:12px 16px;border-radius:8px;margin:16px 0;font-style:italic;color:#444">
        "${esc(text)}"
      </div>
      ${button(siteUrl(), pick(lang, 'Répondre sur DzImmo', 'الرد على DzImmo'), lang)}
    `, lang),
  };
}

function buildSearchAlert(lang, { name, properties, alertCriteria }) {
  const n = properties.length;
  const criteria = [
    wilayaName(lang, alertCriteria.wilaya),
    MODES[lang === 'ar' ? 'ar' : 'fr'][alertCriteria.mode] || MODES[lang === 'ar' ? 'ar' : 'fr'].all,
    TYPES[lang === 'ar' ? 'ar' : 'fr'][alertCriteria.type_bien] || TYPES[lang === 'ar' ? 'ar' : 'fr'].all,
  ].join(' · ');
  const u = ui(lang);
  const priceAlign = lang === 'ar' ? 'left' : 'right';
  const rows = properties.map(p => `
    <tr>
      <td style="padding:.6rem .5rem;border-bottom:1px solid #f0f0f0">
        <strong>${esc(p.title)}</strong><br>
        <span style="font-size:.83rem;color:#666">${esc(wilayaName(lang, p.wilaya))}</span>
      </td>
      <td style="padding:.6rem .5rem;border-bottom:1px solid #f0f0f0;text-align:${priceAlign};white-space:nowrap;font-weight:700;color:#0C6E4F">
        ${fmt(p.price)} ${u.dzd}
      </td>
    </tr>`).join('');
  return {
    subject: `🔔 ${n} ${newAds(lang, n)} — ${criteria}`,
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, '🔔 Nouvelles annonces pour votre alerte', '🔔 إعلانات جديدة لتنبيهك')}</h2>
      <p>${u.hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang,
        `<strong>${n}</strong> ${newAds(lang, n)} correspond${n > 1 ? 'ent' : ''} à votre alerte :`,
        `<strong>${n}</strong> ${newAds(lang, n)} تطابق تنبيهك:`)}</p>
      <div style="background:#f0fdf4;border-radius:8px;padding:8px 14px;margin:12px 0;font-size:.88rem;color:#0C6E4F;font-weight:600">
        ${esc(criteria)}
      </div>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">${rows}</table>
      <div style="text-align:center;margin:20px 0">
        ${button(siteUrl(), pick(lang, 'Voir toutes les annonces', 'عرض جميع الإعلانات'), lang)}
      </div>
      <p style="font-size:.8rem;color:#aaa;margin-top:1.5rem">${pick(lang,
        'Vous recevez cet email car vous avez activé une alerte sur DzImmo. Gérez vos alertes depuis votre espace personnel.',
        'وصلتك هذه الرسالة لأنك فعّلت تنبيهاً على DzImmo. يمكنك إدارة تنبيهاتك من مساحتك الشخصية.')}</p>
    `, lang),
  };
}

function buildModerationDecision(lang, { name, propertyTitle, approved, reason, url }) {
  const shownReason = translateReason(reason, lang);
  return {
    subject: approved
      ? pick(lang, `✅ Votre annonce est publiée — ${propertyTitle}`, `✅ تم نشر إعلانك — ${propertyTitle}`)
      : pick(lang, `❌ Votre annonce a été refusée — ${propertyTitle}`, `❌ تم رفض إعلانك — ${propertyTitle}`),
    html: wrap(approved ? `
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Votre annonce est en ligne ✅', 'إعلانك منشور الآن ✅')}</h2>
      <p>${ui(lang).hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang,
        `Bonne nouvelle : votre annonce <strong>${esc(propertyTitle)}</strong> a été validée par notre équipe et est maintenant visible par tous les visiteurs.`,
        `خبر سار: تمت الموافقة على إعلانك <strong>${esc(propertyTitle)}</strong> من طرف فريقنا وأصبح ظاهراً لجميع الزوار.`)}</p>
      ${button(url, pick(lang, 'Voir mon annonce', 'عرض إعلاني'), lang)}
    ` : `
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Votre annonce a été refusée', 'تم رفض إعلانك')}</h2>
      <p>${ui(lang).hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang,
        `Après vérification, votre annonce <strong>${esc(propertyTitle)}</strong> n'a pas pu être publiée.`,
        `بعد المراجعة، تعذّر نشر إعلانك <strong>${esc(propertyTitle)}</strong>.`)}</p>
      <div style="background:#fef2f2;border-radius:10px;padding:16px;margin:20px 0;border-${lang === 'ar' ? 'right' : 'left'}:4px solid #dc2626">
        <p style="margin:4px 0"><strong>${pick(lang, 'Motif :', 'السبب:')}</strong> ${esc(shownReason)}</p>
      </div>
      <p>${pick(lang, 'Vous pouvez publier une nouvelle annonce corrigée depuis votre espace DzImmo.', 'يمكنك نشر إعلان جديد بعد تصحيحه من مساحتك في DzImmo.')}</p>
      ${button(siteUrl(), pick(lang, 'Accéder à DzImmo', 'الدخول إلى DzImmo'), lang)}
    `, lang),
  };
}

function buildAdminPending(lang, { ownerName, propertyTitle, url }) {
  return {
    subject: pick(lang, `🛡️ Annonce à valider — ${propertyTitle}`, `🛡️ إعلان في انتظار المراجعة — ${propertyTitle}`),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Une annonce attend votre validation 🛡️', 'إعلان ينتظر مراجعتك 🛡️')}</h2>
      <p>${pick(lang,
        `<strong>${esc(ownerName)}</strong> a publié <strong>${esc(propertyTitle)}</strong>.`,
        `نشر <strong>${esc(ownerName)}</strong> الإعلان <strong>${esc(propertyTitle)}</strong>.`)}</p>
      <p>${pick(lang,
        'Elle n\'est pas visible tant qu\'elle n\'est pas approuvée (Administration → Modération).',
        'لن يكون الإعلان ظاهراً حتى تتم الموافقة عليه (الإدارة ← الإشراف).')}</p>
      ${button(url, pick(lang, 'Ouvrir DzImmo', 'فتح DzImmo'), lang)}
    `, lang),
  };
}


// Vérification d'annonceur : résultat de l'examen du justificatif
function buildVerificationDecision(lang, { name, kind, approved, reason, url }) {
  const shownReason = translateReason(reason, lang);
  const badge = kind === 'business'
    ? pick(lang, 'Professionnel vérifié', 'مهني موثَّق')
    : pick(lang, 'Identité vérifiée', 'الهوية موثَّقة');
  return {
    subject: approved
      ? pick(lang, '✅ Votre compte est vérifié — DzImmo', '✅ تم توثيق حسابك — DzImmo')
      : pick(lang, '❌ Vérification refusée — DzImmo', '❌ تم رفض طلب التوثيق — DzImmo'),
    html: wrap(approved ? `
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Votre compte est vérifié ✅', 'تم توثيق حسابك ✅')}</h2>
      <p>${ui(lang).hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang,
        `Nous avons contrôlé votre justificatif : le badge <strong>« ${badge} »</strong> apparaît désormais sur vos annonces et sur votre profil.`,
        `راجعنا وثيقتك: ستظهر شارة <strong>«${badge}»</strong> الآن على إعلاناتك وملفك الشخصي.`)}</p>
      ${kind === 'business' ? `<p>${pick(lang,
        'Si vous avez une agence enregistrée sur DzImmo, elle est désormais vérifiée et vos annonces sont publiées sans attendre la modération.',
        'إذا كانت لديك وكالة مسجَّلة على DzImmo فقد أصبحت موثَّقة وتُنشر إعلاناتك دون انتظار المراجعة.')}</p>` : ''}
      <p>${pick(lang, 'Votre document a été supprimé de nos serveurs : nous ne conservons que le résultat.', 'تم حذف وثيقتك من خوادمنا: نحتفظ بالنتيجة فقط.')}</p>
      ${button(url, pick(lang, 'Ouvrir DzImmo', 'فتح DzImmo'), lang)}
    ` : `
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Vérification refusée', 'تم رفض طلب التوثيق')}</h2>
      <p>${ui(lang).hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang, 'Nous n\'avons pas pu valider votre justificatif.', 'تعذّر علينا قبول وثيقتك.')}</p>
      <div style="background:#fef2f2;border-radius:10px;padding:16px;margin:20px 0;border-${lang === 'ar' ? 'right' : 'left'}:4px solid #dc2626">
        <p style="margin:4px 0"><strong>${pick(lang, 'Motif :', 'السبب:')}</strong> ${esc(shownReason)}</p>
      </div>
      <p>${pick(lang,
        'Votre document a été supprimé de nos serveurs. Vous pouvez en envoyer un nouveau depuis « Mon espace → Vérification ».',
        'تم حذف وثيقتك من خوادمنا. يمكنك إرسال وثيقة جديدة من «مساحتي ← التوثيق».')}</p>
      ${button(url, pick(lang, 'Ouvrir DzImmo', 'فتح DzImmo'), lang)}
    `, lang),
  };
}

function buildAdminVerificationPending(lang, { ownerName, kind, url }) {
  const what = kind === 'business'
    ? pick(lang, 'un justificatif professionnel', 'وثيقة مهنية')
    : pick(lang, 'une pièce d\'identité', 'وثيقة هوية');
  return {
    subject: pick(lang, `🛡️ Vérification à traiter — ${ownerName}`, `🛡️ طلب توثيق للمراجعة — ${ownerName}`),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Un justificatif attend votre examen 🛡️', 'وثيقة تنتظر مراجعتك 🛡️')}</h2>
      <p>${pick(lang,
        `<strong>${esc(ownerName)}</strong> a envoyé ${what}.`,
        `أرسل <strong>${esc(ownerName)}</strong> ${what}.`)}</p>
      <p>${pick(lang,
        'Il est consultable dans Administration → Vérifications, et supprimé dès votre décision.',
        'يمكن الاطلاع عليها في الإدارة ← التوثيق، وتُحذف فور اتخاذ قرارك.')}</p>
      ${button(url, pick(lang, 'Ouvrir DzImmo', 'فتح DzImmo'), lang)}
    `, lang),
  };
}

// Rappel : l'annonce est-elle toujours disponible ? (lien « en un clic » sans connexion)
function buildExpiryReminder(lang, { name, propertyTitle, days, graceDays, confirmUrl }) {
  return {
    subject: pick(lang, `⏰ Votre annonce est-elle toujours disponible ? — ${propertyTitle}`, `⏰ هل ما زال إعلانك متاحاً؟ — ${propertyTitle}`),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Votre annonce est-elle toujours disponible ?', 'هل ما زال إعلانك متاحاً؟')}</h2>
      <p>${ui(lang).hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang,
        `Vous n'avez pas confirmé l'annonce <strong>${esc(propertyTitle)}</strong> depuis plus de ${Number(days)} jours. Pour que les visiteurs puissent lui faire confiance, dites-nous si le bien est toujours disponible.`,
        `مضى أكثر من ${Number(days)} يوماً دون أن تؤكد الإعلان <strong>${esc(propertyTitle)}</strong>. لكي يثق به الزوار، أخبرنا إن كان العقار ما زال متاحاً.`)}</p>
      <p>${pick(lang,
        `Sans réponse d'ici ${Number(graceDays)} jours, l'annonce sera retirée du site ; vous pourrez la renouveler à tout moment.`,
        `إذا لم تصلنا إجابة خلال ${Number(graceDays)} يوماً فسيُسحب الإعلان من الموقع، ويمكنك تجديده في أي وقت.`)}</p>
      ${button(confirmUrl, pick(lang, 'Répondre en un clic', 'الرد بنقرة واحدة'), lang, true)}
    `, lang),
  };
}

// L'annonce a été retirée faute de confirmation : elle n'est pas supprimée, l'annonceur peut la renouveler
function buildListingExpired(lang, { name, propertyTitle, renewUrl }) {
  return {
    subject: pick(lang, `📦 Votre annonce a été retirée — ${propertyTitle}`, `📦 تم سحب إعلانك — ${propertyTitle}`),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Votre annonce a été retirée', 'تم سحب إعلانك')}</h2>
      <p>${ui(lang).hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang,
        `Faute de confirmation, l'annonce <strong>${esc(propertyTitle)}</strong> n'est plus visible sur le site. Elle n'est pas supprimée.`,
        `لعدم التأكيد، لم يعد الإعلان <strong>${esc(propertyTitle)}</strong> ظاهراً على الموقع. لم يُحذف.`)}</p>
      <p>${pick(lang, 'Si le bien est toujours disponible, remettez-la en ligne en un clic.', 'إذا كان العقار ما زال متاحاً فأعد نشره بنقرة واحدة.')}</p>
      ${button(renewUrl, pick(lang, 'Renouveler mon annonce', 'تجديد إعلاني'), lang, true)}
    `, lang),
  };
}

// Reçu de mise à la une (server/featured.js, activate()) : envoyé au propriétaire dès que le paiement est confirmé.
function buildFeaturedReceipt(lang, { name, propertyTitle, days, amount, featuredUntil, url }) {
  const d = Number(days);
  const daysLabel = pick(lang,
    `${d} ${d > 1 ? 'jours' : 'jour'}`,
    d === 1 ? 'يوم' : d === 2 ? 'يومان' : `${d} أيام`);
  const until = new Date(featuredUntil).toLocaleDateString(lang === 'ar' ? 'ar-DZ' : 'fr-DZ',
    { day: 'numeric', month: 'long', year: 'numeric' });
  const amt = `${fmt(amount)} ${ui(lang).dzd}`;
  return {
    subject: pick(lang, `⭐ Votre annonce est à la une — DzImmo`, `⭐ إعلانك مميَّز الآن — DzImmo`),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Votre annonce est à la une ! ⭐', '⭐ إعلانك مميَّز الآن!')}</h2>
      <p>${ui(lang).hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang,
        `L'annonce <strong>${esc(propertyTitle)}</strong> est mise à la une pour <strong>${esc(daysLabel)}</strong>, jusqu'au ${esc(until)}.`,
        `تم تمييز إعلانك <strong>${esc(propertyTitle)}</strong> لمدة <strong>${esc(daysLabel)}</strong> حتى ${esc(until)}.`)}</p>
      <p style="color:#666">${pick(lang, `Montant réglé : ${amt}`, `المبلغ المدفوع : ${amt}`)}</p>
      ${centered(button(url, pick(lang, 'Voir mon annonce', 'عرض إعلاني'), lang))}
    `, lang),
  };
}

// Alerte aux administrateurs : une annonce refusée avait une mise à la une payante en cours → remboursement manuel.
function buildFeaturedRefundAlert(lang, { propertyTitle, days, amount, featuredUntil, url }) {
  const until = new Date(featuredUntil).toLocaleDateString(lang === 'ar' ? 'ar-DZ' : 'fr-DZ',
    { day: 'numeric', month: 'long', year: 'numeric' });
  const amt = `${fmt(amount)} ${ui(lang).dzd}`;
  return {
    subject: pick(lang, `⚠️ Annonce à la une refusée — remboursement à traiter`, `⚠️ إعلان مميَّز مرفوض — يجب معالجة الاسترداد`),
    html: wrap(`
      <h2 style="color:#b91c1c;margin-top:0">${pick(lang, 'Remboursement à traiter ⚠️', 'يجب معالجة الاسترداد ⚠️')}</h2>
      <p>${pick(lang,
        `L'annonce <strong>${esc(propertyTitle)}</strong> a été <strong>refusée</strong> alors qu'une mise à la une payante (${Number(days)} j, ${amt}) est active jusqu'au ${esc(until)}.`,
        `تم <strong>رفض</strong> الإعلان <strong>${esc(propertyTitle)}</strong> بينما الإعلان المميَّز (${Number(days)} أيام، ${amt}) نشط حتى ${esc(until)}.`)}</p>
      <p>${pick(lang, 'Traitez le remboursement manuellement.', 'عالج الاسترداد يدوياً.')}</p>
      ${centered(button(url, pick(lang, "Ouvrir l'administration", 'فتح الإدارة'), lang))}
    `, lang),
  };
}

// Baisse de prix d'une annonce en favoris (server/price-drop.js). Les prix et le pourcentage arrivent en nombres : tout est forcé en nombre.
function buildPriceDrop(lang, { name, propertyTitle, oldPrice, newPrice, percent, url }) {
  const u = ui(lang);
  return {
    subject: pick(lang, `📉 Prix en baisse (−${Number(percent)} %) — ${propertyTitle}`, `📉 انخفاض في السعر (−${Number(percent)}٪) — ${propertyTitle}`),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Un bien de vos favoris baisse son prix', 'عقار في مفضلتك خفّض سعره')}</h2>
      <p>${u.hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang,
        `Le prix de <strong>${esc(propertyTitle)}</strong> vient de baisser de ${Number(percent)} %.`,
        `انخفض سعر <strong>${esc(propertyTitle)}</strong> بنسبة ${Number(percent)}٪.`)}</p>
      <div style="background:#f0fdf4;border-radius:8px;padding:12px 16px;margin:14px 0;font-size:1.05rem">
        <span style="color:#888;text-decoration:line-through">${fmt(oldPrice)} ${u.dzd}</span>
        &nbsp;${u.arrow}&nbsp;
        <strong style="color:#0C6E4F">${fmt(newPrice)} ${u.dzd}</strong>
      </div>
      ${centered(button(url, pick(lang, "Voir l'annonce", 'عرض الإعلان'), lang, true))}
      <p style="font-size:.8rem;color:#aaa;margin-top:1.5rem">${pick(lang,
        'Vous recevez cet email car cette annonce est dans vos favoris. Pour ne plus recevoir ces alertes, décochez « Alertes de baisse de prix » dans Mon compte → Profil.',
        'وصلتك هذه الرسالة لأن هذا الإعلان في مفضلتك. لإيقاف هذه التنبيهات ألغِ تحديد «تنبيهات انخفاض الأسعار» في حسابي ← الملف الشخصي.')}</p>
    `, lang),
  };
}

// Message du formulaire de la page Contact, adressé à l'équipe du site (langue de l'administrateur destinataire).
// Tout ce qui vient du visiteur passe par esc() ; son adresse sert d'adresse de réponse (replyTo), jamais d'expéditeur.
const CONTACT_SUBJECTS = {
  fr: { info: 'Renseignement général', annonce: 'Problème avec une annonce', compte: 'Mon compte', partenariat: 'Partenariat / Agence', autre: 'Autre' },
  ar: { info: 'استفسار عام', annonce: 'مشكلة مع إعلان', compte: 'حسابي', partenariat: 'شراكة / وكالة', autre: 'أخرى' },
};
function buildSiteContact(lang, { name, email, subject, message }) {
  const topic = CONTACT_SUBJECTS[lang === 'ar' ? 'ar' : 'fr'][subject] || CONTACT_SUBJECTS[lang === 'ar' ? 'ar' : 'fr'].autre;
  return {
    subject: pick(lang, `✉️ Message du site — ${topic}`, `✉️ رسالة من الموقع — ${topic}`),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Nouveau message depuis la page Contact ✉️', 'رسالة جديدة من صفحة الاتصال ✉️')}</h2>
      <p>${pick(lang, 'De', 'من')} : <strong>${esc(name)}</strong> &lt;${esc(email)}&gt;<br>
         ${pick(lang, 'Sujet', 'الموضوع')} : <strong>${esc(topic)}</strong></p>
      <p style="white-space:pre-wrap;background:#f7f7f7;border-radius:8px;padding:12px">${esc(message)}</p>
      <p style="color:#777;font-size:13px">${pick(lang,
        'Répondez directement à cet email : la réponse part vers l’adresse du visiteur.',
        'يمكنك الرد مباشرة على هذه الرسالة: سيصل الرد إلى عنوان الزائر.')}</p>
    `, lang),
  };
}

// Newsletter (server/newsletter.js) : email de double confirmation, puis envois rédigés par un administrateur.
function buildNewsletterConfirm(lang, { confirmUrl }) {
  return {
    subject: pick(lang, '📧 Confirmez votre inscription à la newsletter — DzImmo', '📧 أكِّد اشتراكك في النشرة البريدية — DzImmo'),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Confirmez votre inscription', 'أكِّد اشتراكك')}</h2>
      <p>${pick(lang,
        'Vous (ou quelqu’un utilisant votre adresse) avez demandé à recevoir la newsletter de DzImmo : les nouveautés du site et des conseils immobiliers.',
        'لقد طلبتَ (أو طلب شخص ما باستعمال بريدك الإلكتروني) استلام النشرة البريدية لـ DzImmo: أخبار الموقع ونصائح عقارية.')}</p>
      ${centered(button(confirmUrl, pick(lang, 'Confirmer mon inscription', 'تأكيد اشتراكي'), lang, true))}
      <p style="font-size:13px;color:#666">${pick(lang,
        'Sans confirmation de votre part, vous ne recevrez rien et votre adresse sera effacée sous 7 jours. Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet email.',
        'إن لم تؤكّد، فلن تتلقى شيئاً وسيُمسح عنوانك خلال 7 أيام. إذا لم تكن صاحب هذا الطلب، تجاهل هذه الرسالة.')}</p>
    `, lang),
  };
}

// `subject` et `body` sont saisis par un administrateur (texte simple : lignes vides = paragraphes) ; tout passe par esc().
// Chaque envoi porte le lien de désinscription (obligation du consentement : loi 18-07, RGPD).
function buildNewsletter(lang, { subject, body, unsubscribeUrl }) {
  const paragraphs = String(body ?? '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)
    .map(x => `<p style="white-space:pre-line;line-height:1.7;color:#333">${esc(x)}</p>`).join('');
  return {
    subject: String(subject ?? ''),
    html: wrap(`
      ${paragraphs}
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0 14px">
      <p style="font-size:12px;color:#888;line-height:1.6">${pick(lang,
        'Vous recevez cet email car vous êtes inscrit(e) à la newsletter de DzImmo.',
        'تصلك هذه الرسالة لأنك مشترك في النشرة البريدية لـ DzImmo.')}
        <a href="${esc(unsubscribeUrl)}" style="color:#0C6E4F">${pick(lang, 'Me désinscrire', 'إلغاء الاشتراك')}</a></p>
    `, lang),
  };
}

// Résumé quotidien des baisses de prix sur les favoris (server/price-drop.js, sendPriceDropDigest).
// `drops` : tableau de { propertyTitle, oldPrice, newPrice, percent, url }.
function buildPriceDropDigest(lang, { name, drops }) {
  const rows = drops.map(d => {
    const pct = Number(d.percent);
    const cur = ui(lang).dzd;
    return `<tr>
      <td style="padding:.35rem .7rem"><a href="${esc(d.url)}" style="color:#0C6E4F;text-decoration:none">${esc(d.propertyTitle)}</a></td>
      <td style="padding:.35rem .7rem;text-align:center;color:#0C6E4F;font-weight:700">↓ ${pct}%</td>
      <td style="padding:.35rem .7rem;text-decoration:line-through;color:#999">${fmt(d.oldPrice)} ${cur}</td>
      <td style="padding:.35rem .7rem;font-weight:700;color:#0C6E4F">${fmt(d.newPrice)} ${cur}</td>
    </tr>`;
  }).join('');
  const n = drops.length;
  return {
    subject: pick(lang,
      `📉 ${n} baisse${n > 1 ? 's' : ''} de prix sur vos favoris — DzImmo`,
      `📉 ${n} انخفاض${n > 2 ? 'ات' : (n === 2 ? 'ان' : '')} في مفضلتك — DzImmo`),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Baisses de prix du jour 📉', 'تخفيضات أسعار اليوم 📉')}</h2>
      <p>${ui(lang).hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang, 'Ces biens de vos favoris ont baissé leur prix :', 'انخفضت أسعار هذه العقارات من مفضلتك:')}</p>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
      </div>
      ${centered(button(`${siteUrl()}/#favoris`, pick(lang, 'Voir mes favoris', 'عرض المفضلة'), lang))}
      <p style="font-size:.8rem;color:#aaa;margin-top:1.5rem">${pick(lang,
        'Vous recevez cet email car ces annonces sont dans vos favoris. Pour couper les alertes, décochez « Alertes de baisse de prix » dans Mon compte → Profil.',
        'تصلك هذه الرسالة لأن هذه الإعلانات في مفضلتك. لإيقاف التنبيهات ألغِ تحديد «تنبيهات انخفاض الأسعار» في حسابي.')}</p>
    `, lang),
  };
}

// ── Envoi ────────────────────────────────────────────────────────────────────
// Chaque fonction reçoit `lang` (langue du destinataire) ; sans lang : français.
const send = (to, built) => sendMail({ to, ...built });

const mailWelcome = d => send(d.email, buildWelcome(d.lang, d));
const mailVerifyEmail = d => send(d.email, buildVerifyEmail(d.lang, d));
const mailPasswordReset = d => send(d.email, buildPasswordReset(d.lang, d));
const mailContactRequest  = d => send(d.ownerEmail, buildContactRequest(d.lang, d));
const mailVisitReminder   = d => send(d.email, buildVisitReminder(d.lang, d));
// Annonce remise en modération après plusieurs signalements : le propriétaire est prévenu, sans savoir qui a signalé
function buildListingReported(lang, { name, propertyTitle, url }) {
  return {
    subject: pick(lang, `⚠️ Votre annonce est en cours de vérification — ${propertyTitle}`, `⚠️ إعلانك قيد المراجعة — ${propertyTitle}`),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Votre annonce est en cours de vérification ⚠️', 'إعلانك قيد المراجعة ⚠️')}</h2>
      <p>${ui(lang).hello} <strong>${esc(name)}</strong>${pick(lang, ',', '،')}</p>
      <p>${pick(lang,
        `Plusieurs membres ont signalé votre annonce <strong>${esc(propertyTitle)}</strong>. Elle a été retirée du site le temps que notre équipe la vérifie.`,
        `قام عدة أعضاء بالإبلاغ عن إعلانك <strong>${esc(propertyTitle)}</strong>. تم سحبه من الموقع إلى حين مراجعته من طرف فريقنا.`)}</p>
      <p>${pick(lang,
        'Si elle est conforme, elle sera remise en ligne. Vous serez prévenu de la décision. Vérifiez en attendant que le prix, les photos et la disponibilité sont exacts.',
        'إذا كان الإعلان مطابقاً فسيُعاد نشره وسيتم إعلامك بالقرار. تأكد في الأثناء من صحة السعر والصور والتوفر.')}</p>
      ${button(url, pick(lang, 'Voir mon annonce', 'عرض إعلاني'), lang)}
    `, lang),
  };
}

// Les administrateurs sont prévenus qu'une annonce a été retirée automatiquement
function buildAdminReported(lang, { propertyTitle, count, url }) {
  return {
    subject: pick(lang, `🚩 Annonce signalée et retirée — ${propertyTitle}`, `🚩 إعلان تم الإبلاغ عنه وسحبه — ${propertyTitle}`),
    html: wrap(`
      <h2 style="color:#222;margin-top:0">${pick(lang, 'Une annonce a été retirée après signalements 🚩', 'تم سحب إعلان بعد بلاغات 🚩')}</h2>
      <p>${pick(lang,
        `<strong>${esc(propertyTitle)}</strong> a été signalée par ${Number(count)} membres différents. Elle est repassée en modération.`,
        `تم الإبلاغ عن <strong>${esc(propertyTitle)}</strong> من طرف ${Number(count)} أعضاء مختلفين. وعاد الإعلان إلى قائمة المراجعة.`)}</p>
      <p>${pick(lang,
        'Examinez les signalements (Administration → Signalements), puis approuvez ou refusez l\'annonce (Administration → Modération).',
        'راجع البلاغات (الإدارة ← البلاغات) ثم وافق على الإعلان أو ارفضه (الإدارة ← الإشراف).')}</p>
      ${button(url, pick(lang, 'Ouvrir DzImmo', 'فتح DzImmo'), lang)}
    `, lang),
  };
}

// Alerte de supervision (server/monitor.js) : panne du serveur, tâche planifiée ou sauvegarde en échec. `detail` est le message technique
// de l'erreur (déjà expurgé des adresses email et numéros par monitor.js), donné tel quel : il n'a pas de traduction.
const ALERT_KINDS = {
  fr: { crash: 'Le serveur a planté', http: 'Erreur interne du serveur (500)', cron: 'Une tâche planifiée a échoué', backup: 'La sauvegarde de la base a échoué' },
  ar: { crash: 'توقف الخادم عن العمل', http: 'خطأ داخلي في الخادم (500)', cron: 'فشلت مهمة مجدولة', backup: 'فشل النسخ الاحتياطي لقاعدة البيانات' },
};
function buildAlert(lang, { kind, name, detail }) {
  const family = String(kind).split(':')[0];
  const title = (ALERT_KINDS[lang === 'ar' ? 'ar' : 'fr'][family]) || ALERT_KINDS.fr.http;
  return {
    subject: pick(lang, `🚨 DzImmo — ${title}`, `🚨 DzImmo — ${title}`) + (name ? ` (${name})` : ''),
    html: wrap(`
      <h2 style="color:#b91c1c;margin-top:0">${esc(title)} 🚨</h2>
      ${name ? `<p>${pick(lang, 'Élément concerné', 'العنصر المعني')} : <strong dir="ltr">${esc(name)}</strong></p>` : ''}
      <p dir="ltr" style="font-family:monospace;background:#f7f7f7;border-radius:8px;padding:12px;word-break:break-word;text-align:left">${esc(detail)}</p>
      <p style="color:#777;font-size:13px">${pick(lang,
        'Les détails complets sont dans les journaux du serveur (pm2 logs dzimmo). Une panne qui se répète n’envoie qu’une alerte par heure.',
        'التفاصيل الكاملة في سجلات الخادم (pm2 logs dzimmo). إذا تكرر العطل فلن تصل إلا رسالة تنبيه واحدة في الساعة.')}</p>
    `, lang),
  };
}

// Avis de sécurité sur la double authentification (server/routes/two-factor.js) : activée, désactivée, code de secours utilisé,
// nouveaux codes de secours. Envoyé à chaque fois : si ce n'est pas le titulaire, il le voit tout de suite.
const SECURITY_EVENTS = {
  enabled:  { fr: ['Double authentification activée', 'La double authentification vient d’être activée sur votre compte DzImmo. Vos autres sessions ont été fermées : un code de votre application sera demandé à chaque connexion.'],
              ar: ['تم تفعيل التحقق بخطوتين', 'تم تفعيل التحقق بخطوتين على حسابك في DzImmo. أُغلقت جلساتك الأخرى، وسيُطلب منك رمز من تطبيق المصادقة عند كل تسجيل دخول.'] },
  disabled: { fr: ['Double authentification désactivée', 'La double authentification vient d’être désactivée sur votre compte DzImmo. Vos autres sessions ont été fermées.'],
              ar: ['تم إيقاف التحقق بخطوتين', 'تم إيقاف التحقق بخطوتين على حسابك في DzImmo. أُغلقت جلساتك الأخرى.'] },
  recovery: { fr: ['Code de secours utilisé', 'Un code de secours vient de servir à vous connecter à votre compte DzImmo. Ce code ne fonctionne plus. Pensez à générer de nouveaux codes lorsqu’il en reste peu.'],
              ar: ['استُخدم رمز احتياطي', 'استُخدم رمز احتياطي لتسجيل الدخول إلى حسابك في DzImmo، ولن يعمل هذا الرمز مرة أخرى. أنشئ رموزاً جديدة عندما يتبقى القليل منها.'] },
  codes:    { fr: ['Nouveaux codes de secours', 'De nouveaux codes de secours viennent d’être générés pour votre compte DzImmo. Les anciens codes ne fonctionnent plus.'],
              ar: ['رموز احتياطية جديدة', 'تم إنشاء رموز احتياطية جديدة لحسابك في DzImmo، ولم تعد الرموز القديمة تعمل.'] },
};
function buildSecurityNotice(lang, { name, event }) {
  const [title, body] = SECURITY_EVENTS[event][lang === 'ar' ? 'ar' : 'fr'];
  return {
    subject: `🔐 DzImmo — ${title}`,
    html: wrap(`
      <h2 style="margin-top:0">${esc(title)} 🔐</h2>
      <p>${pick(lang, 'Bonjour', 'مرحباً')} ${esc(name)},</p>
      <p>${esc(body)}</p>
      <p style="color:#b91c1c"><strong>${pick(lang,
        'Ce n’était pas vous ? Changez immédiatement votre mot de passe (« Mot de passe oublié ») et contactez l’équipe DzImmo.',
        'لم تكن أنت؟ غيّر كلمة المرور فوراً (« نسيت كلمة المرور ») وتواصل مع فريق DzImmo.')}</strong></p>
    `, lang),
  };
}

const mailAlert             = d => send(d.to, buildAlert(d.lang, d));
const mailPriceDrop         = d => send(d.to, buildPriceDrop(d.lang, d));
const mailFeaturedReceipt   = d => send(d.to, buildFeaturedReceipt(d.lang, d));
const mailFeaturedRefundAlert = d => send(d.to, buildFeaturedRefundAlert(d.lang, d));
const mailPriceDropDigest   = d => send(d.to, buildPriceDropDigest(d.lang, d));
const mailSecurityNotice = d => send(d.to, buildSecurityNotice(d.lang, d));
const mailListingReported = d => send(d.to, buildListingReported(d.lang, d));
const mailAdminReported = d => send(d.to, buildAdminReported(d.lang, d));
const mailNewMessage = d => send(d.to, buildNewMessage(d.lang, d));
const mailSearchAlert = d => send(d.email, buildSearchAlert(d.lang, d));
const mailModerationDecision = d => send(d.to, buildModerationDecision(d.lang, d));
const mailAdminPending = d => send(d.to, buildAdminPending(d.lang, d));
const mailVerificationDecision = d => send(d.to, buildVerificationDecision(d.lang, d));
const mailExpiryReminder = d => send(d.to, buildExpiryReminder(d.lang, d));
const mailListingExpired = d => send(d.to, buildListingExpired(d.lang, d));
const mailAdminVerificationPending = d => send(d.to, buildAdminVerificationPending(d.lang, d));
const mailSiteContact = d => sendMail({ to: d.to, replyTo: d.email, ...buildSiteContact(d.lang, d) });
const mailNewsletterConfirm = d => send(d.to, buildNewsletterConfirm(d.lang, d));
// En-têtes List-Unsubscribe (RFC 8058) : les messageries proposent leur propre bouton « Se désabonner », qui appelle oneClickUrl en POST
const mailNewsletter = d => sendMail({ to: d.to, ...buildNewsletter(d.lang, d),
  headers: { 'List-Unsubscribe': `<${d.oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });

module.exports = {
  sendMail, sender, siteUrl, configured, FROM_OK, EMAIL_OK,
  mailWelcome, mailVerifyEmail, mailPasswordReset,
  mailContactRequest, mailVisitReminder, mailNewMessage, mailSearchAlert,
  mailModerationDecision, mailAdminPending, mailVerificationDecision, mailAdminVerificationPending,
  mailExpiryReminder, mailListingExpired, mailListingReported, mailAdminReported, mailAlert, mailPriceDrop, mailSecurityNotice, mailSiteContact, mailNewsletterConfirm, mailNewsletter, CONTACT_SUBJECTS,
  mailFeaturedReceipt, mailFeaturedRefundAlert, mailPriceDropDigest,
  // gabarits purs (tests)
  build: { buildWelcome, buildVerifyEmail, buildPasswordReset, buildContactRequest, buildNewMessage,
           buildSearchAlert, buildModerationDecision, buildAdminPending,
           buildVerificationDecision, buildAdminVerificationPending, buildExpiryReminder, buildListingExpired, buildSiteContact, buildNewsletterConfirm, buildNewsletter,
           buildListingReported, buildAdminReported, buildAlert, buildPriceDrop, buildSecurityNotice, buildVisitReminder,
           buildFeaturedReceipt, buildFeaturedRefundAlert, buildPriceDropDigest },
};
