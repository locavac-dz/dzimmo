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
    expiry_reminder:   { title: 'Annonce à reconfirmer',       body: '« {title} » est-elle toujours disponible ?' },
    expiry_expired:    { title: 'Annonce retirée',             body: '« {title} » a été retirée faute de confirmation. Vous pouvez la renouveler.' },
    verif_pending:     { title: 'Vérification à traiter',      body: '{name} a envoyé un justificatif à examiner.' },
    verif_approved:    { title: 'Compte vérifié',              body: "{name}, votre compte est vérifié : le badge apparaît sur vos annonces." },
    verif_rejected:    { title: 'Vérification refusée',        body: "{name}, votre demande de vérification a été refusée : {reason}" },
    report_new:        { title: 'Annonce signalée',            body: '« {title} » a reçu un signalement.' },
    report_hidden:     { title: 'Annonce retirée après signalements', body: '« {title} » est repassée en modération.' },
    report_owner:      { title: 'Annonce en cours de vérification',   body: '« {title} » a été signalée et retirée le temps d’une vérification.' },
    price_drop:        { title: 'Prix en baisse',              body: '« {title} » passe à {price} (−{percent} %).' },
  },
  ar: {
    contact_new:       { title: 'طلب تواصل جديد',              body: 'أرسل {name} طلباً بخصوص « {title} »' },
    contact_confirmed: { title: 'تم تأكيد طلبك!',              body: 'تم تأكيد طلبك بخصوص « {title} ».' },
    contact_rejected:  { title: 'تم رفض طلبك',                 body: 'تم رفض طلبك بخصوص « {title} ».' },
    mod_pending:       { title: 'إعلان في انتظار المراجعة',    body: 'الإعلان « {title} » في انتظار المراجعة.' },
    mod_approved:      { title: 'تم نشر الإعلان',              body: 'الإعلان « {title} » ظاهر الآن على DzImmo.' },
    mod_rejected:      { title: 'تم رفض الإعلان',              body: 'تم رفض الإعلان « {title} »: {reason}' },
    expiry_reminder:   { title: 'إعلان يحتاج إلى تأكيد',        body: 'هل ما زال الإعلان « {title} » متاحاً؟' },
    expiry_expired:    { title: 'تم سحب الإعلان',              body: 'تم سحب الإعلان « {title} » لعدم تأكيده. يمكنك تجديده.' },
    verif_pending:     { title: 'طلب توثيق للمراجعة',           body: 'أرسل {name} وثيقة للمراجعة.' },
    verif_approved:    { title: 'تم توثيق الحساب',              body: '{name}، تم توثيق حسابك: ستظهر الشارة على إعلاناتك.' },
    verif_rejected:    { title: 'تم رفض طلب التوثيق',           body: '{name}، تم رفض طلب التوثيق: {reason}' },
    report_new:        { title: 'إعلان تم الإبلاغ عنه',         body: 'تلقّى الإعلان « {title} » بلاغاً.' },
    report_hidden:     { title: 'إعلان سُحب بعد بلاغات',        body: 'عاد الإعلان « {title} » إلى قائمة المراجعة.' },
    report_owner:      { title: 'إعلان قيد المراجعة',           body: 'تم الإبلاغ عن الإعلان « {title} » وسحبه إلى حين مراجعته.' },
    price_drop:        { title: 'انخفاض في السعر',              body: 'أصبح سعر « {title} » {price} (−{percent}٪).' },
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
  'Annonce signalée par plusieurs membres': 'إعلان تم الإبلاغ عنه من طرف عدة أعضاء',
  'Signalement confirmé après vérification': 'تم تأكيد البلاغ بعد المراجعة',
  'Contenu non conforme aux CGU': 'محتوى مخالف لشروط الاستخدام',
  'Justificatif illisible ou incomplet': 'الوثيقة غير مقروءة أو غير مكتملة',
  'Document expiré': 'الوثيقة منتهية الصلاحية',
  'Le nom du document ne correspond pas au compte': 'اسم الوثيقة لا يطابق اسم الحساب',
  'Type de document non conforme': 'نوع الوثيقة غير مطابق',
  'Registre de commerce sans activité immobilière': 'السجل التجاري لا يشمل نشاطاً عقارياً',
  'Document non authentifiable': 'تعذّر التحقق من صحة الوثيقة',
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
