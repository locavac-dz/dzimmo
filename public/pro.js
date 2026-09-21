// ── Vitrine des agences et des promoteurs ────────────────────────────────────────────────────────────────────────
// Annuaire, fiche d'un professionnel, programmes neufs, et gestion depuis le tableau de bord (« Ma vitrine »).
// Chargé AVANT le script principal de index.html (le lien direct /agence/12-nom appelle showPage dès init) : rien ne
// s'exécute au chargement, T(), api(), esc()… sont résolus à l'appel. Toute donnée affichée passe par esc() ; les images
// et les liens ont déjà été validés par le serveur (server/agency.js), l'échappement reste la règle côté page.

const PRO_SERVICES = ['vente', 'location', 'location_courte', 'neuf', 'gestion', 'estimation', 'accompagnement'];
const PRO_FEATURES = ['ascenseur', 'parking', 'espaces_verts', 'securite', 'aire_jeux', 'commerces', 'gaz_ville', 'fibre'];
const PRO_STATUSES = ['sur_plan', 'en_construction', 'livre'];

const _pro  = { kind: '', page: 1, pages: 1, kinds: null, timer: null };          // annuaire des professionnels
const _prog = { page: 1, pages: 1, agency: null, agencyName: '', timer: null };   // annuaire des programmes
const _agl  = { id: null, mode: '', type: '', page: 1, pages: 1 };                // annonces sur la fiche d'un professionnel
const _vt   = { mine: null, logo: '', cover: '', services: [], coverage: [] };    // formulaire « Ma vitrine »
const _pg   = { id: null, photos: [], features: [] };                             // formulaire d'un programme

const PRO_SPINNER = '<div class="loading"><div class="spinner"></div></div>';

// ── Adresses ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Mêmes adresses que server/seo.js (agencyPath / projectPath) : /agence/12-nom, /promoteur/7-nom, /programme/5-nom
const proSlug   = s => { const x = slugify(s); return x ? '-' + x : ''; };
const proPath   = a => `/${a.kind === 'promoteur' ? 'promoteur' : 'agence'}/${a.id}${proSlug(a.name)}`;
const progPath  = p => `/programme/${p.id}${proSlug(p.name)}`;
// Adresse dans la langue affichée (/ar/agence/12-nom en arabe) : liens, adresse du navigateur et lien partagé
const proHref   = a => langPath(proPath(a));
const progHref  = p => langPath(progPath(p));

// Clic sur un lien de carte : navigation dans la SPA, sauf Ctrl/Cmd/Maj/clic milieu (le navigateur ouvre alors le vrai lien)
function proGo(e, page, data) {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return true;
  e.preventDefault();
  showPage(page, data);
  return false;
}

// ── Éléments communs ─────────────────────────────────────────────────────────────────────────────────────────────────
function starsHTML(rating) {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return `<span class="pro-stars" aria-label="${n} / 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
}

function proLogoHTML(a, cls = '') {
  const initial = esc([...String(a.name || '?').trim()][0] || '?').toUpperCase();
  return a.logo
    ? `<img class="pro-logo ${cls}" src="${esc(thumbUrl(a.logo, 480))}" alt="${esc(a.name)}" loading="lazy">`
    : `<div class="pro-logo pro-logo-init ${cls}">${initial}</div>`;
}

const proVerifiedHTML = () => `<span class="pro-badge pro-badge-ok" title="${esc(T('pro_verified_tip'))}">✓ ${T('pro_verified')}</span>`;
const proKindHTML = kind => `<span class="pro-badge">${kind === 'promoteur' ? '🏗' : '🏢'} ${T('kind_' + (kind === 'promoteur' ? 'promoteur' : 'agence'))}</span>`;
const proChips = (keys, prefix, max = 99) => (keys || []).slice(0, max).map(k => `<span class="pro-chip">${esc(T(prefix + k))}</span>`).join('');

// Numéro d'un professionnel : « Appeler » et, pour un mobile, « WhatsApp » avec le message donné (parsePhone vient du script principal)
function proContactHTML(a, text) {
  const ph = parsePhone(a.phone);
  if (!ph) return '';
  return `<a class="btn btn-primary" href="tel:+${ph.intl}">📞 ${T('det_call')} <span dir="ltr">${esc(ph.national)}</span></a>` +
    (ph.mobile ? `<a class="btn btn-outline pro-wa" href="https://wa.me/${ph.intl}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">💬 ${T('det_whatsapp')}</a>` : '');
}

// Onglets Agences / Promoteurs / Programmes neufs, communs aux deux annuaires
function renderProTabs() {
  const onProg = currentPage === 'programmes';
  const k = _pro.kinds;
  const tabs = [['all', '', 'pro_tab_all', k ? k.agence + k.promoteur : null], ['agence', 'agence', 'pro_tab_agence', k ? k.agence : null],
                ['promoteur', 'promoteur', 'pro_tab_promoteur', k ? k.promoteur : null], ['prog', null, 'pro_tab_prog', null]];
  const html = tabs.map(([id, kind, key, n]) => {
    const active = id === 'prog' ? onProg : (!onProg && _pro.kind === kind);
    return `<button class="${active ? 'active' : ''}" onclick="proTab('${id}')">${T(key)}${n !== null ? ` <small>${n}</small>` : ''}</button>`;
  }).join('');
  document.querySelectorAll('.pro-tabs').forEach(el => { el.innerHTML = html; });
}

function proTab(id) {
  if (id === 'prog') { _prog.agency = null; return showPage('programmes'); }
  _pro.kind = id === 'all' ? '' : id;
  if (currentPage === 'agences') loadAgences(1); else showPage('agences');
}

// ── Annuaire des professionnels ──────────────────────────────────────────────────────────────────────────────────────
function proCardHTML(a) {
  const counts = [
    a.property_count ? `🏠 <b>${a.property_count}</b> ${unit(a.property_count, 'st_ad')}` : '',
    a.project_count ? `🏗 <b>${a.project_count}</b> ${unit(a.project_count, 'u_prog')}` : '',
  ].filter(Boolean).join(' · ');
  return `
  <a class="pro-card" href="${esc(proHref(a))}" onclick="return proGo(event,'agency-detail',${a.id})">
    ${a.cover ? `<img class="pro-cover" ${imgAttrs(a.cover, '(max-width: 720px) 100vw, 330px')} alt="" loading="lazy">` : '<div class="pro-cover pro-cover-none"></div>'}
    ${proLogoHTML(a, 'pro-logo-card')}
    <div class="pro-card-body">
      <div class="pro-card-name">${esc(a.name)}</div>
      <div class="pro-badges">${a.verified ? proVerifiedHTML() : ''}${proKindHTML(a.kind)}</div>
      ${a.tagline ? `<p class="pro-tagline">${esc(a.tagline)}</p>` : ''}
      <div class="pro-meta">📍 ${esc(a.commune ? a.commune + ', ' : '')}${esc(wilayaName(a.wilaya))}
        ${a.rating ? `<span class="pro-rate">${starsHTML(a.rating)} <b>${a.rating}</b> <small>(${a.review_count})</small></span>` : ''}</div>
      <div class="pro-chips">${proChips(a.services, 'svc_', 3)}</div>
      ${counts ? `<div class="pro-counts">${counts}</div>` : ''}
    </div>
  </a>`;
}

async function loadAgences(page = 1) {
  const grid = document.getElementById('agences-grid');
  const more = document.getElementById('agences-more');
  if (page === 1) grid.innerHTML = PRO_SPINNER;
  more.innerHTML = '';
  const val = id => (document.getElementById(id) || {}).value || '';
  const qs = new URLSearchParams({ page, per_page: 12 });
  if (_pro.kind) qs.set('kind', _pro.kind);
  if (val('ag-q').trim()) qs.set('q', val('ag-q').trim());
  if (val('ag-wilaya')) qs.set('wilaya', val('ag-wilaya'));
  if (val('ag-sort')) qs.set('sort', val('ag-sort'));
  if (document.getElementById('ag-verified')?.checked) qs.set('verified', '1');
  history.replaceState(null, '', langPath(_pro.kind === 'promoteur' ? '/promoteurs' : '/agences'));
  document.title = T(_pro.kind === 'promoteur' ? 'pro_title_promoteur' : 'pro_title_all') + ' | DzImmo';
  try {
    const r = await api('/agencies?' + qs);
    _pro.page = r.page; _pro.pages = r.pages; _pro.kinds = r.kinds;
    renderProTabs();
    document.getElementById('agences-count').textContent = `${r.total} ${unit(r.total, 'u_pro')}`;
    if (!r.items.length && page === 1) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🏢</div><h3>${T('pro_none')}</h3></div>`;
      return;
    }
    const html = r.items.map(proCardHTML).join('');
    if (page === 1) grid.innerHTML = html; else grid.insertAdjacentHTML('beforeend', html);
    if (r.page < r.pages) more.innerHTML = `<button class="btn btn-outline" onclick="loadAgences(${r.page + 1})">${T('pro_more')}</button>`;
  } catch (e) { grid.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; }
}

