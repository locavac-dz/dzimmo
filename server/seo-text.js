// ── Textes des pages servies par server/seo.js, en français et en arabe ─────────────────────────────────────────
// Le serveur rend le <head> (titre, description, JSON-LD) et la liste crawlable de chaque page : les moteurs de recherche
// n'exécutent pas la SPA, ils doivent donc lire la bonne langue dans le HTML. Les libellés des types, des modes et des
// wilayas suivent ceux du site (TRANSLATIONS de public/app.js, contrôlé par tests/unit/seo-i18n.test.js).
const WILAYAS_AR = require('./wilayas-ar');

const fmtPrice = n => Number(n).toLocaleString('fr-DZ').replace(/[  ]/g, ' ');

const fr = {
  lang: 'fr', locale: 'fr_DZ', dir: 'ltr',
  home: 'Accueil',
  homeTitle: 'DzImmo — Immobilier en Algérie',
  homeDesc: 'Trouvez ou publiez des annonces immobilières en Algérie : appartements, villas, locaux, terrains à vendre ou à louer.',
  all: 'Biens immobiliers', in: 'à',
  type: { appartement: 'Appartement', villa: 'Villa', maison: 'Maison', bureau: 'Bureau',
          local_commercial: 'Local commercial', terrain: 'Terrain', ferme: 'Ferme', entrepot: 'Entrepôt' },
  typePlural: { appartement: 'Appartements', villa: 'Villas', maison: 'Maisons', bureau: 'Bureaux',
                local_commercial: 'Locaux commerciaux', terrain: 'Terrains', ferme: 'Fermes', entrepot: 'Entrepôts' },
  mode: { vente: 'à vendre', location_longue: 'à louer', location_courte: 'en location saisonnière' },
  wilaya: w => w,
  currency: 'DZD', perMonth: '/mois',
  price: (n, mode) => `${fmtPrice(n)} DZD${mode === 'vente' ? '' : '/mois'}`,
  rooms: n => `${n} pièces`, area: n => `${n} m²`, sep: ', ',
  annonces: n => `${n} annonce${n > 1 ? 's' : ''}`,
  notFound: 'Page introuvable | DzImmo', listingNotFound: 'Annonce introuvable | DzImmo',
  seeAlso: 'Voir aussi',
  landingTitle: (label, count) => count ? `${label} — ${fr.annonces(count)} | DzImmo` : `${label} | DzImmo`,
  landingDesc: (label, count, minp, mode) => count
    ? `${fr.annonces(count)} : ${label} sur DzImmo, à partir de ${fmtPrice(minp)} DZD${mode === 'vente' ? '' : '/mois'}. Photos, prix et contact direct avec le propriétaire ou l'agence.`
    : `Aucune annonce pour le moment : ${label}. Créez une alerte ou publiez votre bien sur DzImmo.`,
  propertyTitle: (title, price) => `${title} — ${price} | DzImmo`,
  agencyLabel: promoter => promoter ? 'Promoteur immobilier' : 'Agence immobilière',
  agencyFacts: (label, a) => `${label} à ${a.wilaya}` + (Number(a.property_count) ? ` · ${fr.annonces(Number(a.property_count))}` : '') +
    (a.review_count ? ` · note ${a.rating}/5 (${a.review_count} avis)` : ''),
  agencyTitle: (name, label, wilaya) => `${name} — ${label} à ${wilaya} | DzImmo`,
  directories: {
    '/agences':    ['Agences immobilières en Algérie | DzImmo', 'Annuaire des agences immobilières en Algérie : annonces, avis et coordonnées, par wilaya.'],
    '/promoteurs': ['Promoteurs immobiliers en Algérie | DzImmo', 'Promoteurs immobiliers vérifiés en Algérie et leurs programmes neufs : appartements sur plan, en construction ou livrés.'],
    '/programmes': ['Programmes immobiliers neufs en Algérie | DzImmo', 'Programmes neufs en Algérie : résidences sur plan, en construction ou livrées, avec prix à partir de et lots disponibles.'],
  },
  directoryCrumb: { '/agences': 'Agences', '/promoteurs': 'Promoteurs', '/programmes': 'Programmes neufs' },
  projectStatus: { sur_plan: 'Sur plan', en_construction: 'En construction', livre: 'Livré' },
  projectDelivery: j => j.delivery_year
    ? (j.status === 'livre' ? `livré en ${j.delivery_year}` : `livraison ${j.delivery_quarter ? 'T' + j.delivery_quarter + ' ' : ''}${j.delivery_year}`) : '',
  projectFacts: (j, place, status, delivery) => [`Programme neuf à ${place}`, status, delivery,
    j.price_from != null && `à partir de ${fmtPrice(j.price_from)} DZD`, `par ${j.agency_name}`].filter(Boolean).join(' · '),
  projectTitle: (name, wilaya) => `${name} — Programme neuf à ${wilaya} | DzImmo`,
  newsletterConfirm: "Confirmation de l’inscription à la newsletter | DzImmo",
  newsletterUnsub: 'Désinscription de la newsletter | DzImmo',
  marketTitle: 'Tendances du marché immobilier en Algérie | DzImmo',
  marketDesc: 'Prix médians au m² par wilaya, évolution sur 30 jours et tendances du marché immobilier algérien.',
  sharedFavsTitle: 'Liste de favoris partagée | DzImmo',
  vendeurTitle: 'Profil du vendeur | DzImmo',
};

