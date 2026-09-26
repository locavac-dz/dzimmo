// ── Fiche imprimable d'une annonce : /annonce/12-titre/fiche (et /ar/…) ──────────────────────────────────────────
// Une page A4 rendue par le serveur (pas par la SPA) : photos, prix, caractéristiques, contact et un QR code qui renvoie vers l'annonce en ligne.
// Faite pour être imprimée (vitrine d'agence, panneau, remise en main propre) ou enregistrée en PDF par le navigateur.
//   • Aucune donnée de plus que la fiche publique : le téléphone de l'annonceur y figure déjà, jamais son email ni son identifiant.
//   • Tout texte issu d'une annonce passe par esc() ; les images par images.isListingImage (fichier du site ou liste blanche), puis esc().
//   • Le QR est un SVG produit ici (qrcode-generator) : aucun service tiers, aucune requête sortante. Il pointe vers l'adresse canonique
//     de l'annonce dans la langue de la fiche (siteUrl / APP_URL, jamais un lien en dur).
//   • Pas de <style> ni de <script> en ligne : /fiche.css et /fiche.js (bouton « Imprimer »). Page jamais indexée (noindex).
const qrcode = require('qrcode-generator');
const db     = require('./db');
const images = require('./images');
const { textOf } = require('./seo-text');

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MAX_DESCRIPTION = 900;    // caractères : la fiche tient sur une page
const MAX_PHOTOS      = 4;      // une grande photo et trois petites
const UPLOADS         = '/uploads/';

// Équipements : mêmes libellés que le site (feat_* de public/app.js, test tests/unit/fiche.test.js) ; une clé inconnue est ignorée
const FEATURES = {
  fr: { meuble: 'Meublé', parking: 'Parking', balcon: 'Balcon', terrasse: 'Terrasse', ascenseur: 'Ascenseur', gardien: 'Gardien', piscine: 'Piscine',
        climatisation: 'Climatisation', chauffage: 'Chauffage', wifi: 'Wi-Fi', cave: 'Cave', jardin: 'Jardin', alarme: 'Alarme', interphone: 'Interphone',
        eau: 'Eau', electricite: 'Électricité', gaz: 'Gaz', route: 'Accès route', fibre: 'Fibre' },
  ar: { meuble: 'مفروش', parking: 'موقف سيارات', balcon: 'شرفة', terrasse: 'تراس', ascenseur: 'مصعد', gardien: 'حارس', piscine: 'مسبح',
        climatisation: 'تكييف', chauffage: 'تدفئة', wifi: 'واي فاي', cave: 'قبو', jardin: 'حديقة', alarme: 'جهاز إنذار', interphone: 'إنتركوم',
        eau: 'ماء', electricite: 'كهرباء', gaz: 'غاز', route: 'مدخل على الطريق', fibre: 'ألياف بصرية' },
};

const TEXT = {
  fr: {
    title: (name) => `Fiche : ${name} | DzImmo`,
    sheet: 'Fiche du bien', ref: 'Réf.', description: 'Description', features: 'Équipements', contact: 'Contact', agency: 'Agence', advertiser: 'Annonceur',
    scan: 'Scannez pour voir l’annonce en ligne, les photos et contacter l’annonceur.', scanLabel: 'Code QR de l’annonce',
    noPhone: 'Contactez l’annonceur depuis l’annonce en ligne.',
    disclaimer: 'Informations fournies par l’annonceur, non vérifiées par DzImmo. Visitez et vérifiez le bien avant toute décision.',
    status: { sold: 'Vendu', rented: 'Loué' },
    print: 'Imprimer la fiche', back: 'Retour à l’annonce',
    baths: n => `${n} salle${n > 1 ? 's' : ''} de bain`,
    floor: (n, total) => n === 0 ? 'Rez-de-chaussée' : `Étage ${n}${total ? ` sur ${total}` : ''}`,
    photo: 'Photo',
    conditions: { brut: 'Brut (gros œuvre)', semi_fini: 'Semi-fini', renove: 'Rénové', bon_etat: 'Bon état', neuf: 'Neuf / Clé en main' },
  },
  ar: {
    title: (name) => `بطاقة العقار: ${name} | DzImmo`,
    sheet: 'بطاقة العقار', ref: 'المرجع', description: 'الوصف', features: 'التجهيزات', contact: 'الاتصال', agency: 'وكالة', advertiser: 'المعلن',
    scan: 'امسح الرمز لعرض الإعلان على الإنترنت والصور والتواصل مع المعلن.', scanLabel: 'رمز QR للإعلان',
    noPhone: 'تواصل مع المعلن من خلال الإعلان على الإنترنت.',
    disclaimer: 'المعلومات مقدَّمة من المعلن ولم يتحقق منها DzImmo. عاين العقار وتحقق منه قبل اتخاذ أي قرار.',
    status: { sold: 'مباع', rented: 'مؤجَّر' },
    print: 'طباعة البطاقة', back: 'العودة إلى الإعلان',
    baths: n => n === 1 ? 'حمّام واحد' : n === 2 ? 'حمّامان' : n <= 10 ? `${n} حمّامات` : `${n} حمّامًا`,
    floor: (n, total) => n === 0 ? 'الطابق الأرضي' : `الطابق ${n}${total ? ` من ${total}` : ''}`,
    photo: 'صورة',
    conditions: { brut: 'هيكل خام (بيتون)', semi_fini: 'نصف تشطيب', renove: 'مجدَّد', bon_etat: 'حالة جيدة', neuf: 'جديد / تسليم فوري' },
  },
};

