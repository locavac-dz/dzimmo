// ── Notifications temps réel (WebSocket) en français et en arabe ─────────────
// Le texte est rédigé au moment de l'envoi, dans la langue du destinataire (users.lang).
// Les emails ont leurs propres gabarits dans server/mailer.js.

const NOTIFS = {
  fr: {
    contact_new:       { title: 'Nouvelle demande de contact', body: '{name} a envoyé une demande pour « {title} »' },
    contact_confirmed: { title: 'Demande confirmée !',         body: 'Votre demande pour « {title} » a été confirmée.' },
    contact_rejected:  { title: 'Demande refusée',             body: 'Votre demande pour « {title} » a été refusée.' },
    mod_pending:       { title: 'Annonce à valider',           body: '« {title} » attend une validation.' },
    mod_approved:      { title: 'Annonce publiée',             body: '« {title} » est maintenant visible sur DzImmo.' },
    mod_rejected:      { title: 'Annonce refusée',             body: '« {title} » a été refusée : {reason}' },
  },
  ar: {
    contact_new:       { title: 'طلب تواصل جديد',              body: 'أرسل {name} طلباً بخصوص « {title} »' },
    contact_confirmed: { title: 'تم تأكيد طلبك!',              body: 'تم تأكيد طلبك بخصوص « {title} ».' },
    contact_rejected:  { title: 'تم رفض طلبك',                 body: 'تم رفض طلبك بخصوص « {title} ».' },
    mod_pending:       { title: 'إعلان في انتظار المراجعة',    body: 'الإعلان « {title} » في انتظار المراجعة.' },
    mod_approved:      { title: 'تم نشر الإعلان',              body: 'الإعلان « {title} » ظاهر الآن على DzImmo.' },
    mod_rejected:      { title: 'تم رفض الإعلان',              body: 'تم رفض الإعلان « {title} »: {reason}' },
  },
};

// Motifs de refus proposés à l'administrateur (public/index.html, MOD_REASONS) : traduits pour les propriétaires arabophones.
// Une précision libre ajoutée après « — » reste telle que saisie.
const REASONS_AR = {
  'Photos absentes ou de mauvaise qualité': 'الصور غائبة أو رديئة الجودة',
  'Description insuffisante ou trompeuse': 'الوصف غير كافٍ أو مضلِّل',
  'Prix incohérent avec le bien': 'السعر غير منطقي بالنسبة للعقار',
  'Coordonnées personnelles dans le texte ou les photos': 'معلومات اتصال شخصية في النص أو الصور',
  'Annonce en double': 'إعلان مكرَّر',
  'Contenu non conforme aux CGU': 'محتوى مخالف لشروط الاستخدام',
};

const normalize = lang => (lang === 'ar' ? 'ar' : 'fr');

function translateReason(reason, lang) {
  if (normalize(lang) !== 'ar' || !reason) return reason;
  const [preset, ...rest] = String(reason).split(' — ');
  return [REASONS_AR[preset] || preset, ...rest].join(' — ');
}

// notif('ar', 'contact_new', { name, title }) -> { title, body }
function notif(lang, key, params = {}) {
  const t = NOTIFS[normalize(lang)][key];
  const fill = s => s.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
  return { title: fill(t.title), body: fill(t.body) };
}

module.exports = { notif, translateReason, normalize, NOTIFS, REASONS_AR };
