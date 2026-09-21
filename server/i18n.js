// ── Messages d'erreur de l'API en arabe ──────────────────────────────────────
// Les routes écrivent leurs erreurs en français (res.status(400).json({ error: '…' })).
// Ce middleware lit la langue demandée (en-tête X-Lang envoyé par le site, sinon Accept-Language)
// et traduit le message au dernier moment. Un message sans traduction reste en français.
// Le test tests/unit/i18n-errors.test.js vérifie que chaque message du serveur figure ici.

const AR = {
  // Limitation de débit et erreurs générales
  'Trop de tentatives. Réessayez dans 15 minutes.': 'محاولات كثيرة جداً. أعد المحاولة بعد 15 دقيقة.',
  // Double authentification (administrateurs)
  'Double authentification requise.': 'المصادقة الثنائية مطلوبة.',
  "Activez la double authentification pour utiliser l'administration.": 'فعّل المصادقة الثنائية لاستخدام لوحة الإدارة.',
  'Code de vérification incorrect.': 'رمز التحقق غير صحيح.',
  'Code de vérification requis.': 'رمز التحقق مطلوب.',
  'Connexion expirée. Reconnectez-vous.': 'انتهت صلاحية الاتصال. سجّل الدخول من جديد.',
  'La double authentification est déjà activée.': 'المصادقة الثنائية مفعّلة بالفعل.',
  "La double authentification n'est pas activée.": 'المصادقة الثنائية غير مفعّلة.',
  "Lancez d'abord la configuration de la double authentification.": 'ابدأ أولاً بإعداد المصادقة الثنائية.',
  'Mot de passe incorrect.': 'كلمة المرور غير صحيحة.',
  'La double authentification est réservée aux administrateurs.': 'المصادقة الثنائية مخصّصة للمشرفين فقط.',
  "Trop d'uploads. Réessayez dans 1 heure.": 'عدد كبير من عمليات الرفع. أعد المحاولة بعد ساعة.',
  "Trop d'exports. Réessayez dans 1 heure.": 'عدد كبير من عمليات التصدير. أعد المحاولة بعد ساعة.',
  'Trop de messages. Réessayez dans 1 heure.': 'عدد كبير من الرسائل. أعد المحاولة بعد ساعة.',
  'Trop de requêtes. Réessayez dans une minute.': 'طلبات كثيرة جداً. أعد المحاولة بعد دقيقة.',
  'Erreur interne du serveur.': 'خطأ داخلي في الخادم.',
  'Route introuvable.': 'المسار غير موجود.',

  // Vitrine des agences et des promoteurs, programmes neufs
  'Nom invalide (2 à 80 caractères).': 'الاسم غير صالح (من حرفين إلى 80 حرفاً).',
  'Type de professionnel invalide.': 'نوع المهني غير صالح.',
  'Wilaya invalide.': 'الولاية غير صالحة.',
  'Trop de photos (20 maximum).': 'عدد الصور كبير جداً (20 كحد أقصى).',
  'Texte trop long.': 'النص طويل جداً.',
  'Numéro de téléphone invalide.': 'رقم الهاتف غير صالح.',
  'Adresse web invalide (http:// ou https:// attendu).': 'عنوان الويب غير صالح (يجب أن يبدأ بـ http:// أو https://).',
  'Lien de réseau social invalide.': 'رابط الشبكة الاجتماعية غير صالح.',
  'Image invalide : envoyez-la depuis le formulaire.': 'صورة غير صالحة: أرسلها من خلال النموذج.',
  'Lien vidéo invalide : utilisez un lien YouTube ou Vimeo.': 'رابط الفيديو غير صالح: استخدم رابط YouTube أو Vimeo.',
  'Lien de visite virtuelle invalide : utilisez un lien Matterport ou Kuula.': 'رابط الجولة الافتراضية غير صالح: استخدم رابط Matterport أو Kuula.',
  'Année de création invalide.': 'سنة التأسيس غير صالحة.',
  'Services ou zones invalides.': 'الخدمات أو المناطق غير صالحة.',
  "Vous ne pouvez publier qu'au nom de votre propre agence.": 'لا يمكنك النشر إلا باسم وكالتك الخاصة.',
  'Programme introuvable.': 'المشروع غير موجود.',
  "Ce programme n'appartient pas à l'agence choisie.": 'هذا المشروع لا يخص الوكالة المختارة.',
  'Nom du programme invalide (2 à 120 caractères).': 'اسم المشروع غير صالح (من حرفين إلى 120 حرفاً).',
  'Avancement du programme invalide.': 'مرحلة إنجاز المشروع غير صالحة.',
  'Date de livraison invalide.': 'تاريخ التسليم غير صالح.',
  'Nombre de lots invalide.': 'عدد الوحدات غير صالح.',
  'Équipements invalides.': 'المرافق غير صالحة.',
  'Seuls les promoteurs vérifiés peuvent publier un programme.': 'لا يمكن نشر مشروع إلا للمروّجين العقاريين الموثَّقين.',

  // Qualité, expiration et clics
  'Vous avez déjà publié cette annonce.': 'لقد نشرت هذا الإعلان بالفعل.',
  'Ce lien de confirmation est invalide ou a expiré.': 'رابط التأكيد غير صالح أو منتهي الصلاحية.',
  'Cette annonce ne peut pas être renouvelée.': 'لا يمكن تجديد هذا الإعلان.',
  'Action invalide.': 'إجراء غير صالح.',

  // Connexion avec Google
  'Connexion Google indisponible.': 'الدخول عبر Google غير متاح.',
  'Jeton Google invalide.': 'رمز Google غير صالح.',
  'Adresse Google non vérifiée.': 'لم يتم التحقق من عنوان البريد في Google.',
  'Un autre compte Google est déjà associé à cette adresse.': 'يوجد حساب Google آخر مرتبط بهذا العنوان.',

  // Vérification des annonceurs
  'Type de vérification invalide.': 'نوع التوثيق غير صالح.',
  'Type de document invalide.': 'نوع الوثيقة غير صالح.',
  "Numéro du registre de commerce ou de l'agrément requis.": 'رقم السجل التجاري أو الاعتماد مطلوب.',
  'Votre consentement est requis pour examiner le justificatif.': 'موافقتك مطلوبة لمراجعة الوثيقة.',
  'Au moins un justificatif (photo) est requis.': 'وثيقة واحدة على الأقل (صورة) مطلوبة.',
  'Fichier trop volumineux (8 Mo maximum).': 'الملف كبير جداً (8 ميغابايت كحد أقصى).',
  'Trop de fichiers (2 maximum).': 'عدد الملفات كبير جداً (2 كحد أقصى).',
  "Ce justificatif n'est pas une image valide.": 'هذه الوثيقة ليست صورة صالحة.',
  'Votre compte est déjà vérifié.': 'حسابك موثَّق بالفعل.',
  'Une demande de vérification est déjà en cours.': 'يوجد طلب توثيق قيد المعالجة بالفعل.',
  'Justificatif introuvable.': 'الوثيقة غير موجودة.',
  'Demande déjà traitée.': 'تمت معالجة هذا الطلب من قبل.',
  "Ce compte n'est pas vérifié.": 'هذا الحساب غير موثَّق.',
  'Requête invalide (JSON mal formé).': 'طلب غير صالح (JSON غير سليم).',
  'Requête trop volumineuse.': 'الطلب كبير جداً.',

  // Authentification et droits
  'Token manquant.': 'رمز الدخول مفقود.',
  'Token manquant ou invalide.': 'رمز الدخول مفقود أو غير صالح.',
  'Token expiré ou invalide.': 'رمز الدخول منتهي الصلاحية أو غير صالح.',
  'Accès réservé aux administrateurs.': 'الوصول مخصص للمشرفين فقط.',
  'Compte suspendu.': 'الحساب موقوف.',
  'Accès refusé.': 'الوصول مرفوض.',
  'Nom, email et mot de passe obligatoires.': 'الاسم والبريد الإلكتروني وكلمة المرور إلزامية.',
  'Adresse email invalide.': 'عنوان البريد الإلكتروني غير صالح.',
  'Le mot de passe doit contenir au moins 6 caractères.': 'يجب أن تحتوي كلمة المرور على 6 أحرف على الأقل.',
  'Cet email est déjà utilisé.': 'هذا البريد الإلكتروني مستعمل بالفعل.',
  'Email et mot de passe requis.': 'البريد الإلكتروني وكلمة المرور مطلوبان.',
  'Email ou mot de passe incorrect.': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'Ce compte a été suspendu. Contactez le support.': 'تم تعليق هذا الحساب. تواصل مع الدعم.',
  'Utilisateur introuvable.': 'المستخدم غير موجود.',
  'Aucun champ à modifier.': 'لا يوجد أي حقل للتعديل.',
  'Données du profil invalides.': 'بيانات الملف الشخصي غير صالحة.',
  'Email requis.': 'البريد الإلكتروني مطلوب.',
  'Token et mot de passe requis.': 'الرمز وكلمة المرور مطلوبان.',
  'Lien invalide ou expiré.': 'الرابط غير صالح أو منتهي الصلاحية.',

  // Annonces
  'Annonce introuvable.': 'الإعلان غير موجود.',
  'Statut non autorisé.': 'حالة غير مسموح بها.',
  'Statut invalide.': 'حالة غير صالحة.',
  'mode_required': 'نوع العملية مطلوب.',
  "Erreur lors du calcul de l'estimation.": 'خطأ أثناء حساب التقدير.',
  'Champs obligatoires : titre, mode, type, prix, wilaya.': 'الحقول الإلزامية: العنوان، نوع العملية، نوع العقار، السعر، الولاية.',
  'Mode invalide.': 'نوع العملية غير صالح.',
  'Type de bien invalide.': 'نوع العقار غير صالح.',
  "Cette annonce doit d'abord être validée par la modération.": 'يجب أن تتم مراجعة هذا الإعلان أولاً من طرف الإشراف.',
  'URL requise.': 'الرابط مطلوب.',
  'Note entre 1 et 5 requise.': 'التقييم مطلوب، بين 1 و5.',
  'Vous devez avoir une demande de contact confirmée pour laisser un avis.': 'يجب أن يكون لديك طلب تواصل مؤكَّد لترك تقييم.',
  'Vous avez déjà laissé un avis pour ce bien.': 'لقد تركت تقييماً لهذا العقار من قبل.',
  'Motif requis.': 'السبب مطلوب.',

  // Modération et administration
  'Décision invalide.': 'قرار غير صالح.',
  'Un motif de refus (5 caractères minimum) est obligatoire.': 'سبب الرفض إلزامي (5 أحرف على الأقل).',
  'Signalement introuvable.': 'البلاغ غير موجود.',

  // Agences
  'Agence introuvable.': 'الوكالة غير موجودة.',
  'Nom et wilaya requis.': 'الاسم والولاية مطلوبان.',
  'Vous avez déjà une agence enregistrée.': 'لديك وكالة مسجَّلة بالفعل.',
  'Aucune agence trouvée.': 'لم يتم العثور على أي وكالة.',

  // Alertes, favoris
  'Maximum 5 alertes autorisées par compte.': 'الحد الأقصى 5 تنبيهات لكل حساب.',
  'Alerte introuvable.': 'التنبيه غير موجود.',
  'property_id requis.': 'معرّف الإعلان مطلوب.',
  'Déjà dans les favoris.': 'موجود بالفعل في المفضلة.',

  // Page Contact (visiteur → équipe du site)
  'Nom et message requis.': 'الاسم والرسالة مطلوبان.',
  'Nom trop long (100 caractères maximum).': 'الاسم طويل جداً (100 حرف كحد أقصى).',
  'Message trop court (10 caractères minimum).': 'الرسالة قصيرة جداً (10 أحرف على الأقل).',
  'Message trop long (5000 caractères maximum).': 'الرسالة طويلة جداً (5000 حرف كحد أقصى).',
  "Votre message n'a pas pu être envoyé. Réessayez plus tard.": 'تعذّر إرسال رسالتك. أعد المحاولة لاحقاً.',

  // Demandes de contact et messagerie
  'Annonce et type requis.': 'الإعلان ونوع الطلب مطلوبان.',
  'Type invalide.': 'نوع غير صالح.',
  'Vous ne pouvez pas contacter votre propre annonce.': 'لا يمكنك التواصل بخصوص إعلانك الخاص.',
  'Date de visite requise.': 'تاريخ الزيارة مطلوب.',
  "Montant de l'offre requis.": 'مبلغ العرض مطلوب.',
  'Demande introuvable.': 'الطلب غير موجود.',
  'Destinataire, annonce et message requis.': 'المستلم والإعلان والرسالة مطلوبة.',
  'Le message ne peut pas dépasser 2000 caractères.': 'لا يمكن أن تتجاوز الرسالة 2000 حرف.',
  'Vous ne pouvez pas vous envoyer un message.': 'لا يمكنك إرسال رسالة إلى نفسك.',
  'Vous ne pouvez écrire qu\'à l\'annonceur, ou répondre à une personne qui vous a écrit.': 'لا يمكنك المراسلة إلا مع صاحب الإعلان، أو الرد على شخص راسلك.',

  // Recherche géographique
  'Coordonnées invalides.': 'الإحداثيات غير صالحة.',
  'Zone invalide.': 'المنطقة غير صالحة.',

  // Import CSV
  'Fichier CSV requis.': 'ملف CSV مطلوب.',
  'CSV trop long (200 lignes maximum).': 'ملف CSV طويل جداً (200 سطر كحد أقصى).',
  'Fichier CSV vide ou invalide.': 'ملف CSV فارغ أو غير صالح.',
  'CSV trop volumineux (2 Mo maximum).': 'ملف CSV كبير جداً (2 ميغابايت كحد أقصى).',
  'Colonnes requises manquantes.': 'الأعمدة الإلزامية مفقودة.',
  'Prix invalide.': 'السعر غير صالح.',

  // Envoi de photos
  'Aucun fichier reçu.': 'لم يتم استلام أي ملف.',
  "Erreur lors du traitement de l'image.": 'خطأ أثناء معالجة الصورة.',
  'Erreur lors du traitement des images.': 'خطأ أثناء معالجة الصور.',
  'Image illisible ou corrompue.': 'الصورة غير قابلة للقراءة أو تالفة.',
  'Format non supporté. Utilisez JPEG, PNG ou WebP.': 'صيغة غير مدعومة. استعمل JPEG أو PNG أو WebP.',
  'Fichier trop volumineux (10 Mo maximum).': 'الملف كبير جداً (10 ميغابايت كحد أقصى).',
  'Trop de fichiers (10 maximum).': 'عدد الملفات كبير جداً (10 كحد أقصى).',
  'Fichier inattendu.': 'ملف غير متوقع.',

  // Signalements d'annonces
  'Vous ne pouvez pas signaler votre propre annonce.': 'لا يمكنك الإبلاغ عن إعلانك الخاص.',
  'Trop de signalements aujourd’hui. Réessayez demain.': 'بلاغات كثيرة اليوم. أعد المحاولة غداً.',

  // Newsletter
  'Trop de demandes. Réessayez dans 1 heure.': 'طلبات كثيرة جداً. أعد المحاولة بعد ساعة.',
  'Inscription momentanément indisponible. Réessayez plus tard.': 'الاشتراك غير متاح مؤقتاً. أعد المحاولة لاحقاً.',
  'Renseignez le sujet et le texte, au moins dans une langue (une langue commencée doit être complète).': 'أدخل العنوان والنص بلغة واحدة على الأقل (اللغة التي بدأتها يجب أن تكون مكتملة).',
  'Sujet trop long (150 caractères maximum).': 'العنوان طويل جداً (150 حرفاً كحد أقصى).',
  'Texte trop long (10 000 caractères maximum).': 'النص طويل جداً (10 000 حرف كحد أقصى).',
  'Aucun abonné confirmé.': 'لا يوجد أي مشترك مؤكَّد.',
  'Envoi d’emails non configuré sur le serveur.': 'إرسال البريد الإلكتروني غير مُعدّ على الخادم.',
  'L’email de test n’a pas pu être envoyé.': 'تعذّر إرسال رسالة الاختبار.',
  'Campagne introuvable.': 'الحملة غير موجودة.',
};

// Langue demandée : en-tête explicite du site (X-Lang), sinon préférence du navigateur (Accept-Language)
function langOf(req) {
  const explicit = String(req.headers['x-lang'] || '').trim().toLowerCase();
  if (explicit) return explicit === 'ar' ? 'ar' : 'fr';
  return /^\s*ar\b/i.test(String(req.headers['accept-language'] || '')) ? 'ar' : 'fr';
}

const translate = msg => AR[msg] || msg;

// Traduit le champ « error » des réponses d'erreur (statut ≥ 400) ; les réponses de succès ne sont jamais modifiées
function middleware(req, res, next) {
  req.lang = langOf(req);
  // « Explicite » : le site a envoyé X-Lang (choix de l'utilisateur), par opposition à la simple préférence du navigateur
  req.langExplicit = ['fr', 'ar'].includes(String(req.headers['x-lang'] || '').trim().toLowerCase());
  if (req.lang === 'ar') {
    const json = res.json.bind(res);
    res.json = body => json(
      res.statusCode >= 400 && body && typeof body.error === 'string' ? { ...body, error: translate(body.error) } : body);
  }
  next();
}

module.exports = { middleware, translate, langOf, AR };