// Adresse d'affichage d'une photo : miniature de 960 px pour un fichier .webp du site, sinon l'adresse validée ; null si elle n'est pas acceptée
function photoSrc(url) {
  if (!images.isListingImage(url)) return null;                    // la forme du chemin est contrôlée par server/images.js, seule source de la règle
  return images.isUpload(url) && /\.webp$/i.test(url) ? `${UPLOADS}thumbs/960/${url.slice(UPLOADS.length)}` : url;
}

const photosOf = p => [...new Set([p.image, ...(Array.isArray(p.photos) ? p.photos : [])].filter(Boolean))]
  .map(photoSrc).filter(Boolean).slice(0, MAX_PHOTOS);

// Nombre entier positif, ou null (un champ vide ou absurde n'est pas affiché)
const count = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : null; };

// SVG du QR code (correction d'erreur M, adaptatif) : la balise est produite par la bibliothèque, seule la donnée vient de nous
function qrSvg(url) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// Annonce + coordonnées publiques de l'annonceur, en une seule requête
async function load(id) {
  const r = await db.pool.query(
    `SELECT p.*, u.name AS owner_name, u.phone AS owner_phone, a.name AS agency_name, a.phone AS agency_phone
       FROM properties p
       JOIN users u ON u.id = p.owner_id
       LEFT JOIN agencies a ON a.id = p.agency_id
      WHERE p.id = $1`, [id]);
  return r.rows[0] || null;
}

// Page complète. `pageUrl` = adresse absolue de l'annonce en ligne (celle du QR), `backPath` = chemin de la fiche publique.
function render(p, { lang, pageUrl, backPath }) {
  const tx = TEXT[lang] || TEXT.fr, t = textOf(lang);
  const type = t.type[p.type_bien] || '', mode = t.mode[p.mode] || '';
  const place = [p.commune, t.wilaya(p.wilaya)].filter(Boolean).join(t.sep);
  const rooms = count(p.rooms), baths = count(p.baths), area = Number(p.surface_m2) > 0 ? Number(p.surface_m2) : null;
  const floor = p.floor === null || p.floor === undefined || !Number.isFinite(Number(p.floor)) ? null : Math.floor(Number(p.floor));

  const facts = [
    area && ['📐', t.area(area)],
    rooms && ['🚪', t.rooms(rooms)],
    baths && ['🛁', tx.baths(baths)],
    floor !== null && ['🏢', tx.floor(floor, count(p.total_floors))],
    p.condition && tx.conditions?.[p.condition] && ['🏗️', tx.conditions[p.condition]],
  ].filter(Boolean);

  const labels = FEATURES[lang] || FEATURES.fr;
  const feats = (Array.isArray(p.features) ? p.features : []).filter(k => typeof k === 'string' && Object.hasOwn(labels, k)).map(k => labels[k]);

  const photos = photosOf(p);
  const gallery = photos.length ? `
    <div class="photos photos-${photos.length}">
      ${photos.map((src, i) => `<img src="${esc(src)}" alt="${esc(tx.photo)} ${i + 1}">`).join('\n      ')}
    </div>` : '';

  const description = String(p.description || '').replace(/\s+/g, ' ').trim();
  const shown = description.length > MAX_DESCRIPTION ? description.slice(0, MAX_DESCRIPTION - 1).trimEnd() + '…' : description;

  const phone = p.agency_phone || p.owner_phone;
  const who = p.agency_name ? `${tx.agency} : ${p.agency_name}` : `${tx.advertiser} : ${p.owner_name || ''}`;
  const contact = `
    <section class="box contact">
      <h2>${esc(tx.contact)}</h2>
      <p class="who">${esc(who)}</p>
      ${phone ? `<p class="phone" dir="ltr">${esc(phone)}</p>` : `<p class="muted">${esc(tx.noPhone)}</p>`}
    </section>`;

  const status = tx.status[p.status];
  return `<!DOCTYPE html>
<html lang="${t.lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(tx.title(p.title))}</title>
<link rel="stylesheet" href="/fiche.css">
<script src="/fiche.js" defer></script>
</head>
<body>
<div class="toolbar">
  <a class="back" href="${esc(backPath)}">${esc(tx.back)}</a>
  <button type="button" id="fiche-print">🖨️ ${esc(tx.print)}</button>
</div>
<main class="sheet">
  <header class="head">
    <span class="brand">DzImmo</span>
    <span class="kind">${esc(tx.sheet)} · ${esc(tx.ref)} ${Number(p.id)}</span>
  </header>
  <p class="type">${esc(`${type} ${mode}`.trim())}${status ? ` <span class="status">${esc(status)}</span>` : ''}</p>
  <h1>${esc(p.title)}</h1>
  <p class="place">📍 ${esc(place)}${p.address ? `<span class="addr"> — ${esc(p.address)}</span>` : ''}</p>
  <p class="price">${esc(t.price(p.price, p.mode))}</p>
  ${gallery}
  ${facts.length ? `<ul class="facts">${facts.map(([icon, text]) => `<li><span aria-hidden="true">${icon}</span> ${esc(text)}</li>`).join('')}</ul>` : ''}
  ${shown ? `<section><h2>${esc(tx.description)}</h2><p class="desc">${esc(shown)}</p></section>` : ''}
  ${feats.length ? `<section><h2>${esc(tx.features)}</h2><ul class="chips">${feats.map(f => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}
  <div class="bottom">
    ${contact}
    <section class="box qr">
      <div class="qr-code" role="img" aria-label="${esc(tx.scanLabel)}">${qrSvg(pageUrl)}</div>
      <p>${esc(tx.scan)}</p>
      <p class="url" dir="ltr">${esc(pageUrl)}</p>
    </section>
  </div>
  <p class="disclaimer">${esc(tx.disclaimer)}</p>
</main>
</body>
</html>
`;
}

module.exports = { load, render, qrSvg, photoSrc, FEATURES, MAX_DESCRIPTION, MAX_PHOTOS };