// Filtres : la saisie attend une courte pause, les listes déroulantes agissent aussitôt
function proFilterChanged(now) {
  clearTimeout(_pro.timer);
  _pro.timer = setTimeout(() => loadAgences(1), now ? 0 : 300);
}

// ── Programmes neufs : cartes et annuaire ────────────────────────────────────────────────────────────────────────────
function deliveryText(p) {
  if (!p.delivery_year) return '';
  if (p.status === 'livre') return T('pg_delivered').replace('{y}', p.delivery_year);
  return T('pg_delivery_at').replace('{when}', (p.delivery_quarter ? T('pg_q_short') + p.delivery_quarter + ' ' : '') + p.delivery_year);
}

const progStatusHTML = st => `<span class="pg-status pg-${esc(st)}">${T('pg_st_' + st)}</span>`;

function progCardHTML(p) {
  return `
  <a class="pro-card pg-card" href="${esc(progHref(p))}" onclick="return proGo(event,'programme-detail',${p.id})">
    ${p.image ? `<img class="pro-cover" ${imgAttrs(p.image, '(max-width: 720px) 100vw, 330px')} alt="${esc(p.name)}" loading="lazy">` : '<div class="pro-cover pro-cover-none"></div>'}
    <div class="pro-card-body">
      <div class="pg-card-top">${progStatusHTML(p.status)}${deliveryText(p) ? `<span class="pg-when">${esc(deliveryText(p))}</span>` : ''}</div>
      <div class="pro-card-name">${esc(p.name)}</div>
      <div class="pro-meta">📍 ${esc(p.commune ? p.commune + ', ' : '')}${esc(wilayaName(p.wilaya))}</div>
      ${p.price_from != null ? `<div class="pg-price">${T('pg_from')} <b>${formatPrice(p.price_from)} ${T('u_dzd')}</b></div>` : ''}
      <div class="pro-counts">${p.available_count ? `🏠 <b>${p.available_count}</b> ${unit(p.available_count, 'u_lot_avail')}` : ''}${p.sold_count ? `${p.available_count ? ' · ' : ''}✅ <b>${p.sold_count}</b> ${unit(p.sold_count, 'u_lot_sold')}` : ''}</div>
      <div class="pg-by">${proLogoHTML({ name: p.agency_name, logo: p.agency_logo }, 'pro-logo-mini')} <span>${esc(p.agency_name)}</span>${p.agency_verified ? ' <span class="pro-ok" title="' + esc(T('pro_verified_tip')) + '">✓</span>' : ''}</div>
    </div>
  </a>`;
}