const ar = {
  lang: 'ar', locale: 'ar_DZ', dir: 'rtl',
  home: 'الرئيسية',
  homeTitle: 'DzImmo — العقارات في الجزائر',
  homeDesc: 'ابحث عن إعلانات عقارية في الجزائر أو انشر إعلانك: شقق، فيلات، محلات وأراضٍ للبيع أو للإيجار.',
  all: 'عقارات', in: 'في',
  type: { appartement: 'شقة', villa: 'فيلا', maison: 'منزل', bureau: 'مكتب',
          local_commercial: 'محل تجاري', terrain: 'أرض', ferme: 'مزرعة', entrepot: 'مستودع' },
  typePlural: { appartement: 'شقق', villa: 'فيلات', maison: 'منازل', bureau: 'مكاتب',
                local_commercial: 'محلات تجارية', terrain: 'أراضٍ', ferme: 'مزارع', entrepot: 'مستودعات' },
  mode: { vente: 'للبيع', location_longue: 'للإيجار', location_courte: 'للإيجار الموسمي' },
  wilaya: w => WILAYAS_AR[w] || w,
  currency: 'دج', perMonth: '/شهر',
  price: (n, mode) => `${fmtPrice(n)} دج${mode === 'vente' ? '' : '/شهر'}`,
  rooms: n => `${n} غرف`, area: n => `${n} م²`, sep: '، ',
  annonces: n => n === 1 ? 'إعلان واحد' : `${n} إعلانات`,
  notFound: 'الصفحة غير موجودة | DzImmo', listingNotFound: 'الإعلان غير موجود | DzImmo',
  seeAlso: 'اطّلع أيضاً على',
  landingTitle: (label, count) => count ? `${label} — ${ar.annonces(count)} | DzImmo` : `${label} | DzImmo`,
  landingDesc: (label, count, minp, mode) => count
    ? `${ar.annonces(count)}: ${label} على DzImmo، ابتداءً من ${fmtPrice(minp)} دج${mode === 'vente' ? '' : '/شهر'}. صور وأسعار وتواصل مباشر مع المالك أو الوكالة.`
    : `لا توجد إعلانات حالياً: ${label}. أنشئ تنبيهاً أو انشر عقارك على DzImmo.`,
  propertyTitle: (title, price) => `${title} — ${price} | DzImmo`,
  agencyLabel: promoter => promoter ? 'مروّج عقاري' : 'وكالة عقارية',
  agencyFacts: (label, a) => `${label} في ${WILAYAS_AR[a.wilaya] || a.wilaya}` +
    (Number(a.property_count) ? ` · ${ar.annonces(Number(a.property_count))}` : '') +
    (a.review_count ? ` · التقييم ${a.rating}/5 (${a.review_count} تقييم)` : ''),
  agencyTitle: (name, label, wilaya) => `${name} — ${label} في ${wilaya} | DzImmo`,
  directories: {
    '/agences':    ['الوكالات العقارية في الجزائر | DzImmo', 'دليل الوكالات العقارية في الجزائر: إعلانات وتقييمات ومعلومات الاتصال، حسب الولاية.'],
    '/promoteurs': ['المروّجون العقاريون في الجزائر | DzImmo', 'المروّجون العقاريون الموثَّقون في الجزائر ومشاريعهم الجديدة: شقق على المخطط أو قيد الإنجاز أو مسلَّمة.'],
    '/programmes': ['المشاريع العقارية الجديدة في الجزائر | DzImmo', 'المشاريع الجديدة في الجزائر: إقامات على المخطط أو قيد الإنجاز أو مسلَّمة، مع الأسعار ابتداءً من والوحدات المتاحة.'],
  },
  directoryCrumb: { '/agences': 'الوكالات', '/promoteurs': 'المروّجون', '/programmes': 'المشاريع الجديدة' },
  projectStatus: { sur_plan: 'على المخطط', en_construction: 'قيد الإنجاز', livre: 'مسلَّم' },
  projectDelivery: j => j.delivery_year
    ? (j.status === 'livre' ? `سُلِّم سنة ${j.delivery_year}` : `التسليم ${j.delivery_quarter ? 'الفصل ' + j.delivery_quarter + ' من ' : ''}${j.delivery_year}`) : '',
  projectFacts: (j, place, status, delivery) => [`مشروع جديد في ${place}`, status, delivery,
    j.price_from != null && `ابتداءً من ${fmtPrice(j.price_from)} دج`, `من إنجاز ${j.agency_name}`].filter(Boolean).join(' · '),
  projectTitle: (name, wilaya) => `${name} — مشروع جديد في ${wilaya} | DzImmo`,
  newsletterConfirm: 'تأكيد الاشتراك في النشرة البريدية | DzImmo',
  newsletterUnsub: 'إلغاء الاشتراك في النشرة البريدية | DzImmo',
  marketTitle: 'توجهات سوق العقارات في الجزائر | DzImmo',
  marketDesc: 'متوسطات الأسعار بالمتر المربع حسب الولاية، التطور خلال 30 يوماً واتجاهات السوق العقاري الجزائري.',
  sharedFavsTitle: 'قائمة مشتركة من المفضلة | DzImmo',
  vendeurTitle: 'ملف البائع | DzImmo',
};

const TEXT = { fr, ar };
const textOf = lang => TEXT[lang] || fr;

module.exports = { textOf, TEXT, fmtPrice };
