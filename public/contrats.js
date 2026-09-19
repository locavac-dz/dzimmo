// ── Modèles de contrats (FR / AR) ─────────────────────────────────────────────
// Génération 100 % côté navigateur : aucune donnée saisie n'est envoyée au
// serveur ni conservée (loi 18-07). Dépend de T(), currentLang et showPage()
// définis dans index.html.
(function () {
  'use strict';

  const BLANK = '……………………';
  const today = () => new Date().toISOString().slice(0, 10);
  const escH = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Définition des champs ───────────────────────────────────────────────────
  const F = (id, fr, ar, type = 'text', extra = {}) => ({ id, fr, ar, type, ...extra });
  const O = (v, fr, ar) => ({ v, fr, ar });

  const OPT = {
    periodicite: [O('mensuel', 'Mensuel', 'شهري'), O('trimestriel', 'Trimestriel', 'ثلاثي')],
    paiement: [
      O('especes', 'en espèces', 'نقداً'),
      O('virement', 'par virement bancaire ou CCP', 'عن طريق تحويل بنكي أو بريدي (CCP)'),
      O('cheque', 'par chèque', 'بشيك'),
    ],
    frais: [
      O('locataire', 'le locataire', 'المستأجر'),
      O('bailleur', 'le bailleur', 'المؤجّر'),
      O('partage', 'les deux parties à parts égales', 'الطرفان بالتساوي'),
    ],
    bien: [
      O('appartement', 'Appartement', 'شقة'), O('villa', 'Villa', 'فيلا'),
      O('maison', 'Maison', 'منزل'), O('studio', 'Studio', 'استوديو'),
      O('autre', 'Autre', 'آخر'),
    ],
    meuble: [O('non', 'Non meublé', 'غير مفروش'), O('oui', 'Meublé', 'مفروش')],
    etat: [O('', '—', '—'), O('bon', 'Bon', 'جيدة'), O('moyen', 'Moyen', 'متوسطة'), O('mauvais', 'Mauvais', 'سيئة')],
    edl: [O('entree', "État des lieux d'entrée", 'محضر معاينة الدخول'), O('sortie', 'État des lieux de sortie', 'محضر معاينة الخروج')],
    conge: [
      O('locataire', 'Le locataire (je quitte le logement)', 'المستأجر (أرغب في مغادرة العقار)'),
      O('bailleur', 'Le bailleur (je reprends / ne renouvelle pas)', 'المؤجّر (استرجاع العقار / عدم التجديد)'),
    ],
    envoi: [
      O('lrar', 'lettre recommandée avec accusé de réception', 'رسالة موصى عليها مع وصل استلام'),
      O('huissier', "acte d'huissier de justice", 'محضر قضائي'),
    ],
    annulation: [
      O('souple', 'Souple : remboursement intégral jusqu\'à 7 jours avant l\'arrivée', 'مرنة: استرداد كامل حتى 7 أيام قبل الوصول'),
      O('moderee', 'Modérée : remboursement de 50 % jusqu\'à 7 jours avant l\'arrivée', 'معتدلة: استرداد 50% حتى 7 أيام قبل الوصول'),
      O('stricte', "Stricte : acompte non remboursable", 'صارمة: العربون غير قابل للاسترداد'),
    ],
    animaux: [O('non', 'Non admis', 'غير مسموح بها'), O('oui', 'Admis', 'مسموح بها')],
  };

  const person = (p, fr, ar) => ({
    fr, ar,
    fields: [
      F(p + '_nom', 'Nom et prénom', 'الاسم واللقب', 'text', { wide: true }),
      F(p + '_naiss', 'Date de naissance', 'تاريخ الميلاد', 'date'),
      F(p + '_lieu', 'Lieu de naissance', 'مكان الميلاد'),
      F(p + '_cni', "N° carte d'identité / passeport", 'رقم بطاقة التعريف / جواز السفر'),
      F(p + '_tel', 'Téléphone', 'الهاتف', 'tel'),
      F(p + '_adresse', 'Adresse', 'العنوان', 'text', { wide: true }),
    ],
  });

  const bienHabitation = {
    fr: 'Le bien loué', ar: 'العقار المؤجَّر',
    fields: [
      F('bien_adresse', 'Adresse du bien', 'عنوان العقار', 'text', { wide: true }),
      F('bien_wilaya', 'Wilaya', 'الولاية'),
      F('bien_type', 'Type de bien', 'نوع العقار', 'select', { opts: OPT.bien, def: 'appartement' }),
      F('bien_pieces', 'Consistance (ex. F3)', 'المكوّنات (مثال: F3)'),
      F('bien_surface', 'Surface (m²)', 'المساحة (م²)', 'number'),
      F('bien_etage', 'Étage', 'الطابق'),
      F('bien_meuble', 'Ameublement', 'التأثيث', 'select', { opts: OPT.meuble, def: 'non' }),
      F('bien_dep', 'Dépendances (cave, garage, parking…)', 'الملحقات (قبو، مرآب، موقف…)', 'text', { wide: true }),
    ],
  };

  const signature = {
    fr: 'Signature', ar: 'التوقيع',
    fields: [
      F('ville', 'Fait à (ville)', 'حُرّر بـ (المدينة)'),
      F('date_signature', 'Date de signature', 'تاريخ التوقيع', 'date', { def: today() }),
    ],
  };

  // ── Rendu commun ────────────────────────────────────────────────────────────
  function makeCtx(doc, v, lang) {
    const ar = lang === 'ar';
    const X = (fr, a) => (ar ? a : fr);
    const map = {};
    doc.sections.forEach(s => s.fields.forEach(f => { map[f.id] = f; }));
    const g = id => String(v[id] ?? '').trim();
    const blank = `<span class="mc-blank">${BLANK}</span>`;
    const t = id => (g(id) ? `<b><bdi>${escH(g(id)).replace(/\n/g, '<br>')}</bdi></b>` : blank);
    const d = id => {
      const x = g(id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return blank;
      const [y, m, dd] = x.split('-');
      return `<b><bdi dir="ltr">${dd}/${m}/${y}</bdi></b>`;
    };
    const num = n => Number(n).toLocaleString('fr-DZ');
    const m = id => (g(id) && !isNaN(g(id)) ? `<b><bdi dir="ltr">${num(g(id))}</bdi> ${X('DZD', 'د.ج')}</b>` : blank);
    const nb = (id, unit = '') => (g(id) && !isNaN(g(id)) ? `<b><bdi dir="ltr">${num(g(id))}</bdi>${unit}</b>` : blank);
    const sel = id => {
      const o = (map[id]?.opts || []).find(x => x.v === (g(id) || map[id]?.def));
      return o ? `<b>${escH(ar ? o.ar : o.fr)}</b>` : blank;
    };
    const selRaw = id => (map[id]?.opts || []).find(x => x.v === (g(id) || map[id]?.def)) || {};
    return { ar, X, g, t, d, m, nb, sel, selRaw, blank, num };
  }

  const articles = (ar, list) => list.filter(Boolean).map(([title, html], i) =>
    `<div class="mc-art"><h3>${ar ? 'المادة' : 'Article'} ${i + 1} – ${title}</h3><p>${html}</p></div>`).join('');

  const party = (c, p, frRole, arRole, frDef, arDef) => {
    const { X, t, d } = c;
    return c.ar
      ? `<p><b>${arRole}:</b> السيد(ة) ${t(p + '_nom')}، المولود(ة) بتاريخ ${d(p + '_naiss')} بـ ${t(p + '_lieu')}، حامل(ة) بطاقة التعريف / جواز السفر رقم ${t(p + '_cni')}، القاطن(ة) بـ ${t(p + '_adresse')}، الهاتف: ${t(p + '_tel')}، ${arDef}،</p>`
      : `<p><b>${frRole} :</b> ${t(p + '_nom')}, né(e) le ${d(p + '_naiss')} à ${t(p + '_lieu')}, titulaire de la pièce d'identité n° ${t(p + '_cni')}, demeurant à ${t(p + '_adresse')}, tél. ${t(p + '_tel')}, ${frDef},</p>`;
  };

  const sign = (c, frA, arA, frB, arB) =>
    `<div class="mc-sign"><div>${c.X(frA, arA)}<br><small>${c.X('(lu et approuvé)', '(قرئ وصودق عليه)')}</small></div>` +
    `<div>${c.X(frB, arB)}<br><small>${c.X('(lu et approuvé)', '(قرئ وصودق عليه)')}</small></div></div>`;

  const fait = c => `<p class="mc-fait">${c.X(
    `Fait à ${c.t('ville')}, le ${c.d('date_signature')}, en deux exemplaires originaux, un pour chaque partie.`,
    `حُرّر بـ ${c.t('ville')} بتاريخ ${c.d('date_signature')}، من نسختين أصليتين، بيد كل طرف نسخة.`)}</p>`;

  const head = (c, frTitle, arTitle, frSub = '', arSub = '') =>
    `<h1>${c.X(frTitle, arTitle)}</h1>` + (frSub ? `<p class="mc-sub">${c.X(frSub, arSub)}</p>` : '');

  // ── 1. Bail d'habitation ────────────────────────────────────────────────────
  const bailHabitation = {
    id: 'bail_habitation', icon: '🏠',
    fr: "Bail d'habitation", ar: 'عقد إيجار سكني',
    desc_fr: 'Contrat de location longue durée d\'un logement (vide ou meublé).',
    desc_ar: 'عقد إيجار طويل الأمد لمسكن (فارغ أو مفروش).',
    sections: [
      person('b', 'Le bailleur (propriétaire)', 'المؤجّر (المالك)'),
      person('l', 'Le locataire', 'المستأجر'),
      bienHabitation,
      {
        fr: 'Conditions', ar: 'الشروط',
        fields: [
          F('date_debut', "Date d'effet", 'تاريخ بداية العقد', 'date'),
          F('duree', 'Durée (mois)', 'المدة (أشهر)', 'number', { def: '12' }),
          F('loyer', 'Loyer (DZD)', 'بدل الإيجار (د.ج)', 'number'),
          F('periodicite', 'Périodicité', 'دورية الدفع', 'select', { opts: OPT.periodicite, def: 'mensuel' }),
          F('jour_paiement', 'Payable avant le (jour du mois)', 'يُدفع قبل اليوم (من الشهر)', 'number', { def: '5' }),
          F('paiement', 'Mode de paiement', 'طريقة الدفع', 'select', { opts: OPT.paiement, def: 'especes' }),
          F('charges', 'Charges communes forfaitaires (DZD, facultatif)', 'الأعباء المشتركة الجزافية (د.ج، اختياري)', 'number'),
          F('depot', 'Dépôt de garantie (DZD)', 'مبلغ الضمان (د.ج)', 'number'),
          F('preavis', 'Préavis de congé (mois)', 'أجل الإخطار بالإنهاء (أشهر)', 'number', { def: '3' }),
          F('frais', "Frais d'enregistrement à la charge de", 'مصاريف التسجيل يتحمّلها', 'select', { opts: OPT.frais, def: 'locataire' }),
        ],
      },
      signature,
    ],
    build(v, lang) {
      const c = makeCtx(this, v, lang);
      const { X, t, d, m, nb, sel, g, ar } = c;
      const per = g('periodicite') === 'trimestriel' ? X('par trimestre', 'كل ثلاثة أشهر') : X('par mois', 'شهرياً');
      const ville = g('ville') ? t('ville') : c.blank;
      const list = [
        [X('Objet du contrat', 'موضوع العقد'), X(
          `Le bailleur donne à bail au locataire, qui l'accepte, le bien immobilier suivant :<br>Nature : ${sel('bien_type')} — Consistance : ${t('bien_pieces')} — Surface : ${nb('bien_surface', ' m²')} — Étage : ${t('bien_etage')} — ${sel('bien_meuble')}<br>Adresse : ${t('bien_adresse')}, wilaya de ${t('bien_wilaya')}<br>Dépendances : ${t('bien_dep')}.<br>Le locataire déclare bien connaître les lieux pour les avoir visités.`,
          `يؤجّر المؤجّر للمستأجر، الذي يقبل، العقار التالي:<br>الطبيعة: ${sel('bien_type')} — المكوّنات: ${t('bien_pieces')} — المساحة: ${nb('bien_surface', ' م²')} — الطابق: ${t('bien_etage')} — ${sel('bien_meuble')}<br>العنوان: ${t('bien_adresse')}، ولاية ${t('bien_wilaya')}<br>الملحقات: ${t('bien_dep')}.<br>ويُقرّ المستأجر بمعاينته للعين المؤجّرة معاينة نافية للجهالة.`)],
        [X('Destination des lieux', 'الغرض من الإيجار'), X(
          `Les lieux sont destinés exclusivement à l'habitation. Le locataire ne peut y exercer aucune activité commerciale ou professionnelle, ni sous-louer, ni céder son droit au bail, sans l'accord écrit préalable du bailleur.`,
          `تُخصَّص العين المؤجّرة للسكن حصراً. ولا يجوز للمستأجر ممارسة أي نشاط تجاري أو مهني فيها، ولا التأجير من الباطن أو التنازل عن حقه في الإيجار، إلا بموافقة كتابية مسبقة من المؤجّر.`)],
        [X('Durée et renouvellement', 'المدة والتجديد'), X(
          `Le bail est conclu pour une durée de ${nb('duree')} mois à compter du ${d('date_debut')}. À son terme, il est reconduit tacitement pour une durée identique et aux mêmes conditions, sauf congé notifié par écrit par l'une des parties, avec un préavis de ${nb('preavis')} mois avant l'échéance, par lettre recommandée avec accusé de réception ou par acte d'huissier de justice.`,
          `أُبرم هذا العقد لمدة ${nb('duree')} شهراً ابتداءً من ${d('date_debut')}. وعند انقضائها يتجدّد ضمنياً لمدة مماثلة وبنفس الشروط، ما لم يُخطر أحد الطرفين الآخر كتابياً بإنهائه مع مراعاة أجل إخطار مدته ${nb('preavis')} أشهر قبل تاريخ الانتهاء، برسالة موصى عليها مع وصل استلام أو بمحضر قضائي.`)],
        [X('Loyer', 'بدل الإيجار'), X(
          `Le loyer est fixé à ${m('loyer')} ${per}, payable d'avance au plus tard le ${nb('jour_paiement')} de chaque période, ${sel('paiement')}. Le bailleur remet au locataire une quittance à chaque paiement. Le loyer ne peut être modifié que par accord écrit des parties.`,
          `يُحدَّد بدل الإيجار بمبلغ ${m('loyer')} ${per}، يُدفع مسبقاً في أجل أقصاه اليوم ${nb('jour_paiement')} من كل فترة، ${sel('paiement')}. ويسلّم المؤجّر للمستأجر مخالصة عن كل دفعة. ولا يجوز تعديل بدل الإيجار إلا باتفاق كتابي بين الطرفين.`)],
        [X('Charges', 'الأعباء'), X(
          `${g('charges') ? `Les charges communes (entretien des parties communes, gardiennage, etc.) sont fixées forfaitairement à ${m('charges')} ${per}. ` : ''}Les consommations personnelles (eau, électricité, gaz, téléphone) sont à la charge du locataire, qui règle directement les fournisseurs (Sonelgaz, ADE, etc.) et fait son affaire des abonnements.`,
          `${g('charges') ? `تُحدَّد الأعباء المشتركة (صيانة الأجزاء المشتركة، الحراسة…) جزافياً بمبلغ ${m('charges')} ${per}. ` : ''}يتحمّل المستأجر استهلاكه الشخصي (الماء، الكهرباء، الغاز، الهاتف) ويسدّده مباشرة للمتعاملين (سونلغاز، الجزائرية للمياه…)، ويتكفّل بالاشتراكات.`)],
        [X('Dépôt de garantie', 'مبلغ الضمان'), X(
          `Le locataire verse à la signature un dépôt de garantie de ${m('depot')}, qui ne produit pas d'intérêts et ne constitue pas une avance sur loyer. Il est restitué dans un délai maximal d'un mois après la remise des clés et l'état des lieux de sortie, déduction faite des sommes dues au bailleur et du coût des réparations locatives.`,
          `يدفع المستأجر عند التوقيع مبلغ ضمان قدره ${m('depot')}، لا يُنتج فوائد ولا يُعدّ دفعة مسبقة من بدل الإيجار. ويُردّ إليه في أجل أقصاه شهر واحد من تسليم المفاتيح وإجراء معاينة الخروج، بعد خصم المبالغ المستحقة للمؤجّر وتكلفة الإصلاحات الإيجارية.`)],
        [X('État des lieux', 'محضر المعاينة'), X(
          `Un état des lieux contradictoire est établi à l'entrée et à la sortie du locataire. À défaut d'état des lieux d'entrée, le locataire est présumé avoir reçu les lieux en bon état d'entretien locatif.`,
          `يُحرَّر محضر معاينة حضوري عند دخول المستأجر وعند خروجه. وفي غياب محضر معاينة الدخول، يُفترض أن المستأجر تسلّم العين المؤجّرة في حالة صيانة إيجارية جيدة.`)],
        [X('Obligations du bailleur', 'التزامات المؤجّر'), X(
          `Le bailleur s'engage à délivrer le bien en bon état d'usage, à en assurer au locataire la jouissance paisible pendant toute la durée du bail, à effectuer les grosses réparations et à garantir les vices cachés.`,
          `يلتزم المؤجّر بتسليم العين المؤجّرة في حالة صالحة للانتفاع بها، وبتمكين المستأجر من الانتفاع الهادئ بها طيلة مدة العقد، والقيام بالإصلاحات الكبرى وضمان العيوب الخفية.`)],
        [X('Obligations du locataire', 'التزامات المستأجر'), X(
          `Le locataire s'engage à payer le loyer et les charges aux échéances convenues ; à user des lieux en bon père de famille ; à assurer l'entretien courant et les réparations locatives ; à ne faire aucune transformation sans l'accord écrit du bailleur ; à souscrire une assurance couvrant les risques locatifs (incendie, dégâts des eaux) et à en justifier ; à respecter le règlement de l'immeuble et le voisinage ; et à restituer les lieux en fin de bail.`,
          `يلتزم المستأجر بدفع بدل الإيجار والأعباء في آجالها؛ وباستعمال العين المؤجّرة استعمال الرجل الحريص؛ والقيام بالصيانة الجارية والإصلاحات الإيجارية؛ وعدم إجراء أي تغيير دون موافقة كتابية من المؤجّر؛ واكتتاب تأمين يغطي المخاطر الإيجارية (الحريق، الأضرار المائية) وتقديم ما يثبته؛ واحترام النظام الداخلي للعمارة وحقوق الجوار؛ وإرجاع العين المؤجّرة عند انتهاء العقد.`)],
        [X('Résiliation', 'الفسخ'), X(
          `En cas de manquement de l'une des parties à ses obligations, restée sans effet un mois après mise en demeure par lettre recommandée ou acte d'huissier de justice, l'autre partie peut demander la résiliation du bail devant la juridiction compétente, sans préjudice de dommages-intérêts.`,
          `في حال إخلال أحد الطرفين بالتزاماته دون تدارك خلال شهر من الإعذار برسالة موصى عليها أو بمحضر قضائي، يجوز للطرف الآخر طلب فسخ العقد أمام الجهة القضائية المختصة، دون الإخلال بحقه في التعويض.`)],
        [X('Enregistrement', 'التسجيل'), X(
          `Le présent contrat sera enregistré auprès de la recette des impôts compétente. Les frais d'enregistrement sont supportés par ${sel('frais')}.`,
          `يُسجَّل هذا العقد لدى مفتشية / قباضة الضرائب المختصة. وتتحمّل مصاريف التسجيل ${sel('frais')}.`)],
        [X('Droit applicable et litiges', 'القانون المطبَّق والاختصاص'), X(
          `Le présent contrat est régi par le droit algérien, notamment les dispositions du Code civil relatives au louage. À défaut d'accord amiable, tout litige relève du tribunal territorialement compétent de ${ville}.`,
          `يخضع هذا العقد للقانون الجزائري، لا سيما أحكام القانون المدني المتعلقة بالإيجار. وفي حال تعذّر الحل الودّي، يؤول الاختصاص في أي نزاع للمحكمة المختصة إقليمياً بـ ${ville}.`)],
      ];
      return head(c, "CONTRAT DE BAIL À USAGE D'HABITATION", 'عقد إيجار لغرض السكن')
        + `<p>${X('Entre les soussignés :', 'بين الموقّعين أدناه:')}</p>`
        + party(c, 'b', 'Le bailleur', 'المؤجّر', 'ci-après dénommé « le bailleur »', 'ويُدعى فيما يلي «المؤجّر»')
        + party(c, 'l', 'Le locataire', 'المستأجر', 'ci-après dénommé « le locataire »', 'ويُدعى فيما يلي «المستأجر»')
        + `<p>${X('Il a été convenu et arrêté ce qui suit :', 'تم الاتفاق والتراضي على ما يلي:')}</p>`
        + articles(ar, list) + fait(c)
        + sign(c, 'Le bailleur', 'المؤجّر', 'Le locataire', 'المستأجر');
    },
  };

  // ── 2. Bail commercial / professionnel ──────────────────────────────────────
  const bailCommercial = {
    id: 'bail_commercial', icon: '🏪',
    fr: 'Bail commercial / professionnel', ar: 'عقد إيجار تجاري / مهني',
    desc_fr: 'Location d\'un local commercial, d\'un bureau ou d\'un entrepôt.',
    desc_ar: 'إيجار محل تجاري أو مكتب أو مستودع.',
    sections: [
      person('b', 'Le bailleur (propriétaire)', 'المؤجّر (المالك)'),
      {
        fr: 'Le locataire (preneur)', ar: 'المستأجر',
        fields: [
          F('l_nom', 'Nom et prénom / raison sociale', 'الاسم واللقب / التسمية الاجتماعية', 'text', { wide: true }),
          F('l_rc', 'N° du registre du commerce', 'رقم السجل التجاري'),
          F('l_nif', 'NIF', 'رقم التعريف الجبائي'),
          F('l_cni', "N° carte d'identité du représentant", 'رقم بطاقة تعريف الممثل'),
          F('l_tel', 'Téléphone', 'الهاتف', 'tel'),
          F('l_adresse', 'Adresse / siège', 'العنوان / المقر', 'text', { wide: true }),
        ],
      },
      {
        fr: 'Le local', ar: 'المحل',
        fields: [
          F('bien_adresse', 'Adresse du local', 'عنوان المحل', 'text', { wide: true }),
          F('bien_wilaya', 'Wilaya', 'الولاية'),
          F('bien_type', 'Type de local', 'نوع المحل', 'select', {
            opts: [O('local', 'Local commercial', 'محل تجاري'), O('bureau', 'Bureau', 'مكتب'), O('entrepot', 'Entrepôt', 'مستودع'), O('autre', 'Autre', 'آخر')], def: 'local',
          }),
          F('bien_surface', 'Surface (m²)', 'المساحة (م²)', 'number'),
          F('activite', 'Activité exercée', 'النشاط الممارس', 'text', { wide: true }),
        ],
      },
      {
        fr: 'Conditions', ar: 'الشروط',
        fields: [
          F('date_debut', "Date d'effet", 'تاريخ بداية العقد', 'date'),
          F('duree', 'Durée (années)', 'المدة (سنوات)', 'number', { def: '3' }),
          F('loyer', 'Loyer mensuel (DZD)', 'بدل الإيجار الشهري (د.ج)', 'number'),
          F('jour_paiement', 'Payable avant le (jour du mois)', 'يُدفع قبل اليوم (من الشهر)', 'number', { def: '5' }),
          F('paiement', 'Mode de paiement', 'طريقة الدفع', 'select', { opts: OPT.paiement, def: 'virement' }),
          F('depot', 'Dépôt de garantie (DZD)', 'مبلغ الضمان (د.ج)', 'number'),
          F('preavis', 'Préavis de congé (mois)', 'أجل الإخطار بالإنهاء (أشهر)', 'number', { def: '6' }),
          F('frais', "Frais d'enregistrement à la charge de", 'مصاريف التسجيل يتحمّلها', 'select', { opts: OPT.frais, def: 'locataire' }),
        ],
      },
      signature,
    ],
    build(v, lang) {
      const c = makeCtx(this, v, lang);
      const { X, t, d, m, nb, sel, g, ar } = c;
      const ville = g('ville') ? t('ville') : c.blank;
      const list = [
        [X('Objet du contrat', 'موضوع العقد'), X(
          `Le bailleur donne à bail au locataire, qui l'accepte, le local suivant :<br>Nature : ${sel('bien_type')} — Surface : ${nb('bien_surface', ' m²')}<br>Adresse : ${t('bien_adresse')}, wilaya de ${t('bien_wilaya')}.<br>Le locataire déclare bien connaître les lieux pour les avoir visités.`,
          `يؤجّر المؤجّر للمستأجر، الذي يقبل، المحل التالي:<br>الطبيعة: ${sel('bien_type')} — المساحة: ${nb('bien_surface', ' م²')}<br>العنوان: ${t('bien_adresse')}، ولاية ${t('bien_wilaya')}.<br>ويُقرّ المستأجر بمعاينته للمحل معاينة نافية للجهالة.`)],
        [X('Destination des lieux', 'الغرض من الإيجار'), X(
          `Les lieux sont destinés exclusivement à l'exercice de l'activité suivante : ${t('activite')}. Toute modification d'activité est subordonnée à l'accord écrit du bailleur. Le locataire déclare être régulièrement inscrit au registre du commerce (n° ${t('l_rc')}) et immatriculé fiscalement (NIF ${t('l_nif')}), et s'acquitte des impôts et taxes liés à son activité.`,
          `يُخصَّص المحل حصراً لممارسة النشاط التالي: ${t('activite')}. ويتوقف أي تغيير في النشاط على موافقة كتابية من المؤجّر. ويصرّح المستأجر بأنه مسجَّل قانوناً في السجل التجاري (رقم ${t('l_rc')}) ومسجَّل جبائياً (NIF ${t('l_nif')})، ويتحمّل الضرائب والرسوم المرتبطة بنشاطه.`)],
        [X('Durée et renouvellement', 'المدة والتجديد'), X(
          `Le bail est conclu pour une durée de ${nb('duree')} an(s) à compter du ${d('date_debut')}. À son terme, il se renouvelle tacitement aux mêmes conditions, sauf congé notifié par l'une des parties avec un préavis de ${nb('preavis')} mois, par lettre recommandée avec accusé de réception ou par acte d'huissier de justice.`,
          `أُبرم هذا العقد لمدة ${nb('duree')} سنة (سنوات) ابتداءً من ${d('date_debut')}. وعند انقضائها يتجدّد ضمنياً بنفس الشروط، ما لم يخطر أحد الطرفين الآخر بإنهائه مع مراعاة أجل إخطار مدته ${nb('preavis')} أشهر، برسالة موصى عليها مع وصل استلام أو بمحضر قضائي.`)],
        [X('Loyer', 'بدل الإيجار'), X(
          `Le loyer mensuel est fixé à ${m('loyer')}, payable d'avance au plus tard le ${nb('jour_paiement')} de chaque mois, ${sel('paiement')}. Le loyer ne peut être révisé que par accord écrit des parties.`,
          `يُحدَّد بدل الإيجار الشهري بمبلغ ${m('loyer')}، يُدفع مسبقاً في أجل أقصاه اليوم ${nb('jour_paiement')} من كل شهر، ${sel('paiement')}. ولا يجوز مراجعة بدل الإيجار إلا باتفاق كتابي بين الطرفين.`)],
        [X('Dépôt de garantie', 'مبلغ الضمان'), X(
          `Le locataire verse à la signature un dépôt de garantie de ${m('depot')}, non productif d'intérêts, restitué dans un délai maximal d'un mois après la remise des clés et l'état des lieux de sortie, déduction faite des sommes dues et des réparations locatives.`,
          `يدفع المستأجر عند التوقيع مبلغ ضمان قدره ${m('depot')}، لا يُنتج فوائد، ويُردّ في أجل أقصاه شهر واحد من تسليم المفاتيح وإجراء معاينة الخروج، بعد خصم المبالغ المستحقة والإصلاحات الإيجارية.`)],
        [X('Cession et sous-location', 'التنازل والتأجير من الباطن'), X(
          `Le locataire ne peut ni sous-louer, ni céder son droit au bail, en tout ou partie, ni mettre le local à disposition d'un tiers, sans l'accord écrit préalable du bailleur.`,
          `لا يجوز للمستأجر التأجير من الباطن ولا التنازل عن حقه في الإيجار، كلياً أو جزئياً، ولا وضع المحل تحت تصرف الغير، إلا بموافقة كتابية مسبقة من المؤجّر.`)],
        [X('Travaux et aménagements', 'الأشغال والتهيئة'), X(
          `Le locataire ne peut réaliser de travaux modifiant la structure des lieux sans l'accord écrit du bailleur. Les aménagements et l'enseigne sont installés à ses frais et dans le respect de la réglementation en vigueur. Sauf accord contraire, les travaux fixés à demeure restent acquis au bailleur en fin de bail.`,
          `لا يجوز للمستأجر إجراء أشغال تغيّر هيكل المحل دون موافقة كتابية من المؤجّر. وتُنجز التهيئة واللافتة على نفقته مع احترام التنظيم الساري. وما لم يُتفق على خلاف ذلك، تؤول الأشغال الثابتة إلى المؤجّر عند نهاية العقد.`)],
        [X('Obligations des parties', 'التزامات الطرفين'), X(
          `Le bailleur délivre le local en bon état d'usage, en assure la jouissance paisible et effectue les grosses réparations. Le locataire paie le loyer et les charges (eau, électricité, gaz, taxes liées à l'activité), assure l'entretien courant, souscrit une assurance couvrant les risques locatifs et professionnels (incendie, dégâts des eaux, responsabilité civile) et en justifie, puis restitue les lieux en fin de bail.`,
          `يسلّم المؤجّر المحل في حالة صالحة للانتفاع، ويضمن الانتفاع الهادئ به ويقوم بالإصلاحات الكبرى. ويدفع المستأجر بدل الإيجار والأعباء (الماء، الكهرباء، الغاز، الرسوم المرتبطة بالنشاط)، ويقوم بالصيانة الجارية، ويكتتب تأميناً يغطي المخاطر الإيجارية والمهنية (الحريق، الأضرار المائية، المسؤولية المدنية) ويقدّم ما يثبته، ثم يعيد المحل عند نهاية العقد.`)],
        [X('Résiliation', 'الفسخ'), X(
          `En cas de manquement de l'une des parties, notamment de défaut de paiement du loyer, resté sans effet un mois après mise en demeure par lettre recommandée ou acte d'huissier de justice, l'autre partie peut demander la résiliation du bail devant la juridiction compétente, sans préjudice de dommages-intérêts.`,
          `في حال إخلال أحد الطرفين بالتزاماته، لا سيما عدم دفع بدل الإيجار، دون تدارك خلال شهر من الإعذار برسالة موصى عليها أو بمحضر قضائي، يجوز للطرف الآخر طلب فسخ العقد أمام الجهة القضائية المختصة، دون الإخلال بحقه في التعويض.`)],
        [X('Enregistrement', 'التسجيل'), X(
          `Le présent contrat sera enregistré auprès de la recette des impôts compétente. Les frais d'enregistrement sont supportés par ${sel('frais')}.`,
          `يُسجَّل هذا العقد لدى مفتشية / قباضة الضرائب المختصة. وتتحمّل مصاريف التسجيل ${sel('frais')}.`)],
        [X('Droit applicable et litiges', 'القانون المطبَّق والاختصاص'), X(
          `Le présent contrat est régi par le droit algérien. À défaut d'accord amiable, tout litige relève du tribunal territorialement compétent de ${ville}.`,
          `يخضع هذا العقد للقانون الجزائري. وفي حال تعذّر الحل الودّي، يؤول الاختصاص في أي نزاع للمحكمة المختصة إقليمياً بـ ${ville}.`)],
      ];
      return head(c, 'CONTRAT DE BAIL COMMERCIAL / PROFESSIONNEL', 'عقد إيجار تجاري / مهني')
        + `<p>${X('Entre les soussignés :', 'بين الموقّعين أدناه:')}</p>`
        + party(c, 'b', 'Le bailleur', 'المؤجّر', 'ci-après dénommé « le bailleur »', 'ويُدعى فيما يلي «المؤجّر»')
        + (ar
          ? `<p><b>المستأجر:</b> ${t('l_nom')}، سجل تجاري رقم ${t('l_rc')}، NIF ${t('l_nif')}، الممثَّل ببطاقة التعريف رقم ${t('l_cni')}، مقره / عنوانه: ${t('l_adresse')}، الهاتف: ${t('l_tel')}، ويُدعى فيما يلي «المستأجر»،</p>`
          : `<p><b>Le locataire :</b> ${t('l_nom')}, RC n° ${t('l_rc')}, NIF ${t('l_nif')}, représenté par la pièce d'identité n° ${t('l_cni')}, siège / adresse : ${t('l_adresse')}, tél. ${t('l_tel')}, ci-après dénommé « le locataire »,</p>`)
        + `<p>${X('Il a été convenu et arrêté ce qui suit :', 'تم الاتفاق والتراضي على ما يلي:')}</p>`
        + articles(ar, list) + fait(c)
        + sign(c, 'Le bailleur', 'المؤجّر', 'Le locataire', 'المستأجر');
    },
  };

  // ── 3. Location saisonnière (courte durée) ──────────────────────────────────
  const saisonniere = {
    id: 'saisonniere', icon: '🏖️',
    fr: 'Location saisonnière', ar: 'عقد إيجار موسمي (قصير المدة)',
    desc_fr: 'Contrat de location de courte durée (vacances, séjour).',
    desc_ar: 'عقد إيجار قصير المدة (عطلة، إقامة).',
    sections: [
      {
        fr: 'Le propriétaire', ar: 'المالك',
        fields: [
          F('b_nom', 'Nom et prénom', 'الاسم واللقب', 'text', { wide: true }),
          F('b_cni', "N° carte d'identité / passeport", 'رقم بطاقة التعريف / جواز السفر'),
          F('b_tel', 'Téléphone', 'الهاتف', 'tel'),
          F('b_adresse', 'Adresse', 'العنوان', 'text', { wide: true }),
        ],
      },
      {
        fr: 'Le locataire (vacancier)', ar: 'المستأجر',
        fields: [
          F('l_nom', 'Nom et prénom', 'الاسم واللقب', 'text', { wide: true }),
          F('l_cni', "N° carte d'identité / passeport", 'رقم بطاقة التعريف / جواز السفر'),
          F('l_tel', 'Téléphone', 'الهاتف', 'tel'),
          F('l_adresse', 'Adresse', 'العنوان', 'text', { wide: true }),
        ],
      },
      {
        fr: 'Le logement', ar: 'المسكن',
        fields: [
          F('bien_adresse', 'Adresse du logement', 'عنوان المسكن', 'text', { wide: true }),
          F('bien_wilaya', 'Wilaya', 'الولاية'),
          F('bien_type', 'Type de bien', 'نوع العقار', 'select', { opts: OPT.bien, def: 'appartement' }),
          F('bien_pieces', 'Consistance (ex. F3)', 'المكوّنات (مثال: F3)'),
          F('capacite', "Nombre maximal d'occupants", 'العدد الأقصى للمقيمين', 'number'),
        ],
      },
      {
        fr: 'Séjour et prix', ar: 'الإقامة والسعر',
        fields: [
          F('date_arrivee', "Date d'arrivée", 'تاريخ الوصول', 'date'),
          F('heure_arrivee', "Heure d'arrivée", 'ساعة الوصول', 'time', { def: '15:00' }),
          F('date_depart', 'Date de départ', 'تاريخ المغادرة', 'date'),
          F('heure_depart', 'Heure de départ', 'ساعة المغادرة', 'time', { def: '11:00' }),
          F('prix', 'Prix total du séjour (DZD)', 'السعر الإجمالي للإقامة (د.ج)', 'number'),
          F('acompte', 'Acompte à la réservation (DZD)', 'العربون عند الحجز (د.ج)', 'number'),
          F('caution', 'Caution (DZD)', 'مبلغ الضمان (د.ج)', 'number'),
          F('menage', 'Frais de ménage (DZD, facultatif)', 'مصاريف التنظيف (د.ج، اختياري)', 'number'),
          F('annulation', "Politique d'annulation", 'سياسة الإلغاء', 'select', { opts: OPT.annulation, def: 'moderee', wide: true }),
          F('animaux', 'Animaux', 'الحيوانات الأليفة', 'select', { opts: OPT.animaux, def: 'non' }),
        ],
      },
      signature,
    ],
    build(v, lang) {
      const c = makeCtx(this, v, lang);
      const { X, t, d, m, nb, sel, g, ar } = c;
      const ville = g('ville') ? t('ville') : c.blank;
      const list = [
        [X('Objet', 'الموضوع'), X(
          `Le propriétaire loue au locataire, à titre saisonnier, le logement suivant :<br>Nature : ${sel('bien_type')} — Consistance : ${t('bien_pieces')}<br>Adresse : ${t('bien_adresse')}, wilaya de ${t('bien_wilaya')}.<br>Le propriétaire déclare être en droit de louer ce bien (titre de propriété ou autorisation du propriétaire).`,
          `يؤجّر المالك للمستأجر، على سبيل الإيجار الموسمي، المسكن التالي:<br>الطبيعة: ${sel('bien_type')} — المكوّنات: ${t('bien_pieces')}<br>العنوان: ${t('bien_adresse')}، ولاية ${t('bien_wilaya')}.<br>ويصرّح المالك بأنه مخوَّل قانوناً بتأجير هذا العقار (سند الملكية أو ترخيص من المالك).`)],
        [X('Durée du séjour', 'مدة الإقامة'), X(
          `La location est consentie du ${d('date_arrivee')} à partir de ${t('heure_arrivee')} au ${d('date_depart')} avant ${t('heure_depart')}. Elle ne peut donner lieu à aucun droit au maintien dans les lieux ni à reconduction.`,
          `يُمنح الإيجار من ${d('date_arrivee')} ابتداءً من الساعة ${t('heure_arrivee')} إلى ${d('date_depart')} قبل الساعة ${t('heure_depart')}. ولا يترتب عنه أي حق في البقاء في المسكن ولا في التجديد.`)],
        [X('Occupants', 'المقيمون'), X(
          `Le logement ne peut être occupé par plus de ${nb('capacite')} personne(s). Les animaux sont : ${sel('animaux')}.`,
          `لا يجوز أن يقيم في المسكن أكثر من ${nb('capacite')} شخص (أشخاص). الحيوانات الأليفة: ${sel('animaux')}.`)],
        [X('Prix et paiement', 'السعر والدفع'), X(
          `Le prix total du séjour est de ${m('prix')}${g('menage') ? `, dont ${m('menage')} de frais de ménage` : ''}. Un acompte de ${m('acompte')} est versé à la réservation ; le solde est payable à l'arrivée.`,
          `السعر الإجمالي للإقامة ${m('prix')}${g('menage') ? `، منها ${m('menage')} مصاريف تنظيف` : ''}. يُدفع عربون قدره ${m('acompte')} عند الحجز، ويُسدَّد الباقي عند الوصول.`)],
        [X('Caution', 'الضمان'), X(
          `Une caution de ${m('caution')} est remise à l'arrivée. Elle est restituée à la fin du séjour, après vérification de l'état du logement, déduction faite des dégradations constatées et des sommes restant dues.`,
          `يُسلَّم مبلغ ضمان قدره ${m('caution')} عند الوصول. ويُردّ عند نهاية الإقامة بعد معاينة حالة المسكن، مع خصم الأضرار المعاينة والمبالغ المتبقية.`)],
        [X('Utilisation et règlement', 'الاستعمال والنظام'), X(
          `Le locataire use des lieux en bon père de famille, respecte le voisinage et le règlement de l'immeuble, s'interdit toute fête ou nuisance sonore, et ne peut sous-louer. Il répond des dégradations survenant pendant son séjour et restitue le logement propre et en bon état.`,
          `يستعمل المستأجر المسكن استعمال الرجل الحريص، ويحترم الجوار والنظام الداخلي للعمارة، ويمتنع عن إقامة الحفلات وإزعاج الجيران، ولا يجوز له التأجير من الباطن. ويكون مسؤولاً عن الأضرار الحاصلة أثناء إقامته ويعيد المسكن نظيفاً وبحالة جيدة.`)],
        [X('Annulation', 'الإلغاء'), X(
          `${sel('annulation')}. En cas d'annulation par le propriétaire, les sommes versées sont intégralement remboursées.`,
          `${sel('annulation')}. وفي حال إلغاء الحجز من طرف المالك تُردّ المبالغ المدفوعة كاملة.`)],
        [X('État des lieux et assurance', 'المعاينة والتأمين'), X(
          `Un état des lieux sommaire est dressé à l'arrivée et au départ. Le locataire est invité à s'assurer pour sa responsabilité civile pendant le séjour.`,
          `يُحرَّر محضر معاينة موجز عند الوصول وعند المغادرة. ويُنصح المستأجر بالتأمين عن مسؤوليته المدنية خلال الإقامة.`)],
        [X('Droit applicable et litiges', 'القانون المطبَّق والاختصاص'), X(
          `Le présent contrat est régi par le droit algérien. À défaut d'accord amiable, tout litige relève du tribunal territorialement compétent de ${ville}.`,
          `يخضع هذا العقد للقانون الجزائري. وفي حال تعذّر الحل الودّي، يؤول الاختصاص في أي نزاع للمحكمة المختصة إقليمياً بـ ${ville}.`)],
      ];
      const bp = (p, fr, a) => ar
        ? `<p><b>${a}:</b> ${t(p + '_nom')}، بطاقة التعريف / جواز السفر رقم ${t(p + '_cni')}، العنوان: ${t(p + '_adresse')}، الهاتف: ${t(p + '_tel')}،</p>`
        : `<p><b>${fr} :</b> ${t(p + '_nom')}, pièce d'identité n° ${t(p + '_cni')}, demeurant à ${t(p + '_adresse')}, tél. ${t(p + '_tel')},</p>`;
      return head(c, 'CONTRAT DE LOCATION SAISONNIÈRE', 'عقد إيجار موسمي')
        + `<p>${X('Entre les soussignés :', 'بين الموقّعين أدناه:')}</p>`
        + bp('b', 'Le propriétaire', 'المالك') + bp('l', 'Le locataire', 'المستأجر')
        + `<p>${X('Il a été convenu et arrêté ce qui suit :', 'تم الاتفاق والتراضي على ما يلي:')}</p>`
        + articles(ar, list) + fait(c)
        + sign(c, 'Le propriétaire', 'المالك', 'Le locataire', 'المستأجر');
    },
  };

  // ── 4. Quittance de loyer ───────────────────────────────────────────────────
  const quittance = {
    id: 'quittance', icon: '🧾',
    fr: 'Quittance de loyer', ar: 'وصل (مخالصة) إيجار',
    desc_fr: 'Reçu remis au locataire après paiement du loyer.',
    desc_ar: 'وصل يُسلَّم للمستأجر بعد دفع بدل الإيجار.',
    sections: [
      {
        fr: 'Parties', ar: 'الطرفان',
        fields: [
          F('b_nom', 'Bailleur : nom et prénom', 'المؤجّر: الاسم واللقب', 'text', { wide: true }),
          F('b_adresse', 'Bailleur : adresse', 'المؤجّر: العنوان', 'text', { wide: true }),
          F('l_nom', 'Locataire : nom et prénom', 'المستأجر: الاسم واللقب', 'text', { wide: true }),
          F('bien_adresse', 'Adresse du bien loué', 'عنوان العقار المؤجَّر', 'text', { wide: true }),
        ],
      },
      {
        fr: 'Paiement', ar: 'الدفع',
        fields: [
          F('periode_du', 'Période du', 'الفترة من', 'date'),
          F('periode_au', 'au', 'إلى', 'date'),
          F('loyer', 'Loyer (DZD)', 'بدل الإيجار (د.ج)', 'number'),
          F('charges', 'Charges (DZD)', 'الأعباء (د.ج)', 'number'),
          F('lettres', 'Montant total en lettres (facultatif)', 'المبلغ الإجمالي بالحروف (اختياري)', 'text', { wide: true }),
          F('date_paiement', 'Date du paiement', 'تاريخ الدفع', 'date', { def: today() }),
          F('paiement', 'Mode de paiement', 'طريقة الدفع', 'select', { opts: OPT.paiement, def: 'especes' }),
        ],
      },
      signature,
    ],
    build(v, lang) {
      const c = makeCtx(this, v, lang);
      const { X, t, d, m, sel, g, ar } = c;
      const loyer = Number(g('loyer')) || 0, ch = Number(g('charges')) || 0;
      const total = loyer + ch;
      const tot = total > 0 ? `<b>${c.num(total)} ${X('DZD', 'د.ج')}</b>` : c.blank;
      const lettres = g('lettres') ? ` (${t('lettres')})` : '';
      return head(c, 'QUITTANCE DE LOYER', 'وصل (مخالصة) إيجار')
        + (ar
          ? `<p>أنا الموقّع(ة) أدناه ${t('b_nom')}، القاطن(ة) بـ ${t('b_adresse')}، مؤجّر(ة) العقار الكائن بـ ${t('bien_adresse')}، أُقرّ بأنني استلمتُ من السيد(ة) ${t('l_nom')} مبلغ ${tot}${lettres} ${sel('paiement')} بتاريخ ${d('date_paiement')}، وذلك عن بدل الإيجار (${m('loyer')}) والأعباء (${m('charges')}) عن الفترة الممتدة من ${d('periode_du')} إلى ${d('periode_au')}.</p><p>وعليه أسلّمه هذا الوصل مخالصةً عن الفترة المذكورة، مع حفظ كافة حقوقي.</p>`
          : `<p>Je soussigné(e) ${t('b_nom')}, demeurant à ${t('b_adresse')}, bailleur du bien situé ${t('bien_adresse')}, reconnais avoir reçu de ${t('l_nom')} la somme de ${tot}${lettres}, payée ${sel('paiement')} le ${d('date_paiement')}, au titre du loyer (${m('loyer')}) et des charges (${m('charges')}) pour la période du ${d('periode_du')} au ${d('periode_au')}.</p><p>En conséquence, je lui délivre la présente quittance pour la période indiquée, sous réserve de tous mes droits.</p>`)
        + `<p class="mc-fait">${X(`Fait à ${t('ville')}, le ${d('date_signature')}.`, `حُرّر بـ ${t('ville')} بتاريخ ${d('date_signature')}.`)}</p>`
        + `<div class="mc-sign"><div>${X('Le bailleur', 'المؤجّر')}<br><small>${X('(signature)', '(الإمضاء)')}</small></div><div></div></div>`;
    },
  };

  // ── 5. État des lieux ───────────────────────────────────────────────────────
  const ROOMS = [
    ['entree', 'Entrée', 'المدخل'], ['sejour', 'Séjour', 'الصالون'], ['cuisine', 'Cuisine', 'المطبخ'],
    ['ch1', 'Chambre 1', 'الغرفة 1'], ['ch2', 'Chambre 2', 'الغرفة 2'],
    ['sdb', 'Salle de bain', 'الحمام'], ['wc', 'WC', 'المرحاض'], ['balcon', 'Balcon / terrasse', 'الشرفة / السطح'],
  ];
  const etatDesLieux = {
    id: 'etat_lieux', icon: '📋',
    fr: 'État des lieux', ar: 'محضر معاينة العقار',
    desc_fr: "État des lieux d'entrée ou de sortie, pièce par pièce.",
    desc_ar: 'محضر معاينة عند الدخول أو الخروج، غرفة بغرفة.',
    sections: [
      {
        fr: 'Général', ar: 'معلومات عامة',
        fields: [
          F('type', 'Type', 'النوع', 'select', { opts: OPT.edl, def: 'entree', wide: true }),
          F('date_edl', 'Date', 'التاريخ', 'date', { def: today() }),
          F('b_nom', 'Bailleur', 'المؤجّر'),
          F('l_nom', 'Locataire', 'المستأجر'),
          F('bien_adresse', 'Adresse du bien', 'عنوان العقار', 'text', { wide: true }),
        ],
      },
      {
        fr: 'Compteurs et clés', ar: 'العدّادات والمفاتيح',
        fields: [
          F('cpt_elec', 'Électricité (index)', 'الكهرباء (المؤشر)'),
          F('cpt_gaz', 'Gaz (index)', 'الغاز (المؤشر)'),
          F('cpt_eau', 'Eau (index)', 'الماء (المؤشر)'),
          F('cles', 'Nombre de clés remises', 'عدد المفاتيح المسلَّمة', 'number'),
        ],
      },
      {
        fr: 'Pièces', ar: 'الغرف',
        fields: ROOMS.flatMap(([k, fr, ar]) => [
          F('r_' + k + '_etat', `${fr} — état`, `${ar} — الحالة`, 'select', { opts: OPT.etat, def: '' }),
          F('r_' + k + '_obs', `${fr} — observations`, `${ar} — ملاحظات`),
        ]),
      },
      {
        fr: 'Observations', ar: 'ملاحظات عامة',
        fields: [F('obs', 'Observations générales', 'ملاحظات عامة', 'textarea', { wide: true })],
      },
      signature,
    ],
    build(v, lang) {
      const c = makeCtx(this, v, lang);
      const { X, t, d, nb, sel, g, ar } = c;
      const rows = ROOMS.map(([k, fr, a]) => {
        const e = c.selRaw('r_' + k + '_etat');
        return `<tr><td>${X(fr, a)}</td><td>${e.v ? escH(ar ? e.ar : e.fr) : ''}</td><td>${escH(g('r_' + k + '_obs'))}</td></tr>`;
      }).join('');
      return head(c, 'ÉTAT DES LIEUX', 'محضر معاينة العقار')
        + `<p>${sel('type')} — ${X('établi le', 'أُنجز بتاريخ')} ${d('date_edl')}</p>`
        + `<p>${X('Bailleur', 'المؤجّر')} : ${t('b_nom')}<br>${X('Locataire', 'المستأجر')} : ${t('l_nom')}<br>${X('Bien situé', 'العقار الكائن بـ')} : ${t('bien_adresse')}</p>`
        + `<h3>${X('Relevé des compteurs et clés', 'العدّادات والمفاتيح')}</h3>`
        + `<p>${X('Électricité (Sonelgaz)', 'الكهرباء (سونلغاز)')} : ${t('cpt_elec')} — ${X('Gaz (Sonelgaz)', 'الغاز (سونلغاز)')} : ${t('cpt_gaz')} — ${X('Eau', 'الماء')} : ${t('cpt_eau')}<br>${X('Clés remises', 'المفاتيح المسلَّمة')} : ${nb('cles')}</p>`
        + `<h3>${X('État des pièces', 'حالة الغرف')}</h3>`
        + `<table class="mc-table"><thead><tr><th>${X('Pièce', 'الغرفة')}</th><th>${X('État', 'الحالة')}</th><th>${X('Observations', 'ملاحظات')}</th></tr></thead><tbody>${rows}</tbody></table>`
        + (g('obs') ? `<h3>${X('Observations générales', 'ملاحظات عامة')}</h3><p>${escH(g('obs')).replace(/\n/g, '<br>')}</p>` : '')
        + `<p class="mc-fait">${X(`Fait à ${t('ville')}, le ${d('date_signature')}, en deux exemplaires.`, `حُرّر بـ ${t('ville')} بتاريخ ${d('date_signature')}، من نسختين.`)}</p>`
        + sign(c, 'Le bailleur', 'المؤجّر', 'Le locataire', 'المستأجر');
    },
  };

  // ── 6. Lettre de congé ──────────────────────────────────────────────────────
  const conge = {
    id: 'conge', icon: '✉️',
    fr: 'Lettre de congé', ar: 'رسالة إنهاء عقد الإيجار',
    desc_fr: 'Préavis de fin de bail, par le locataire ou par le bailleur.',
    desc_ar: 'إخطار بإنهاء عقد الإيجار من المستأجر أو من المؤجّر.',
    sections: [
      {
        fr: 'Expéditeur et destinataire', ar: 'المرسِل والمرسَل إليه',
        fields: [
          F('qui', 'Le congé est donné par', 'الإنهاء صادر عن', 'select', { opts: OPT.conge, def: 'locataire', wide: true }),
          F('e_nom', 'Expéditeur : nom et prénom', 'المرسِل: الاسم واللقب', 'text', { wide: true }),
          F('e_adresse', 'Expéditeur : adresse', 'المرسِل: العنوان', 'text', { wide: true }),
          F('d_nom', 'Destinataire : nom et prénom', 'المرسَل إليه: الاسم واللقب', 'text', { wide: true }),
          F('d_adresse', 'Destinataire : adresse', 'المرسَل إليه: العنوان', 'text', { wide: true }),
        ],
      },
      {
        fr: 'Le bail', ar: 'عقد الإيجار',
        fields: [
          F('bien_adresse', 'Adresse du bien loué', 'عنوان العقار المؤجَّر', 'text', { wide: true }),
          F('date_bail', 'Date du contrat de bail', 'تاريخ عقد الإيجار', 'date'),
          F('preavis', 'Préavis (mois)', 'أجل الإخطار (أشهر)', 'number', { def: '3' }),
          F('date_effet', "Date d'effet du congé", 'تاريخ سريان الإنهاء', 'date'),
          F('envoi', "Mode d'envoi", 'طريقة الإرسال', 'select', { opts: OPT.envoi, def: 'lrar', wide: true }),
          F('motif', 'Motif (facultatif)', 'السبب (اختياري)', 'textarea', { wide: true }),
        ],
      },
      signature,
    ],
    build(v, lang) {
      const c = makeCtx(this, v, lang);
      const { X, t, d, nb, sel, g, ar } = c;
      const loc = g('qui') !== 'bailleur';
      const motif = g('motif') ? X(`<p>Motif : ${t('motif')}</p>`, `<p>السبب: ${t('motif')}</p>`) : '';
      const corps = loc
        ? X(
          `<p>Par la présente, j'ai l'honneur de vous notifier mon congé du logement situé ${t('bien_adresse')}, objet du contrat de bail signé le ${d('date_bail')}.</p><p>Conformément au contrat, ce congé est donné avec un préavis de ${nb('preavis')} mois et prendra effet le ${d('date_effet')}.</p>${motif}<p>Je vous propose de convenir d'une date pour l'état des lieux de sortie et la remise des clés, et vous prie de bien vouloir me restituer le dépôt de garantie dans les conditions prévues au contrat.</p>`,
          `<p>أتشرّف بإخطاركم بإنهاء عقد إيجار العقار الكائن بـ ${t('bien_adresse')}، المبرم بتاريخ ${d('date_bail')}.</p><p>ووفقاً للعقد، يُقدَّم هذا الإخطار بأجل ${nb('preavis')} أشهر، ويسري ابتداءً من ${d('date_effet')}.</p>${motif}<p>أقترح الاتفاق على موعد لمعاينة الخروج وتسليم المفاتيح، وأرجو ردّ مبلغ الضمان وفق الشروط المنصوص عليها في العقد.</p>`)
        : X(
          `<p>Par la présente, j'ai l'honneur de vous notifier ma décision de mettre fin au contrat de bail signé le ${d('date_bail')} portant sur le logement situé ${t('bien_adresse')}.</p><p>Ce congé est donné avec un préavis de ${nb('preavis')} mois et prendra effet le ${d('date_effet')}, date à laquelle vous voudrez bien libérer les lieux.</p>${motif}<p>Nous conviendrons d'une date pour l'état des lieux de sortie et la remise des clés ; le dépôt de garantie vous sera restitué dans les conditions prévues au contrat.</p>`,
          `<p>أتشرّف بإخطاركم بقراري إنهاء عقد الإيجار المبرم بتاريخ ${d('date_bail')} والمتعلق بالعقار الكائن بـ ${t('bien_adresse')}.</p><p>يُقدَّم هذا الإخطار بأجل ${nb('preavis')} أشهر ويسري ابتداءً من ${d('date_effet')}، وهو تاريخ إخلاء العين المؤجّرة.</p>${motif}<p>نتفق على موعد لمعاينة الخروج وتسليم المفاتيح، ويُردّ إليكم مبلغ الضمان وفق الشروط المنصوص عليها في العقد.</p>`);
      return (ar
        ? `<p class="mc-side">${t('e_nom')}<br>${t('e_adresse')}</p><p class="mc-side mc-right">إلى السيد(ة) ${t('d_nom')}<br>${t('d_adresse')}</p>`
        : `<p class="mc-side">${t('e_nom')}<br>${t('e_adresse')}</p><p class="mc-side mc-right">À l'attention de ${t('d_nom')}<br>${t('d_adresse')}</p>`)
        + `<p class="mc-fait">${X(`${t('ville')}, le ${d('date_signature')}`, `${t('ville')}، بتاريخ ${d('date_signature')}`)}</p>`
        + `<p><b>${X('Objet : congé de bail', 'الموضوع: إنهاء عقد الإيجار')}</b><br><b>${X('Envoi par', 'الإرسال بواسطة')} :</b> ${sel('envoi')}</p>`
        + `<p>${X('Madame, Monsieur,', 'السيد(ة) المحترم(ة)،')}</p>` + corps
        + `<p>${X('Veuillez agréer, Madame, Monsieur, l\'expression de mes salutations distinguées.', 'تقبّلوا فائق الاحترام والتقدير.')}</p>`
        + `<div class="mc-sign"><div>${X('Signature', 'الإمضاء')}<br><small>${t('e_nom')}</small></div><div></div></div>`;
    },
  };

  const DOCS = [bailHabitation, bailCommercial, saisonniere, quittance, etatDesLieux, conge];

  // ── Interface ───────────────────────────────────────────────────────────────
  const state = { doc: null, lang: null, values: {} };
  const curLang = () => (typeof currentLang !== 'undefined' ? currentLang : 'fr');
  const ui = k => (typeof T === 'function' ? T(k) : k);
  const lbl = o => (curLang() === 'ar' ? o.ar : o.fr);
  const root = () => document.getElementById('mc-root');

  function injectStyle() {
    if (document.getElementById('mc-style')) return;
    const s = document.createElement('style');
    s.id = 'mc-style';
    s.textContent = `
      .mc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:1rem;margin-top:1.25rem}
      .mc-card{padding:1.25rem;display:flex;flex-direction:column;gap:.5rem;border:1px solid var(--border);border-radius:12px;background:var(--white);box-shadow:var(--shadow)}
      .mc-card .mc-ico{font-size:1.8rem}
      .mc-card h3{font-size:1rem;font-weight:800;margin:0}
      .mc-card p{font-size:.85rem;color:var(--text-muted);margin:0;flex:1}
      .mc-warn{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);border-radius:10px;padding:.85rem 1rem;font-size:.82rem;line-height:1.6;margin-top:1rem}
      .mc-editor{display:grid;grid-template-columns:minmax(0,400px) minmax(0,1fr);gap:1.5rem;align-items:start;margin-top:1rem}
      @media(max-width:900px){.mc-editor{grid-template-columns:1fr}}
      .mc-form .mc-sec{border:1px solid var(--border);border-radius:12px;background:var(--white);padding:1rem;margin-bottom:1rem}
      .mc-form h4{font-size:.9rem;font-weight:800;margin:0 0 .75rem}
      .mc-grid{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
      .mc-grid .mc-wide{grid-column:1/-1}
      .mc-form label{font-size:.78rem;font-weight:600;display:block;margin-bottom:.2rem}
      .mc-form input,.mc-form select,.mc-form textarea{width:100%;padding:.5rem .65rem;border:1.5px solid var(--border);border-radius:8px;font-size:.88rem;background:var(--bg);color:var(--text);font-family:inherit}
      .mc-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.75rem}
      .mc-bar select{padding:.45rem .6rem;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text)}
      .mc-paper{background:#fff;color:#111;border:1px solid #d6d6d6;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,.12);padding:2.2rem 2.4rem;font-family:'Times New Roman',Georgia,serif;font-size:.98rem;line-height:1.65}
      .mc-paper [dir=rtl]{font-family:'Traditional Arabic','Amiri','Arial',sans-serif;font-size:1.08rem}
      .mc-part+.mc-part{margin-top:2.5rem;padding-top:2rem;border-top:2px dashed #bbb;page-break-before:always}
      .mc-paper h1{font-size:1.25rem;text-align:center;margin:0 0 1.2rem;letter-spacing:.02em}
      .mc-paper h3{font-size:1rem;margin:1rem 0 .3rem}
      .mc-paper p{margin:.45rem 0;text-align:justify}
      .mc-art{page-break-inside:avoid}
      .mc-blank{color:#888}
      .mc-fait{margin-top:1.4rem}
      .mc-side{display:inline-block;width:49%;vertical-align:top}
      .mc-right{text-align:end}
      .mc-sign{display:flex;justify-content:space-between;gap:2rem;margin-top:2rem;min-height:110px;page-break-inside:avoid;text-align:center}
      .mc-sign>div{flex:1}
      .mc-table{width:100%;border-collapse:collapse;margin:.5rem 0}
      .mc-table th,.mc-table td{border:1px solid #444;padding:.35rem .5rem;text-align:start;font-size:.92rem}
      .mc-paper small{color:#555}
      @media print{
        body.mc-printing>*:not(#page-contrats){display:none!important}
        body.mc-printing #page-contrats .mc-noprint{display:none!important}
        body.mc-printing #mc-root,body.mc-printing .mc-editor{display:block!important;margin:0!important;padding:0!important;max-width:none!important}
        body.mc-printing .mc-paper{border:none;box-shadow:none;padding:0;border-radius:0}
      }`;
    document.head.appendChild(s);
  }

  const cur = () => DOCS.find(d => d.id === state.doc);

  function values(doc) {
    if (!state.values[doc.id]) {
      const v = {};
      doc.sections.forEach(s => s.fields.forEach(f => { if (f.def !== undefined) v[f.id] = f.def; }));
      state.values[doc.id] = v;
    }
    return state.values[doc.id];
  }

  function fieldHtml(f, val) {
    const id = 'mc-f-' + f.id;
    const cls = f.wide ? 'mc-wide' : '';
    let inp;
    if (f.type === 'select') {
      inp = `<select id="${id}" data-f="${f.id}">${f.opts.map(o =>
        `<option value="${escH(o.v)}"${o.v === val ? ' selected' : ''}>${escH(lbl(o))}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      inp = `<textarea id="${id}" data-f="${f.id}" rows="3">${escH(val)}</textarea>`;
    } else {
      inp = `<input id="${id}" data-f="${f.id}" type="${f.type}"${f.type === 'number' ? ' min="0" inputmode="decimal"' : ''} value="${escH(val)}">`;
    }
    return `<div class="${cls}"><label for="${id}">${escH(lbl(f))}</label>${inp}</div>`;
  }

  function renderList() {
    state.doc = null;
    root().innerHTML = `
      <button class="btn btn-outline btn-sm" style="margin-bottom:1.5rem" onclick="showPage('home')">${escH(ui('btn_back'))}</button>
      <h1 style="font-size:1.6rem;font-weight:900;margin-bottom:.4rem">${escH(ui('mc_title'))}</h1>
      <p style="color:var(--text-muted);font-size:.9rem">${escH(ui('mc_sub'))}</p>
      <div class="mc-warn">⚠️ ${escH(ui('mc_disclaimer'))}</div>
      <div class="mc-cards">${DOCS.map(d => `
        <div class="mc-card">
          <div class="mc-ico">${d.icon}</div>
          <h3>${escH(lbl(d))}</h3>
          <p>${escH(curLang() === 'ar' ? d.desc_ar : d.desc_fr)}</p>
          <button class="btn btn-primary btn-sm" data-open="${d.id}">${escH(ui('mc_use'))}</button>
        </div>`).join('')}
      </div>`;
  }

  function renderEditor() {
    const doc = cur(), v = values(doc);
    if (!state.lang) state.lang = curLang();
    root().innerHTML = `
      <div class="mc-noprint">
        <button class="btn btn-outline btn-sm" style="margin-bottom:1rem" data-list="1">${escH(ui('mc_all'))}</button>
        <h1 style="font-size:1.4rem;font-weight:900;margin-bottom:.2rem">${doc.icon} ${escH(lbl(doc))}</h1>
        <div class="mc-warn">⚠️ ${escH(ui('mc_disclaimer'))}</div>
      </div>
      <div class="mc-editor">
        <div class="mc-form mc-noprint">
          ${doc.sections.map(s => `<div class="mc-sec"><h4>${escH(lbl(s))}</h4><div class="mc-grid">${
            s.fields.map(f => fieldHtml(f, v[f.id] ?? '')).join('')}</div></div>`).join('')}
        </div>
        <div>
          <div class="mc-bar mc-noprint">
            <label for="mc-lang" style="font-size:.8rem;font-weight:600">${escH(ui('mc_doc_lang'))}</label>
            <select id="mc-lang"><option value="fr"${state.lang === 'fr' ? ' selected' : ''}>Français</option><option value="ar"${state.lang === 'ar' ? ' selected' : ''}>العربية</option><option value="both"${state.lang === 'both' ? ' selected' : ''}>Français + العربية</option></select>
            <button class="btn btn-primary btn-sm" data-act="print">🖨️ ${escH(ui('mc_print'))}</button>
            <button class="btn btn-outline btn-sm" data-act="word">📄 ${escH(ui('mc_word'))}</button>
            <button class="btn btn-outline btn-sm" data-act="reset">↺ ${escH(ui('mc_reset'))}</button>
          </div>
          <div class="mc-paper" id="mc-paper"></div>
        </div>
      </div>`;
    updatePaper();
  }

  function updatePaper() {
    const doc = cur(); if (!doc) return;
    const paper = document.getElementById('mc-paper'); if (!paper) return;
    const v = values(doc);
    const part = lg => `<div class="mc-part" dir="${lg === 'ar' ? 'rtl' : 'ltr'}" lang="${lg}">`
      + doc.build(v, lg)
      + `<p class="mc-fait" style="font-size:.72rem;color:#777;text-align:center">${lg === 'ar'
        ? 'نموذج استرشادي مُنشأ عبر dzimmo.dz — لا يغني عن استشارة قانونية.'
        : 'Modèle indicatif généré via dzimmo.dz — ne remplace pas un conseil juridique.'}</p></div>`;
    // « both » : version française puis version arabe, chacune sur sa page
    paper.setAttribute('dir', 'ltr');
    paper.innerHTML = state.lang === 'both' ? part('fr') + part('ar') : part(state.lang);
  }

  function downloadWord() {
    const doc = cur(); if (!doc) return;
    const ar = state.lang === 'ar';
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escH(doc.fr)}</title>
      <style>body{font-family:${ar ? "'Traditional Arabic',Arial" : "'Times New Roman',serif"};font-size:12pt;line-height:1.5}[dir=rtl]{font-family:'Traditional Arabic',Arial;font-size:14pt}.mc-part+.mc-part{page-break-before:always}h1{text-align:center;font-size:15pt}h3{font-size:12pt}
      table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:4px}.mc-blank{color:#888}.mc-sign{margin-top:40px}.mc-sign div{display:inline-block;width:48%;text-align:center}</style></head>
      <body dir="ltr">${document.getElementById('mc-paper').innerHTML}</body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' }));
    a.download = `${doc.id}_${state.lang}.doc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function bind() {
    const r = root();
    if (!r || r.dataset.bound) return;
    r.dataset.bound = '1';
    r.addEventListener('click', e => {
      const t = e.target.closest('[data-open],[data-list],[data-act]');
      if (!t) return;
      if (t.dataset.open) { state.doc = t.dataset.open; state.lang = curLang(); renderEditor(); window.scrollTo(0, 0); }
      else if (t.dataset.list) { renderList(); window.scrollTo(0, 0); }
      else if (t.dataset.act === 'print') window.print();
      else if (t.dataset.act === 'word') downloadWord();
      else if (t.dataset.act === 'reset') { delete state.values[state.doc]; renderEditor(); }
    });
    const onInput = e => {
      const f = e.target.dataset?.f;
      if (f && state.doc) { values(cur())[f] = e.target.value; updatePaper(); }
      else if (e.target.id === 'mc-lang') { state.lang = e.target.value; updatePaper(); }
    };
    r.addEventListener('input', onInput);
    r.addEventListener('change', onInput);
  }

  // Impression : on n'affiche que le document
  window.addEventListener('beforeprint', () => {
    if (typeof currentPage !== 'undefined' && currentPage === 'contrats' && state.doc) document.body.classList.add('mc-printing');
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('mc-printing'));

  window.MC = {
    // Ouvre la page (liste ou éditeur en cours) ; re-rendu au changement de langue de l'interface
    open() {
      injectStyle(); bind();
      if (state.doc) renderEditor(); else renderList();
    },
    // Changement de langue du site : le document suit la nouvelle langue
    refresh() { state.lang = curLang(); if (root()) this.open(); },
  };
})();