async function loadProgrammes(page = 1) {
  const grid = document.getElementById('programmes-grid');
  const more = document.getElementById('programmes-more');
  if (page === 1) grid.innerHTML = PRO_SPINNER;
  more.innerHTML = '';
  const val = id => (document.getElementById(id) || {}).value || '';
  const qs = new URLSearchParams({ page, per_page: 12 });
  if (val('pg-q').trim()) qs.set('q', val('pg-q').trim());
  if (val('pg-wilaya')) qs.set('wilaya', val('pg-wilaya'));
  if (val('pg-status')) qs.set('status', val('pg-status'));
  if (_prog.agency) qs.set('agency_id', _prog.agency);
  history.replaceState(null, '', langPath('/programmes'));
  document.title = T('pro_title_prog') + ' | DzImmo';
  renderProTabs();
  const filter = document.getElementById('programmes-agency');
  filter.innerHTML = _prog.agency
    ? `<button class="pro-chip pro-chip-x" onclick="_prog.agency=null;loadProgrammes(1)">${T('pg_of')} ${esc(_prog.agencyName)} ✕</button>` : '';
  try {
    const r = await api('/projects?' + qs);
    document.getElementById('programmes-count').textContent = `${r.total} ${unit(r.total, 'u_prog')}`;
    if (!r.items.length && page === 1) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🏗</div><h3>${T('pg_none')}</h3></div>`;
      return;
    }
    const html = r.items.map(progCardHTML).join('');
    if (page === 1) grid.innerHTML = html; else grid.insertAdjacentHTML('beforeend', html);
    if (r.page < r.pages) more.innerHTML = `<button class="btn btn-outline" onclick="loadProgrammes(${r.page + 1})">${T('pro_more')}</button>`;
  } catch (e) { grid.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; }
}

function proProgrammesOf(id, name) { _prog.agency = id; _prog.agencyName = name; showPage('programmes'); }

// ── Fiche d'un professionnel ─────────────────────────────────────────────────────────────────────────────────────────
function proShare() {
  const url = location.origin + location.pathname;
  if (navigator.share) navigator.share({ title: document.title, url }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast(T('ag_link_copied'))).catch(() => {});
}

function proGoVitrine() { currentDashTab = 'vitrine'; showPage('dashboard'); }

async function loadAgencyDetail(id) {
  const c = document.getElementById('agency-detail-content');
  c.innerHTML = PRO_SPINNER;
  try {
    const a = await api('/agencies/' + id);
    window._agency = a;
    history.replaceState(null, '', proHref(a));
    document.title = `${a.name} — ${T('kind_' + a.kind)} | DzImmo`;
    const ph = a.phone;
    const year = new Date().getFullYear();
    const exp = a.founded_year ? year - a.founded_year : 0;
    const tiles = [
      [a.property_count, unit(a.property_count, 'st_ad')],
      a.done_count ? [a.done_count, T('ag_stat_done')] : null,
      a.review_count ? [`★ ${a.rating}`, `${a.review_count} ${unit(a.review_count, 'u_review')}`] : null,
      a.founded_year ? [exp > 0 ? `${exp} ${unit(exp, 'u_year')}` : a.founded_year, T('ag_stat_exp')] : [new Date(a.created_at).getFullYear(), T('ag_stat_since')],
    ].filter(Boolean);
    const links = [
      a.website ? [a.website, '🌐', T('ag_website_short')] : null, a.facebook ? [a.facebook, 'f', 'Facebook'] : null, a.instagram ? [a.instagram, '◎', 'Instagram'] : null,
    ].filter(Boolean).map(([href, ico, label]) => `<a class="pro-link" href="${esc(href)}" target="_blank" rel="noopener nofollow">${ico} ${label}</a>`).join('');
    const mapQ = encodeURIComponent([a.address, a.commune, wilayaName(a.wilaya), 'Algérie'].filter(Boolean).join(', '));
    const about = a.description || (a.services || []).length || (a.coverage || []).length || a.hours || a.address;
    const modes = [['', 'ag_filter_all'], ['vente', 's_vente'], ['location_longue', 's_loc_longue'], ['location_courte', 's_loc_courte']];
    const typeKeys = [['', 's_all_types'], ['appartement', 's_appart'], ['villa', 's_villa'], ['maison', 's_maison'], ['bureau', 's_bureau'],
                      ['local_commercial', 's_local'], ['terrain', 's_terrain'], ['ferme', 's_ferme'], ['entrepot', 's_entrepot']];
    Object.assign(_agl, { id: a.id, mode: '', type: '', page: 1, pages: 1 });

    c.innerHTML = `
    <div class="pro-page">
      <header class="pro-head">
        ${a.cover ? `<img class="pro-head-cover" ${imgAttrs(a.cover, '(max-width: 1040px) 100vw, 1040px', [960])} alt="">` : '<div class="pro-head-cover pro-cover-none"></div>'}
        <div class="pro-head-body">
          ${proLogoHTML(a, 'pro-logo-lg')}
          <div class="pro-head-text">
            <h1>${esc(a.name)}</h1>
            <div class="pro-badges">${a.verified ? proVerifiedHTML() : ''}${proKindHTML(a.kind)}${a.founded_year ? `<span class="pro-badge">${T('ag_founded').replace('{y}', a.founded_year)}</span>` : ''}</div>
            ${a.tagline ? `<p class="pro-tagline-lg">${esc(a.tagline)}</p>` : ''}
            <div class="pro-meta">📍 ${esc(a.commune ? a.commune + ', ' : '')}${esc(wilayaName(a.wilaya))}
              ${a.rating ? `<span class="pro-rate">${starsHTML(a.rating)} <b>${a.rating}</b> <small>(${a.review_count})</small></span>` : ''}</div>
          </div>
        </div>
      </header>
      <div class="pro-actions">
        ${proContactHTML(a, T('ag_wa_msg').replace('{name}', a.name).replace('{url}', location.origin + proHref(a)))}${links}
        <button class="btn btn-outline" onclick="proShare()">🔗 ${T('ag_share')}</button>
        ${a.is_mine ? `<button class="btn btn-outline" onclick="proGoVitrine()">✏️ ${T('ag_edit')}</button>` : ''}
      </div>
      ${a.verified ? '' : `<p class="pro-unverified">ℹ️ ${T('ag_unverified')}</p>`}
      <div class="pro-tiles">${tiles.map(([v, l]) => `<div class="pro-tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
      <nav class="pro-anchors">
        ${about ? `<a href="#pro-about" onclick="proScroll(event,'pro-about')">${T('ag_sec_about')}</a>` : ''}
        ${(a.programmes || []).length ? `<a href="#pro-progs" onclick="proScroll(event,'pro-progs')">${T('ag_sec_programmes')}</a>` : ''}
        <a href="#pro-listings" onclick="proScroll(event,'pro-listings')">${T('ag_sec_listings')}</a>
        ${(a.reviews || []).length ? `<a href="#pro-reviews" onclick="proScroll(event,'pro-reviews')">${T('ag_sec_reviews')}</a>` : ''}
      </nav>

      ${about ? `
      <section id="pro-about" class="pro-section">
        <h2>${T('ag_sec_about')}</h2>
        ${a.description ? `<p class="pro-desc">${esc(a.description)}</p>` : ''}
        <dl class="pro-facts">
          ${(a.services || []).length ? `<dt>${T('ag_services')}</dt><dd>${proChips(a.services, 'svc_')}</dd>` : ''}
          ${(a.coverage || []).length ? `<dt>${T('ag_coverage')}</dt><dd>${(a.coverage || []).map(w => `<span class="pro-chip">${esc(wilayaName(w))}</span>`).join('')}</dd>` : ''}
          ${a.hours ? `<dt>${T('ag_hours')}</dt><dd>${esc(a.hours)}</dd>` : ''}
          ${a.address || a.commune ? `<dt>${T('ag_address')}</dt><dd>${esc([a.address, a.commune, wilayaName(a.wilaya)].filter(Boolean).join(', '))}
            · <a class="pro-maplink" href="https://www.google.com/maps/search/?api=1&query=${mapQ}" target="_blank" rel="noopener">${T('ag_map')}</a></dd>` : ''}
        </dl>
      </section>` : ''}

      ${(a.programmes || []).length ? `
      <section id="pro-progs" class="pro-section">
        <h2>${T('ag_sec_programmes')} <small>${a.project_count}</small></h2>
        <div class="grid pro-grid">${a.programmes.map(progCardHTML).join('')}</div>
        ${a.project_count > a.programmes.length ? `<p style="text-align:center;margin-top:1rem"><button class="btn btn-outline" data-id="${Number(a.id)}" data-name="${esc(a.name)}" onclick="proProgrammesOf(Number(this.dataset.id), this.dataset.name)">${T('ag_all_programmes')}</button></p>` : ''}
      </section>` : ''}

      <section id="pro-listings" class="pro-section">
        <h2>${T('ag_sec_listings')} <small>${a.property_count}</small></h2>
        <div class="pro-filterbar">
          <div class="pro-seg" id="agl-modes">${modes.map(([v, k]) => `<button class="${v === '' ? 'active' : ''}" data-v="${v}" onclick="agencyFilter('mode','${v}')">${T(k)}</button>`).join('')}</div>
          <select id="agl-type" onchange="agencyFilter('type', this.value)">${typeKeys.map(([v, k]) => `<option value="${v}">${T(k)}</option>`).join('')}</select>
        </div>
        <div class="grid" id="agl-grid">${PRO_SPINNER}</div>
        <div class="pro-more" id="agl-more"></div>
      </section>

      ${(a.reviews || []).length ? `
      <section id="pro-reviews" class="pro-section">
        <h2>${T('ag_sec_reviews')} <small>${a.review_count}</small></h2>
        <div class="pro-reviews">${a.reviews.map(r => `
          <article class="pro-review">
            <div class="pro-review-top">${starsHTML(r.rating)} <b>${esc(r.author_name || T('det_anon'))}</b>
              <span class="pro-review-date">${new Date(r.created_at).toLocaleDateString('fr-DZ')}</span></div>
            ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
            <a class="pro-review-on" href="${langPath('/annonce/' + r.property_id)}" onclick="return proGo(event,'detail',${r.property_id})">${T('ag_review_on')} ${esc(r.property_title)}</a>
          </article>`).join('')}</div>
      </section>` : ''}
    </div>`;
    agencyListings(1);
  } catch (e) { c.innerHTML = `<p style="color:red;padding:2rem">${esc(e.message)}</p>`; }
}

function proScroll(e, id) {
  e.preventDefault();
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Annonces du professionnel : filtres par mode et par type, « voir plus »
function agencyFilter(what, value) {
  _agl[what] = value;
  if (what === 'mode') document.querySelectorAll('#agl-modes button').forEach(b => b.classList.toggle('active', b.dataset.v === value));
  agencyListings(1);
}

async function agencyListings(page) {
  const grid = document.getElementById('agl-grid');
  const more = document.getElementById('agl-more');
  if (!grid) return;
  if (page === 1) grid.innerHTML = PRO_SPINNER;
  more.innerHTML = '';
  const qs = new URLSearchParams({ agency_id: _agl.id, page, limit: 12 });
  if (_agl.mode) qs.set('mode', _agl.mode);
  if (_agl.type) qs.set('type_bien', _agl.type);
  try {
    const r = await api('/properties?' + qs);
    if (!r.data.length && page === 1) { grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🏠</div><h3>${T('ag_no_listings')}</h3></div>`; return; }
    const html = r.data.map(cardHTML).join('');
    if (page === 1) grid.innerHTML = html; else grid.insertAdjacentHTML('beforeend', html);
    _agl.page = r.page; _agl.pages = r.pages;
    if (r.page < r.pages) more.innerHTML = `<button class="btn btn-outline" onclick="agencyListings(${r.page + 1})">${T('pro_more')}</button>`;
  } catch (e) { grid.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; }
}

// ── Fiche d'un programme neuf ────────────────────────────────────────────────────────────────────────────────────────
async function loadProgrammeDetail(id) {
  const c = document.getElementById('programme-detail-content');
  c.innerHTML = PRO_SPINNER;
  try {
    const p = await api('/projects/' + id);
    history.replaceState(null, '', progHref(p));
    document.title = `${p.name} — ${T('pg_title_suffix')} | DzImmo`;
    const photos = (Array.isArray(p.photos) && p.photos.length ? p.photos : [p.image]).filter(Boolean);
    const stock = p.total_units ? Math.min(100, Math.round(((p.sold_count || 0) / p.total_units) * 100)) : null;
    const agency = { id: p.agency_id, kind: p.agency_kind, name: p.agency_name, logo: p.agency_logo, phone: p.agency_phone, verified: p.agency_verified };
    window._pgPhotos = photos;   // lu par la visionneuse : jamais de données de la page dans un attribut onclick
    c.innerHTML = `
    <div class="pro-page">
      ${p.visible === false ? `<p class="pro-unverified">⚠ ${T('pg_hidden_note')}</p>` : ''}
      <div class="pg-gallery ${photos.length > 1 ? 'multi' : ''}">
        ${photos.length ? photos.slice(0, 3).map((u, i) => `<img ${imgAttrs(u, i ? '(max-width: 720px) 50vw, 33vw' : '(max-width: 720px) 100vw, 66vw', i ? [480, 960] : [960])} alt="${esc(p.name)}" onclick="openLightbox(window._pgPhotos, ${i})" loading="${i ? 'lazy' : 'eager'}">`).join('') : '<div class="pro-cover-none pg-nophoto"></div>'}
      </div>
      <div class="pg-head">
        <div>
          <div class="pg-card-top">${progStatusHTML(p.status)}${deliveryText(p) ? `<span class="pg-when">${esc(deliveryText(p))}</span>` : ''}</div>
          <h1>${esc(p.name)}</h1>
          <div class="pro-meta">📍 ${esc([p.address, p.commune, wilayaName(p.wilaya)].filter(Boolean).join(', '))}</div>
        </div>
        ${p.is_mine ? `<button class="btn btn-outline" onclick="proGoVitrine()">✏️ ${T('ag_edit')}</button>` : ''}
      </div>
      <div class="pro-tiles">
        ${p.price_from != null ? `<div class="pro-tile"><div class="v">${formatPrice(p.price_from)}</div><div class="l">${T('u_dzd')} · ${T('pg_from')}</div></div>` : ''}
        <div class="pro-tile"><div class="v">${p.available_count}</div><div class="l">${unit(p.available_count, 'u_lot_avail')}</div></div>
        ${p.sold_count ? `<div class="pro-tile"><div class="v">${p.sold_count}</div><div class="l">${unit(p.sold_count, 'u_lot_sold')}</div></div>` : ''}
        ${p.total_units ? `<div class="pro-tile"><div class="v">${p.total_units}</div><div class="l">${unit(p.total_units, 'u_lot_total')}</div></div>` : ''}
      </div>
      ${stock !== null ? `<div class="pg-progress" title="${stock} %"><div style="width:${stock}%"></div></div>` : ''}
      <div class="pg-cols">
        <div>
          ${p.description ? `<section class="pro-section"><h2>${T('ag_sec_about')}</h2><p class="pro-desc">${esc(p.description)}</p></section>` : ''}
          ${(p.features || []).length ? `<section class="pro-section"><h2>${T('pg_features')}</h2><div class="pro-chips">${proChips(p.features, 'pg_feat_')}</div></section>` : ''}
        </div>
        <aside class="pg-promoter">
          <div class="pg-by-lg">${proLogoHTML(agency, 'pro-logo-mini')}
            <div><a class="pg-by-name" href="${esc(proHref(agency))}" onclick="return proGo(event,'agency-detail',${p.agency_id})">${esc(p.agency_name)}</a>
              <div class="pro-badges">${p.agency_verified ? proVerifiedHTML() : ''}${proKindHTML(p.agency_kind)}</div></div></div>
          <div class="pro-actions stack">${proContactHTML(agency, T('pg_wa_msg').replace('{name}', p.name).replace('{url}', location.origin + progHref(p)))}</div>
        </aside>
      </div>
      <section class="pro-section">
        <h2>${T('pg_lots')}</h2>
        <div class="grid" id="pgl-grid">${PRO_SPINNER}</div>
      </section>
    </div>`;
    const lots = await api('/properties?' + new URLSearchParams({ project_id: p.id, limit: 50 }));
    document.getElementById('pgl-grid').innerHTML = lots.data.length ? lots.data.map(cardHTML).join('')
      : `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🏠</div><h3>${T('pg_no_lots')}</h3></div>`;
  } catch (e) { c.innerHTML = `<p style="color:red;padding:2rem">${esc(e.message)}</p>`; }
}

// ── Accueil : professionnels vérifiés à la une ───────────────────────────────────────────────────────────────────────
async function loadHomePros() {
  const box = document.getElementById('home-pros');
  if (!box) return;
  try {
    const r = await api('/agencies?verified=1&sort=listings&per_page=6');
    const list = document.getElementById('home-pros-grid');
    box.classList.toggle('hidden', !r.items.length);
    if (r.items.length) list.innerHTML = r.items.map(proCardHTML).join('');
  } catch { box.classList.add('hidden'); }
}

// ── Envoi d'une image (logo, couverture, photos de programme) ────────────────────────────────────────────────────────
async function proUpload(file) {
  if (!file) return null;
  if (file.size > 10 * 1024 * 1024) { toast(T('vt_img_big')); return null; }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch(API + '/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Lang': currentLang }, body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.url) { toast('❌ ' + (d.error || T('err_server'))); return null; }
    return d.url;
  } catch { toast('❌ ' + T('err_network')); return null; }
}

// ── Tableau de bord : « Ma vitrine » ─────────────────────────────────────────────────────────────────────────────────
const vtVal = id => ((document.getElementById(id) || {}).value || '').trim();

// Part du profil renseignée, et ce qui manque (les trois premiers manques sont proposés)
function vtCompleteness(m) {
  const checks = [
    ['logo', !!m.logo, 'vt_todo_logo'], ['cover', !!m.cover, 'vt_todo_cover'], ['tagline', !!m.tagline, 'vt_todo_tagline'],
    ['desc', (m.description || '').length >= 100, 'vt_todo_desc'], ['phone', !!m.phone, 'vt_todo_phone'],
    ['web', !!(m.website || m.facebook || m.instagram), 'vt_todo_web'], ['hours', !!m.hours, 'vt_todo_hours'],
    ['svc', (m.services || []).length > 0, 'vt_todo_services'], ['zone', (m.coverage || []).length > 0 || !!m.commune, 'vt_todo_zone'],
    ['year', !!m.founded_year, 'vt_todo_year'],
  ];
  const done = checks.filter(c => c[1]).length;
  return { pct: Math.round((done / checks.length) * 100), todo: checks.filter(c => !c[1]).map(c => c[2]).slice(0, 3) };
}

async function dashVitrine(c) {
  let mine = null;
  try { mine = await api('/agencies/mine/info'); }
  catch (e) { if (e.status !== 404) { c.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; return; } }
  Object.assign(_vt, { mine, logo: mine ? mine.logo || '' : '', cover: mine ? mine.cover || '' : '',
    services: mine ? [...(mine.services || [])] : [], coverage: mine ? [...(mine.coverage || [])] : [] });
  vtRender(c);
  if (mine && mine.kind === 'promoteur') pgRenderSection();
}

function vtRender(c = document.getElementById('dash-tab-content')) {
  const m = _vt.mine;
  const f = m || {};
  const comp = m ? vtCompleteness(m) : null;
  const kindOpt = (k, icon) => `<label class="vt-kind ${(f.kind || 'agence') === k ? 'on' : ''}"><input type="radio" name="vt-kind" value="${k}" ${(f.kind || 'agence') === k ? 'checked' : ''} onchange="vtKindChanged()">
    <span>${icon} <b>${T('kind_' + k)}</b><small>${T('vt_kind_' + k + '_hint')}</small></span></label>`;
  c.innerHTML = `
  <div class="vt-wrap">
    ${m ? `
    <div class="vt-status">
      <div>
        <div class="vt-status-title">${esc(m.name)} ${m.verified ? proVerifiedHTML() : ''}</div>
        <div class="vt-meter" title="${comp.pct} %"><div style="width:${comp.pct}%"></div></div>
        <div class="vt-meter-label">${T('vt_complete').replace('{p}', comp.pct)}${comp.todo.length ? ' — ' + comp.todo.map(k => T(k)).join(' · ') : ''}</div>
      </div>
      <a class="btn btn-outline" href="${esc(proHref(m))}" onclick="return proGo(event,'agency-detail',${m.id})">👁 ${T('vt_view')}</a>
    </div>
    ${m.verified ? `<p class="vt-ok">✓ ${T('vt_verified_ok')}</p>`
      : `<div class="vt-cta">🛡️ <div><b>${T('vt_verify_title')}</b><p>${T('vt_verify_text')}</p></div><button class="btn btn-primary" onclick="dashTab('verification')">${T('vt_verify_btn')}</button></div>`}
    ` : `
    <div class="vt-intro">
      <h3>${T('vt_intro_title')}</h3>
      <p>${T('vt_intro_text')}</p>
      <ul><li>${T('vt_benefit_1')}</li><li>${T('vt_benefit_2')}</li><li>${T('vt_benefit_3')}</li></ul>
    </div>`}

    <div class="vt-card">
      <h3>${T(m ? 'vt_profile' : 'vt_create_title')}</h3>
      <div class="vt-kinds">${kindOpt('agence', '🏢')}${kindOpt('promoteur', '🏗')}</div>
      <div class="vt-images">
        <div class="vt-img" id="vt-logo-box">${vtImgBoxHTML('logo')}</div>
        <div class="vt-img vt-img-wide" id="vt-cover-box">${vtImgBoxHTML('cover')}</div>
      </div>
      <div class="vt-grid">
        <div class="form-group full"><label>${T('vt_name')} *</label><input id="vt-name" maxlength="80" value="${esc(f.name || '')}"></div>
        <div class="form-group full"><label>${T('vt_tagline')}</label><input id="vt-tagline" maxlength="120" value="${esc(f.tagline || '')}" placeholder="${esc(T('vt_tagline_ph'))}"></div>
        <div class="form-group full"><label>${T('vt_desc')}</label><textarea id="vt-desc" rows="5" maxlength="3000" placeholder="${esc(T('vt_desc_ph'))}">${esc(f.description || '')}</textarea></div>
        <div class="form-group"><label>${T('vt_wilaya')} *</label><select id="vt-wilaya"></select></div>
        <div class="form-group"><label>${T('vt_commune')}</label><input id="vt-commune" maxlength="80" value="${esc(f.commune || '')}"></div>
        <div class="form-group full"><label>${T('vt_address')}</label><input id="vt-address" maxlength="200" value="${esc(f.address || '')}"></div>
        <div class="form-group"><label>${T('vt_phone')}</label><input id="vt-phone" type="tel" maxlength="30" value="${esc(f.phone || '')}"><div class="field-hint">${T('m_phone_hint')}</div></div>
        <div class="form-group"><label>${T('vt_founded')}</label><input id="vt-founded" type="number" min="1900" max="${new Date().getFullYear()}" value="${esc(f.founded_year || '')}" placeholder="2010"></div>
        <div class="form-group"><label>${T('vt_website')}</label><input id="vt-website" maxlength="200" value="${esc(f.website || '')}" placeholder="www.mon-agence.dz"></div>
        <div class="form-group"><label>${T('vt_hours')}</label><input id="vt-hours" maxlength="200" value="${esc(f.hours || '')}" placeholder="${esc(T('vt_hours_ph'))}"></div>
        <div class="form-group"><label>Facebook</label><input id="vt-facebook" maxlength="200" value="${esc(f.facebook || '')}" placeholder="@mon.agence"></div>
        <div class="form-group"><label>Instagram</label><input id="vt-instagram" maxlength="200" value="${esc(f.instagram || '')}" placeholder="@mon.agence"></div>
      </div>
      <div class="vt-block"><label class="vt-label">${T('vt_services')}</label>
        <div class="pro-chips" id="vt-services">${PRO_SERVICES.map(k => `<button type="button" class="pro-chip pro-chip-toggle ${_vt.services.includes(k) ? 'on' : ''}" data-v="${k}" onclick="vtToggleService('${k}',this)">${T('svc_' + k)}</button>`).join('')}</div></div>
      <div class="vt-block"><label class="vt-label">${T('vt_coverage')}</label>
        <div class="pro-chips" id="vt-coverage"></div>
        <select id="vt-coverage-add" onchange="vtAddCoverage(this)"></select></div>
      <div class="vt-actions">
        <button class="btn btn-primary" onclick="vtSave()">${T(m ? 'vt_save' : 'vt_create')}</button>
        ${m ? `<button class="btn btn-danger btn-sm" onclick="vtDelete()">${T('vt_delete')}</button>` : ''}
      </div>
    </div>
    <div id="pg-section"></div>
  </div>`;
  const opts = '<option value="">' + T('pub_choose') + '</option>' + WILAYAS.map(w => `<option value="${esc(w)}">${esc(wilayaName(w))}</option>`).join('');
  document.getElementById('vt-wilaya').innerHTML = opts;
  document.getElementById('vt-wilaya').value = f.wilaya || '';
  document.getElementById('vt-coverage-add').innerHTML = `<option value="">＋ ${T('vt_coverage_add')}</option>` + WILAYAS.map(w => `<option value="${esc(w)}">${esc(wilayaName(w))}</option>`).join('');
  vtRenderCoverage();
}

function vtKindChanged() {
  document.querySelectorAll('.vt-kind').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
}

function vtImgBoxHTML(which) {
  const url = _vt[which];
  return `${url ? `<img src="${esc(thumbUrl(url, 480))}" alt="">` : `<div class="vt-img-empty">${which === 'logo' ? '🏢' : '🖼'}</div>`}
    <div class="vt-img-cap"><b>${T('vt_' + which)}</b><small>${T('vt_' + which + '_hint')}</small>
      <div><button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('vt-${which}-file').click()">${T('vt_upload')}</button>
      ${url ? `<button type="button" class="btn btn-outline btn-sm" onclick="vtClearImage('${which}')">${T('vt_remove')}</button>` : ''}</div>
      <input id="vt-${which}-file" type="file" accept="image/*" style="display:none" onchange="vtPickImage('${which}', this)"></div>`;
}

async function vtPickImage(which, input) {
  const url = await proUpload(input.files[0]);
  input.value = '';
  if (!url) return;
  _vt[which] = url;
  document.getElementById('vt-' + which + '-box').innerHTML = vtImgBoxHTML(which);
}
function vtClearImage(which) { _vt[which] = ''; document.getElementById('vt-' + which + '-box').innerHTML = vtImgBoxHTML(which); }

function vtToggleService(k, btn) {
  _vt.services = _vt.services.includes(k) ? _vt.services.filter(x => x !== k) : [..._vt.services, k];
  btn.classList.toggle('on', _vt.services.includes(k));
}

function vtRenderCoverage() {
  document.getElementById('vt-coverage').innerHTML = _vt.coverage.map(w =>
    `<button type="button" class="pro-chip pro-chip-x" onclick="vtRemoveCoverage(this.dataset.w)" data-w="${esc(w)}">${esc(wilayaName(w))} ✕</button>`).join('');
}
function vtAddCoverage(sel) {
  if (sel.value && !_vt.coverage.includes(sel.value)) {
    if (_vt.coverage.length >= 20) toast(T('vt_coverage_max')); else _vt.coverage.push(sel.value);
  }
  sel.value = '';
  vtRenderCoverage();
}
function vtRemoveCoverage(w) { _vt.coverage = _vt.coverage.filter(x => x !== w); vtRenderCoverage(); }

async function vtSave() {
  const kind = (document.querySelector('input[name="vt-kind"]:checked') || {}).value || 'agence';
  const body = {
    kind, name: vtVal('vt-name'), tagline: vtVal('vt-tagline'), description: vtVal('vt-desc'), wilaya: vtVal('vt-wilaya'),
    commune: vtVal('vt-commune'), address: vtVal('vt-address'), phone: vtVal('vt-phone'), website: vtVal('vt-website'),
    facebook: vtVal('vt-facebook'), instagram: vtVal('vt-instagram'), hours: vtVal('vt-hours'),
    founded_year: vtVal('vt-founded') || null, services: _vt.services, coverage: _vt.coverage, logo: _vt.logo, cover: _vt.cover,
  };
  if (!body.name || !body.wilaya) { toast('❌ ' + T('vt_required')); return; }
  try {
    if (_vt.mine) await api('/agencies/' + _vt.mine.id, 'PUT', body);
    else await api('/agencies', 'POST', body);
    toast('✅ ' + T(_vt.mine ? 'vt_saved' : 'vt_created'));
    if (currentUser) currentUser.is_agent = true;
    dashTab('vitrine');
  } catch (e) { toast('❌ ' + e.message); }
}

async function vtDelete() {
  if (!confirm(T('vt_delete_confirm'))) return;
  try {
    await api('/agencies/' + _vt.mine.id, 'DELETE');
    toast(T('vt_deleted'));
    dashTab('vitrine');
  } catch (e) { toast('❌ ' + e.message); }
}

// ── Tableau de bord : programmes du promoteur ────────────────────────────────────────────────────────────────────────
async function pgRenderSection() {
  const box = document.getElementById('pg-section');
  if (!box) return;
  let list = [];
  try { list = await api('/projects/mine'); } catch (e) { box.innerHTML = `<p style="color:red">${esc(e.message)}</p>`; return; }
  const verified = !!(_vt.mine && _vt.mine.verified);
  box.innerHTML = `
  <div class="vt-card">
    <div class="vt-card-head"><h3>🏗 ${T('pg_mine_title')}</h3>
      ${verified ? `<button class="btn btn-primary btn-sm" onclick="pgForm(null)">＋ ${T('pg_new')}</button>` : ''}</div>
    ${verified ? '' : `<p class="vt-note">🛡️ ${T('pg_needs_verif')}</p>`}
    ${list.length ? list.map(p => `
      <div class="pg-row ${p.visible ? '' : 'off'}">
        ${p.image ? `<img src="${esc(thumbUrl(p.image, 480))}" alt="" loading="lazy">` : '<div class="pro-cover-none"></div>'}
        <div class="pg-row-main">
          <b>${esc(p.name)}</b> ${progStatusHTML(p.status)}
          <div class="pg-row-meta">📍 ${esc(wilayaName(p.wilaya))} · ${p.available_count} ${unit(p.available_count, 'u_lot_avail')}${p.sold_count ? ' · ' + p.sold_count + ' ' + unit(p.sold_count, 'u_lot_sold') : ''}${p.visible ? '' : ' · <span class="pg-hidden">' + T('pg_hidden_short') + '</span>'}</div>
        </div>
        <div class="pg-row-actions">
          ${p.visible ? `<a class="btn btn-outline btn-sm" href="${esc(progHref(p))}" onclick="return proGo(event,'programme-detail',${p.id})">${T('dash_view')}</a>` : ''}
          <button class="btn btn-outline btn-sm" onclick="pgForm(${p.id})">${T('pg_edit')}</button>
          <button class="btn btn-danger btn-sm" onclick="pgDelete(${p.id})">✕</button>
        </div>
      </div>`).join('') : (verified ? `<p class="vt-note">${T('pg_none_mine')}</p>` : '')}
    <div id="pg-form"></div>
  </div>`;
  window._pgList = list;
}

function pgForm(id) {
  const p = id ? (window._pgList || []).find(x => x.id === id) : null;
  const f = p || {};
  Object.assign(_pg, { id: p ? p.id : null, photos: p ? [...(p.photos || [])] : [], features: p ? [...(p.features || [])] : [] });
  const year = new Date().getFullYear();
  const box = document.getElementById('pg-form');
  box.innerHTML = `
  <div class="pg-form">
    <h4>${T(p ? 'pg_edit' : 'pg_new')}</h4>
    <div class="vt-grid">
      <div class="form-group full"><label>${T('pg_name')} *</label><input id="pgf-name" maxlength="120" value="${esc(f.name || '')}"></div>
      <div class="form-group"><label>${T('vt_wilaya')} *</label><select id="pgf-wilaya"></select></div>
      <div class="form-group"><label>${T('vt_commune')}</label><input id="pgf-commune" maxlength="80" value="${esc(f.commune || '')}"></div>
      <div class="form-group full"><label>${T('vt_address')}</label><input id="pgf-address" maxlength="200" value="${esc(f.address || '')}"></div>
      <div class="form-group"><label>${T('pg_status')}</label><select id="pgf-status">${PRO_STATUSES.map(s => `<option value="${s}" ${(f.status || 'en_construction') === s ? 'selected' : ''}>${T('pg_st_' + s)}</option>`).join('')}</select></div>
      <div class="form-group"><label>${T('pg_units')}</label><input id="pgf-units" type="number" min="1" max="5000" value="${esc(f.total_units || '')}"></div>
      <div class="form-group"><label>${T('pg_delivery')}</label>
        <div class="pg-delivery"><select id="pgf-quarter"><option value="">—</option>${[1, 2, 3, 4].map(q => `<option value="${q}" ${f.delivery_quarter === q ? 'selected' : ''}>${T('pg_q_short')}${q}</option>`).join('')}</select>
        <input id="pgf-year" type="number" min="2000" max="${year + 15}" value="${esc(f.delivery_year || '')}" placeholder="${year + 1}"></div></div>
      <div class="form-group full"><label>${T('vt_desc')}</label><textarea id="pgf-desc" rows="4" maxlength="3000">${esc(f.description || '')}</textarea></div>
    </div>
    <div class="vt-block"><label class="vt-label">${T('pg_features')}</label>
      <div class="pro-chips">${PRO_FEATURES.map(k => `<button type="button" class="pro-chip pro-chip-toggle ${_pg.features.includes(k) ? 'on' : ''}" onclick="pgToggleFeature('${k}',this)">${T('pg_feat_' + k)}</button>`).join('')}</div></div>
    <div class="vt-block"><label class="vt-label">${T('pg_photos')}</label>
      <div class="pg-photos" id="pgf-photos"></div>
      <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('pgf-file').click()">📷 ${T('vt_upload')}</button>
      <input id="pgf-file" type="file" accept="image/*" multiple style="display:none" onchange="pgAddPhotos(this)">
      <div class="field-hint">${T('pub_first_photo')}</div></div>
    <div class="vt-actions"><button class="btn btn-primary" onclick="pgSave()">${T('pg_save')}</button>
      <button class="btn btn-outline" onclick="document.getElementById('pg-form').innerHTML=''">${T('pub_cancel')}</button></div>
  </div>`;
  document.getElementById('pgf-wilaya').innerHTML = '<option value="">' + T('pub_choose') + '</option>' + WILAYAS.map(w => `<option value="${esc(w)}">${esc(wilayaName(w))}</option>`).join('');
  document.getElementById('pgf-wilaya').value = f.wilaya || (_vt.mine ? _vt.mine.wilaya : '');
  pgRenderPhotos();
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function pgToggleFeature(k, btn) {
  _pg.features = _pg.features.includes(k) ? _pg.features.filter(x => x !== k) : [..._pg.features, k];
  btn.classList.toggle('on', _pg.features.includes(k));
}

function pgRenderPhotos() {
  document.getElementById('pgf-photos').innerHTML = _pg.photos.map((u, i) =>
    `<div class="pg-photo"><img src="${esc(thumbUrl(u, 480))}" alt=""><button type="button" onclick="pgRemovePhoto(${i})" aria-label="${esc(T('vt_remove'))}">✕</button></div>`).join('');
}
function pgRemovePhoto(i) { _pg.photos.splice(i, 1); pgRenderPhotos(); }
async function pgAddPhotos(input) {
  const files = [...input.files].slice(0, 12 - _pg.photos.length);
  input.value = '';
  for (const f of files) { const u = await proUpload(f); if (u) _pg.photos.push(u); }
  pgRenderPhotos();
}

async function pgSave() {
  const body = {
    name: vtVal('pgf-name'), wilaya: vtVal('pgf-wilaya'), commune: vtVal('pgf-commune'), address: vtVal('pgf-address'),
    status: vtVal('pgf-status'), total_units: vtVal('pgf-units') || null, delivery_year: vtVal('pgf-year') || null,
    delivery_quarter: vtVal('pgf-quarter') || null, description: vtVal('pgf-desc'), features: _pg.features, photos: _pg.photos,
  };
  if (!body.name || !body.wilaya) { toast('❌ ' + T('vt_required')); return; }
  try {
    if (_pg.id) await api('/projects/' + _pg.id, 'PUT', body); else await api('/projects', 'POST', body);
    toast('✅ ' + T('pg_saved'));
    pgRenderSection();
  } catch (e) { toast('❌ ' + e.message); }
}

async function pgDelete(id) {
  if (!confirm(T('pg_delete_confirm'))) return;
  try { await api('/projects/' + id, 'DELETE'); toast(T('pg_deleted')); pgRenderSection(); }
  catch (e) { toast('❌ ' + e.message); }
}

// ── Formulaire de publication : « Publier au nom de » et programme ──────────────────────────────────────────────────
async function initPublishAs() {
  const wrap = document.getElementById('pub-as-wrap');
  if (!wrap) return;
  wrap.classList.add('hidden');
  if (!token || !currentUser) return;
  let mine;
  try { mine = await api('/agencies/mine/info'); } catch { return; }   // pas de vitrine : annonce de particulier
  const sel = document.getElementById('pub-as');
  sel.innerHTML = `<option value="${mine.id}">${esc(mine.name)}</option><option value="">${T('pub_as_self')}</option>`;
  wrap.classList.remove('hidden');
  const projRow = document.getElementById('pub-project-row');
  projRow.classList.add('hidden');
  if (mine.kind === 'promoteur' && mine.verified) {
    try {
      const list = (await api('/projects/mine')).filter(p => p.visible);
      if (list.length) {
        document.getElementById('pub-project').innerHTML = `<option value="">${T('pub_project_none')}</option>` + list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
        projRow.classList.remove('hidden');
      }
    } catch { /* programmes facultatifs */ }
  }
}

// Valeurs à joindre à la création d'une annonce
function publishAffiliation() {
  const as = document.getElementById('pub-as');
  const wrap = document.getElementById('pub-as-wrap');
  const out = {};
  if (as && wrap && !wrap.classList.contains('hidden') && as.value) out.agency_id = Number(as.value);
  const pj = document.getElementById('pub-project');
  if (out.agency_id && pj && pj.value && !document.getElementById('pub-project-row').classList.contains('hidden')) out.project_id = Number(pj.value);
  return out;
}
