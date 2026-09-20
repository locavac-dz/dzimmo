// ── Messages d'erreur de l'API en arabe ──────────────────────────────────────
// Les routes écrivent leurs erreurs en français (res.status(400).json({ error: '…' })).
// Ce middleware lit la langue demandée (en-tête X-Lang envoyé par le site, sinon Accept-Language)
// et traduit le message au dernier moment. Un message sans traduction reste en français.
// Le test tests/unit/i18n-errors.test.js vérifie que chaque message du serveur figure ici.

const AR = {
  // Limitation de débit et erreurs générales
  'Trop de tentatives. Réessayez dans 15 minutes.': 'محاولات كثيرة جداً. أعد المحاولة بعد 15 دقيقة.',
  "Trop d'uploads. Réessayez dans 1 heure.": 'عدد كبير من عمليات الرفع. أعد المحاولة بعد ساعة.',
  'Trop de requêtes. Réessayez dans une minute.': 'طلبات كثيرة جداً. أعد المحاولة بعد دقيقة.',
  'Erreur interne du serveur.': 'خطأ داخلي في الخادم.',
  'Route introuvable.': 'المسار غير موجود.',

  // Expiration et qualité des annonces
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

  // Alertes, favoris, newsletter
  'Maximum 5 alertes autorisées par compte.': 'الحد الأقصى 5 تنبيهات لكل حساب.',
  'Alerte introuvable.': 'التنبيه غير موجود.',
  'property_id requis.': 'معرّف الإعلان مطلوب.',
  'Déjà dans les favoris.': 'موجود بالفعل في المفضلة.',
  'Email et token requis.': 'البريد الإلكتروني والرمز مطلوبان.',
  'Token invalide.': 'رمز غير صالح.',

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

  // Envoi de photos
  'Aucun fichier reçu.': 'لم يتم استلام أي ملف.',
  "Erreur lors du traitement de l'image.": 'خطأ أثناء معالجة الصورة.',
  'Erreur lors du traitement des images.': 'خطأ أثناء معالجة الصور.',
  'Format non supporté. Utilisez JPEG, PNG ou WebP.': 'صيغة غير مدعومة. استعمل JPEG أو PNG أو WebP.',
  'Fichier trop volumineux (10 Mo maximum).': 'الملف كبير جداً (10 ميغابايت كحد أقصى).',
  'Trop de fichiers (10 maximum).': 'عدد الملفات كبير جداً (10 كحد أقصى).',
  'Fichier inattendu.': 'ملف غير متوقع.',
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
