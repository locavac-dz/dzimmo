const API = '/api';
let token = localStorage.getItem('dzimmo_token') || null;
let currentUser = null;
let currentPage = 'home';
let uploadedPhotos = [];   // photos du formulaire : { file, preview } (nouvelles) ou { url, preview } (déjà en ligne, mode édition)
let publishEditId = null;   // id de l'annonce en cours de modification (null : publication d'une nouvelle annonce)
let wsConn = null;

// ── i18n FR / AR ──────────────────────────────────────────────────────────────
// Version arabe d'une page : le même chemin précédé de « /ar » (/ar/vente/oran, voir server/seo.js). L'adresse l'emporte sur la langue mémorisée.
const AR_PATH = /^\/ar(?=\/|$)/i;
let currentLang = AR_PATH.test(location.pathname) ? 'ar' : (localStorage.getItem('dz_lang') || 'fr');
// Chemin français équivalent à l'adresse courante, et chemin d'une page dans la langue affichée
const routePath = () => location.pathname.replace(AR_PATH, '') || '/';
const langPath = p => currentLang === 'ar' ? '/ar' + (p === '/' ? '' : p) : p;
// L'adresse suit la langue affichée (les liens des emails de la newsletter gardent la leur)
function syncLangUrl() {
  const p = routePath();
  if (p.startsWith('/newsletter/')) return;
  const want = langPath(p);
  if (location.pathname !== want) history.replaceState(null, '', want + location.search + location.hash);
}

const TRANSLATIONS = {
  fr: {
    site_title:'DzImmo — Immobilier en Algérie',
    nav_home:'Accueil', nav_annonces:'Annonces', nav_agences:'Agences', nav_carte:'Carte', nav_estimer:'🔍 Estimer', menu_label:'Menu',
    btn_publier:'+ Publier', btn_login:'Connexion', btn_register:"S'inscrire",
    hero_title:'Trouvez votre bien immobilier en Algérie',
    hero_sub:'Appartements, villas, terrains, locaux · Vente et location partout en Algérie',
    err_server:'Erreur serveur.', err_network:'Connexion impossible. Vérifiez votre réseau.',
    s_all_wilayas:'Toutes les wilayas', s_all_modes:'Vente & Location',
    s_vente:'Vente', s_loc_longue:'Location longue durée', s_loc_courte:'Location courte durée',
    s_all_types:'Tous les types', s_appart:'Appartement', s_villa:'Villa',
    s_maison:'Maison', s_bureau:'Bureau', s_local:'Local commercial',
    s_terrain:'Terrain', s_ferme:'Ferme', s_entrepot:'Entrepôt',
    btn_search:'🔍 Rechercher',
    tab_tout:'Tout', tab_vente:'Vente', tab_loc_long:'Location longue', tab_loc_court:'Location courte',
    recent_listings:'Annonces récentes', loading:'Chargement…', see_all:'Voir toutes les annonces →',
    ft_nav:'Navigation', ft_all:'Toutes les annonces', ft_agencies:'Les agences', ft_publish:'Publier une annonce',
    ft_types:'Types de biens', ft_apparts:'Appartements', ft_villas:'Villas',
    ft_terrains:'Terrains', ft_locals:'Locaux commerciaux',
    ft_legal:'Légal', ft_cgu:'CGU', ft_privacy:'Politique de confidentialité',
    ft_mentions:'Mentions légales', ft_contact:'Contact',
    ft_stats:'📊 Statistiques plateforme', ft_contrats:'📄 Modèles de contrats',
    ft_explore:'Explorer',
    ft_about:"La plateforme de référence pour l'immobilier en Algérie. Achat, vente, location.",
    nav_admin:'⚙️ Admin', notif_title:'🔔 Notifications', notif_read_all:'Tout lire', notif_empty:'Aucune notification',
    cmp_compare:'⚖ Comparer', cmp_clear:'✕ Vider', cmp_title:'⚖ Comparateur de biens', cmp_close:'✕ Fermer',
    filter_search:'Recherche', filter_kw_ph:'Mot-clé…', filter_apply:'🔍 Filtrer',
    near_me:'📍 Près de moi', near_me_results:'📍 Résultats près de :', near_me_clear:'✕ Retirer', commune_in:'🏘️ Commune :',
    annonces_heading:'Annonces immobilières', res_one:'résultat', res_many:'résultats',
    search_suggest:'Voulez-vous dire :',
    pub_first_photo:'La première photo sera la photo principale.',
    msg_title:'💬 Messagerie', msg_select:'Sélectionnez une conversation', msg_none:'Aucune conversation',
    u_dzd:'DZD', u_month:'/mois', u_m2:'m²',
    u_room_one:'pièce', u_room_two:'pièces', u_room_many:'pièces',
    u_bath_one:'SDB', u_bath_two:'SDB', u_bath_many:'SDB',
    u_view_one:'vue', u_view_two:'vues', u_view_many:'vues', st_ad_two:'annonces',
    no_listings:'Aucune annonce disponible', verified_badge:'✓ Vérifié', fav_tip:'Favori', cmp_tip:'Comparer',
    fav_removed:'Retiré des favoris.', fav_added:'❤️ Ajouté aux favoris !', link_copied:'🔗 Lien copié !',
    feat_meuble:'Meublé', feat_parking:'Parking', feat_balcon:'Balcon', feat_terrasse:'Terrasse', feat_ascenseur:'Ascenseur',
    feat_gardien:'Gardien', feat_piscine:'Piscine', feat_climatisation:'Climatisation', feat_chauffage:'Chauffage',
    feat_wifi:'Wi-Fi', feat_cave:'Cave', feat_jardin:'Jardin', feat_alarme:'Alarme', feat_interphone:'Interphone',
    feat_eau:'Eau', feat_electricite:'Électricité', feat_gaz:'Gaz', feat_route:'Accès route', feat_fibre:'Fibre',
    det_see_photos:'📷 Voir les {n} photos', det_desc:'Description', det_no_desc:'Aucune description fournie.',
    det_reviews:'Avis', det_anon:'Anonyme', det_agency:'Agence immobilière', det_private:'Particulier',
    det_contact:'Contacter le vendeur', det_req_type:'Type de demande',
    det_opt_info:"Demande d'information", det_opt_visit:'Demander une visite', det_opt_offer:'Faire une offre de prix',
    det_visit_date:'Date de visite souhaitée', det_visit_time:'Heure souhaitée', det_visit_time_none:'Sans préférence',
    det_offer_amount:"Montant de l'offre (DZD)",
    det_msg:'Message', det_msg_ph:'Votre message…', det_send_req:'Envoyer la demande', det_send_msg:'💬 Envoyer un message',
    det_call:'Appeler', det_whatsapp:'WhatsApp', det_wa_msg:"Bonjour, votre annonce « {title} » sur DzImmo m'intéresse : {url}",
    det_login_hint:'Connectez-vous pour contacter le vendeur', det_login:'Se connecter',
    rp_btn:'Signaler cette annonce', rp_login:'Connectez-vous pour signaler une annonce.', rp_title:'Signaler cette annonce',
    rp_intro:'Un problème avec cette annonce ? Dites-nous lequel : un modérateur examinera votre signalement.',
    rp_choose:'— Choisir un motif —', rp_motif:'Motif', rp_message:'Précisions (facultatif)', rp_send:'Envoyer le signalement',
    rp_need_motif:'Choisissez un motif.', rp_thanks:'Merci, votre signalement a été transmis.',
    rp_m_arnaque:'Arnaque ou fausse annonce', rp_m_indisponible:'Bien déjà vendu ou loué', rp_m_faux:'Informations trompeuses (prix, surface…)',
    rp_m_photos:'Photos qui ne correspondent pas', rp_m_doublon:'Annonce en double', rp_m_interdit:'Contenu interdit ou choquant', rp_m_autre:'Autre',
    det_published:'Publié le', det_copy:'🔗 Copier', det_print:'🖨️ Imprimer la fiche (avec code QR)', det_sent:'✅ Demande envoyée au vendeur !',
    det_price_hist:'📈 Historique des prix', det_stable:'stable', det_similar:'Biens similaires', new_badge:'Nouveau',
    cmp_max:'Vous pouvez comparer 3 biens maximum.', cmp_min:'Sélectionnez au moins 2 biens à comparer.',
    cmp_remove:'Retirer', cmp_view:'Voir →', cmp_r_price:'Prix', cmp_r_commune:'Commune', cmp_r_surface:'Surface',
    cmp_r_floor:'Étage', cmp_r_published:'Publié', cmp_r_verified:'Vérifié',
    map_no_pos:'sans position', map_view:"Voir l'annonce →", map_error:'Erreur de chargement',
    ag_none:'Aucune agence enregistrée', ag_rating:'note', ag_website:'🌐 Site web',
    dash_chart:'📊 Vues par annonce (top 8)', dash_archive_confirm:'Archiver cette annonce ? Elle ne sera plus visible.',
    dash_archived:'Annonce archivée.', dash_error:'Erreur', dash_none:'Aucune annonce', dash_more:'Afficher plus d’annonces', dash_first:'Publiez votre première annonce !',
    dash_view:'Voir', dash_archive:'Archiver', u_req_one:'demande', u_req_two:'demandes', u_req_many:'demandes',
    dash_no_req:'Aucune demande reçue', dash_t_visite:'🗓 Visite', dash_t_offre:'💰 Offre', dash_t_info:'ℹ️ Info',
    dash_c_pending:'En attente', dash_c_confirmed:'Confirmée', dash_c_rejected:'Refusée', dash_c_done:'Terminée',
    dash_status_updated:'Statut mis à jour.', dash_no_fav:'Aucun favori', dash_fav_hint:'Cœurez des annonces pour les retrouver ici.',
    alert_active:'🔔 Alerte active', ph_example:'ex : {v}',
    prof_title:'Informations personnelles', prof_name:'Nom', prof_email:'Email', prof_phone:'Téléphone', prof_bio:'Bio',
    prof_notify_drop:'Alertes de baisse de prix', prof_notify_drop_hint:'Notification et email quand le prix d\'une annonce de vos favoris baisse d\'au moins 3 %.',
    prof_push_enable:'🔔 Activer les notifications push', prof_push_disable:'🔕 Désactiver les notifications push',
    prof_push_hint:'Recevez les alertes en temps réel même quand le site est fermé.', prof_push_na:'Notifications push non disponibles sur ce navigateur.',
    prof_save:'Enregistrer', prof_logout:'Déconnexion', prof_logout_confirm:'Déconnexion ?', prof_updated:'✅ Profil mis à jour !',
    logout_done:'Déconnexion effectuée.', pub_choose:'Choisir…',
    mod_pending_ok:"Annonce envoyée ! Elle sera visible après validation par notre équipe (généralement sous 24 h). Vous serez notifié(e) de la décision.",
    mod_banner_pending:"Votre annonce est en attente de validation : elle n'est visible que par vous et notre équipe.",
    mod_banner_rejected:'Annonce refusée.', dash_reason:'Motif du refus :',
    dash_st_active:'Actif', dash_st_sold:'Vendu', dash_st_rented:'Loué', dash_st_archived:'Archivé',
    dash_st_pending:'En attente de validation', dash_st_rejected:'Refusée',
    dash_delete:'Supprimer', dash_delete_confirm:'Supprimer définitivement cette annonce ?',
    seo_t_appartement:'Appartements', seo_t_villa:'Villas', seo_t_maison:'Maisons', seo_t_bureau:'Bureaux',
    seo_t_local_commercial:'Locaux commerciaux', seo_t_terrain:'Terrains', seo_t_ferme:'Fermes', seo_t_entrepot:'Entrepôts',
    seo_t_all:'Biens immobiliers', seo_m_vente:'à vendre', seo_m_location_longue:'à louer',
    seo_m_location_courte:'en location saisonnière', seo_in:'à',
    mc_title:'Modèles de contrats', mc_sub:'Bail, quittance, état des lieux… Remplissez le formulaire, vérifiez l\'aperçu, puis imprimez en PDF ou téléchargez au format Word.',
    mc_disclaimer:'Modèles indicatifs, inspirés des usages et du Code civil algérien (louage). Ils ne remplacent pas le conseil d\'un notaire ou d\'un avocat : pour un bail de longue durée ou un acte soumis à la forme authentique, adressez-vous à un notaire. Pensez à faire enregistrer le bail auprès de la recette des impôts. Aucune donnée saisie n\'est envoyée au serveur ni conservée.',
    mc_use:'Utiliser ce modèle', mc_all:'← Tous les modèles', mc_doc_lang:'Langue du document',
    mc_print:'Imprimer / PDF', mc_word:'Word', mc_reset:'Réinitialiser',
    st_title:'📊 DzImmo en chiffres', st_sub:'Statistiques en temps réel de la plateforme',
    st_active:'Annonces actives', st_sold:'Biens vendus', st_rented:'Biens loués',
    st_users:'Utilisateurs', st_agencies:'Agences', st_views:'Vues totales',
    st_by_mode:'Répartition par mode', st_active_sub:'Annonces actives',
    st_mode_long:'Loc. longue', st_mode_short:'Loc. courte',
    st_types:'Types de biens', st_types_sub:'Top 6 — annonces actives',
    st_wilayas:'Top wilayas', st_wilayas_sub:'Annonces actives par wilaya',
    st_ad_one:'annonce', st_ad_many:'annonces', st_footer:'Données en temps réel',
    ft_copy:'© 2026 DzImmo · Algérie · Tous droits réservés',
    nl_title:'Newsletter', nl_desc:'Recevez nos actualités et une sélection d’annonces. Désinscription en un clic.',
    nl_btn:'S’inscrire', nl_sent:'✅ Un email de confirmation vient de vous être envoyé. Cliquez sur son lien pour valider votre inscription.',
    nl_failed:'Inscription impossible pour le moment.',
    nl_confirm_ask_title:'Confirmer votre inscription', nl_confirm_ask_msg:'Un dernier clic pour recevoir la newsletter DzImmo.', nl_confirm_ask_btn:'Confirmer mon inscription',
    nl_confirm_done_title:'Inscription confirmée', nl_confirm_done_msg:'Merci ! Vous recevrez désormais notre newsletter. Chaque message contient un lien pour vous désinscrire.',
    nl_unsub_ask_title:'Se désinscrire de la newsletter', nl_unsub_ask_msg:'Confirmez pour ne plus recevoir nos emails.', nl_unsub_ask_btn:'Me désinscrire',
    nl_unsub_done_title:'Vous êtes désinscrit', nl_unsub_done_msg:'Vous ne recevrez plus la newsletter DzImmo.',
    nl_bad_title:'Lien invalide ou expiré', nl_bad_msg:'Ce lien ne fonctionne plus. Si vous vous êtes inscrit il y a plus de 7 jours sans confirmer, inscrivez-vous de nouveau depuis le bas de la page.',
    m_login:'Connexion', m_email:'Email', m_pass:'Mot de passe',
    m_connect:'Se connecter', m_or:'ou', m_create_account:'Créer un compte',
    m_forgot:'Mot de passe oublié ?', m_register:"Créer un compte",
    m_name:'Nom complet', m_phone:'Téléphone', m_already:"J'ai déjà un compte",
    m_forgot_title:'Mot de passe oublié', m_send_link:'Envoyer le lien',
    pub_heading:'📋 Publier une annonce', pub_title_label:"Titre de l'annonce *",
    pub_title_ph:'ex: Appartement F3 lumineux à Hydra',
    pub_mode:'Mode *', pub_type:'Type de bien *', pub_price:'Prix (DZD) *',
    pub_surface:'Surface (m²)', pub_rooms:'Pièces', pub_baths:'Salles de bain',
    pub_floor:'Étage', pub_wilaya:'Wilaya *', pub_commune:'Commune',
    pub_commune_ph:'ex: Hydra', pub_address:'Adresse',
    pub_address_ph:'Adresse précise (optionnel)', pub_desc:'Description',
    pub_desc_ph:'Décrivez votre bien : état, équipements, environnement…',
    pub_features:'🏷️ Caractéristiques', pub_photos:'📷 Photos',
    pub_photos_hint:'Cliquez pour ajouter des photos (max 10, JPEG/PNG/WebP)',
    pub_media:'🎬 Vidéo et visite virtuelle (facultatif)', pub_video:'Vidéo (YouTube ou Vimeo)', pub_tour:'Visite virtuelle (Matterport ou Kuula)',
    pub_video_ph:'https://www.youtube.com/watch?v=…', pub_tour_ph:'https://my.matterport.com/show/?m=…',
    pub_media_hint:'Collez le lien de partage : nous n\'hébergeons aucun fichier vidéo. Le lecteur ne se charge qu\'au clic du visiteur.',
    media_video:'Vidéo', media_tour:'Visite virtuelle', media_load_video:'▶ Lire la vidéo', media_load_tour:'🧭 Lancer la visite virtuelle',
    media_privacy:'Le lecteur {p} ne se charge qu\'au clic : aucun cookie tiers avant.', media_open:'Ouvrir sur {p}', media_badge_video:'Vidéo', media_badge_tour:'Visite 3D',
    pub_submit:"Publier l'annonce", pub_cancel:'Annuler',
    pub_score_label:'Complétude de l\'annonce',
    f_meuble:'Meublé', f_parking:'Parking', f_balcon:'Balcon', f_terrasse:'Terrasse',
    f_ascenseur:'Ascenseur', f_gardien:'Gardien', f_piscine:'Piscine',
    f_clim:'Climatisation', f_chauff:'Chauffage central', f_wifi:'Wi-Fi',
    f_cave:'Cave', f_jardin:'Jardin', f_alarme:'Alarme', f_interphone:'Interphone',
    f_eau:'Eau courante', f_elec:'Électricité', f_gaz:'Gaz naturel',
    f_route:'Accès route', f_fibre:'Fibre optique',
    dash_title:'Mon espace', dash_annonces:'Annonces', dash_actives:'Actives',
    dash_demandes:'Demandes reçues', dash_attente:'En attente', dash_vues:'Vues totales',
    dash_tab_annonces:'Mes annonces', dash_tab_contacts:'Demandes reçues',
    dash_tab_favoris:'Favoris', dash_tab_alertes:'Alertes email', dash_tab_profil:'Profil',
    dash_tab_verif:'Vérification',
    dash_tab_vitrine:'Ma vitrine',
    ft_promoters:'Les promoteurs', ft_programmes:'Programmes neufs',
    home_pros_title:'Agences et promoteurs vérifiés', home_pros_all:"Voir l'annuaire →",
    pro_dir_title:'Agences et promoteurs immobiliers',
    pro_dir_sub:'Des professionnels vérifiés, leurs annonces et leurs programmes neufs, partout en Algérie.',
    pro_tab_all:'Tous', pro_tab_agence:'Agences', pro_tab_promoteur:'Promoteurs', pro_tab_prog:'Programmes neufs',
    pro_title_all:'Agences et promoteurs immobiliers en Algérie', pro_title_promoteur:'Promoteurs immobiliers en Algérie',
    pro_title_prog:'Programmes immobiliers neufs en Algérie',
    pro_search_ph:'Nom, commune…', pro_verified_only:'Vérifiés uniquement',
    pro_sort_relevance:'Pertinence', pro_sort_listings:"Plus d'annonces", pro_sort_rating:'Mieux notés', pro_sort_recent:'Plus récents', pro_sort_name:'Nom (A → Z)',
    pro_more:'Voir plus', pro_none:'Aucun professionnel ne correspond à votre recherche.',
    pro_verified:'Vérifié', pro_verified_tip:'Registre de commerce ou agrément contrôlé par DzImmo',
    kind_agence:'Agence immobilière', kind_promoteur:'Promoteur immobilier',
    svc_vente:'Vente', svc_location:'Location', svc_location_courte:'Location saisonnière', svc_neuf:'Programmes neufs',
    svc_gestion:'Gestion locative', svc_estimation:'Estimation gratuite', svc_accompagnement:'Aide au crédit et au notaire',
    u_prog_one:'programme', u_prog_two:'programmes', u_prog_many:'programmes',
    u_review_one:'avis', u_review_two:'avis', u_review_many:'avis',
    u_year_one:'an', u_year_two:'ans', u_year_many:'ans',
    ag_share:'Partager', ag_link_copied:'Lien copié', ag_edit:'Modifier ma vitrine', ag_website_short:'Site web', ag_founded:'Fondée en {y}',
    ag_unverified:"Ce professionnel n'a pas encore fait vérifier son registre de commerce ou son agrément.",
    ag_stat_done:'biens vendus ou loués', ag_stat_exp:"d'expérience", ag_stat_since:'membre depuis',
    ag_sec_about:'À propos', ag_sec_programmes:'Programmes neufs', ag_sec_listings:'Annonces', ag_sec_reviews:'Avis clients',
    ag_services:'Services', ag_coverage:"Zones d'intervention", ag_hours:'Horaires', ag_address:'Adresse', ag_map:'Voir sur la carte',
    ag_all_programmes:'Tous les programmes', ag_filter_all:'Toutes', ag_no_listings:'Aucune annonce pour ce filtre.',
    ag_review_on:'Avis sur', ag_wa_msg:'Bonjour {name}, je vous contacte depuis DzImmo : {url}',
    pg_dir_title:'Programmes immobiliers neufs', pg_dir_sub:'Résidences sur plan, en construction ou livrées, publiées par des promoteurs vérifiés.',
    pg_all_status:'Tous les avancements', pg_st_sur_plan:'Sur plan', pg_st_en_construction:'En construction', pg_st_livre:'Livré',
    pg_q_short:'T', pg_delivery_at:'Livraison {when}', pg_delivered:'Livré en {y}',
    pg_from:'À partir de',
    u_lot_avail_one:'lot disponible', u_lot_avail_two:'lots disponibles', u_lot_avail_many:'lots disponibles',
    u_lot_sold_one:'lot vendu', u_lot_sold_two:'lots vendus', u_lot_sold_many:'lots vendus',
    u_lot_total_one:'lot au total', u_lot_total_two:'lots au total', u_lot_total_many:'lots au total',
    u_pro_one:'professionnel', u_pro_two:'professionnels', u_pro_many:'professionnels',
    pg_none:'Aucun programme pour le moment.', pg_of:'Programmes de',
    pg_features:'Équipements', pg_lots:'Lots du programme', pg_no_lots:'Aucun lot en ligne pour le moment.',
    pg_lot_of:'Lot du programme', pg_title_suffix:'Programme neuf',
    pg_hidden_note:"Ce programme n'est pas visible du public : il le redevient quand votre registre de commerce est vérifié.",
    pg_wa_msg:'Bonjour, je souhaite des informations sur le programme « {name} » : {url}',
    pg_feat_ascenseur:'Ascenseur', pg_feat_parking:'Parking', pg_feat_espaces_verts:'Espaces verts', pg_feat_securite:'Sécurité 24h/24',
    pg_feat_aire_jeux:'Aire de jeux', pg_feat_commerces:'Commerces', pg_feat_gaz_ville:'Gaz de ville', pg_feat_fibre:'Fibre optique',
    vt_intro_title:'Vous êtes une agence ou un promoteur ?', vt_intro_text:'Créez votre vitrine : une page à votre nom qui réunit toutes vos annonces.',
    vt_benefit_1:'Une page publique avec votre logo, vos coordonnées et les avis de vos clients',
    vt_benefit_2:'Le badge « Vérifié » après contrôle de votre registre de commerce', vt_benefit_3:'Pour les promoteurs : vos programmes neufs et leurs lots',
    vt_create_title:'Créer ma vitrine', vt_profile:'Ma vitrine', vt_create:'Créer ma vitrine', vt_save:'Enregistrer', vt_saved:'Vitrine enregistrée.', vt_created:'Vitrine créée.',
    vt_kind_agence_hint:'Vend ou loue pour le compte de propriétaires', vt_kind_promoteur_hint:'Construit et vend ses propres programmes neufs',
    vt_logo:'Logo', vt_logo_hint:'Carré, fond uni de préférence', vt_cover:'Image de couverture', vt_cover_hint:'Format large (3:1) : votre agence, une réalisation…',
    vt_upload:'Choisir une image', vt_remove:'Retirer', vt_img_big:'Image trop volumineuse (10 Mo maximum).',
    vt_name:"Nom de l'agence ou de la société", vt_tagline:'Slogan', vt_tagline_ph:'ex : Votre partenaire immobilier depuis 2010',
    vt_desc:'Présentation', vt_desc_ph:'Vos spécialités, votre équipe, vos engagements…',
    vt_wilaya:'Wilaya', vt_commune:'Commune', vt_address:'Adresse', vt_phone:'Téléphone', vt_founded:'Année de création', vt_website:'Site web',
    vt_hours:'Horaires', vt_hours_ph:'ex : dim–jeu 9h–17h',
    vt_services:'Services proposés', vt_coverage:"Zones d'intervention (autres wilayas)", vt_coverage_add:'Ajouter une wilaya', vt_coverage_max:'20 wilayas au maximum.',
    vt_required:'Nom et wilaya obligatoires.', vt_delete:'Supprimer ma vitrine',
    vt_delete_confirm:'Supprimer votre vitrine ? Vos annonces restent en ligne, vos programmes sont supprimés.', vt_deleted:'Vitrine supprimée.',
    vt_view:'Voir ma vitrine', vt_complete:'Profil complété à {p} %',
    vt_stats_title:'Statistiques de l\'agence · 30 j', vt_stats_listings:'Annonces actives', vt_stats_top:'Meilleures annonces (30 j)',
    vt_todo_logo:'ajoutez un logo', vt_todo_cover:'une image de couverture', vt_todo_tagline:'un slogan', vt_todo_desc:'une présentation détaillée',
    vt_todo_phone:'un téléphone', vt_todo_web:'un site ou un réseau social', vt_todo_hours:'vos horaires', vt_todo_services:'vos services',
    vt_todo_zone:"vos zones d'intervention", vt_todo_year:"l'année de création",
    vt_verified_ok:'Votre registre de commerce est vérifié : le badge « Vérifié » apparaît sur votre vitrine et vos annonces sont publiées sans modération.',
    vt_verify_title:'Obtenez le badge « Vérifié »',
    vt_verify_text:"Envoyez votre registre de commerce ou votre agrément : il rassure les visiteurs, vous place en tête de l'annuaire, permet de publier sans modération et de créer des programmes neufs.",
    vt_verify_btn:'Faire vérifier',
    pg_mine_title:'Mes programmes neufs', pg_new:'Nouveau programme', pg_edit:'Modifier', pg_name:'Nom du programme', pg_status:'Avancement',
    pg_units:'Nombre de lots', pg_delivery:'Livraison prévue', pg_photos:'Photos',
    pg_save:'Enregistrer le programme', pg_saved:'Programme enregistré.', pg_delete_confirm:'Supprimer ce programme ? Ses lots restent en ligne.', pg_deleted:'Programme supprimé.',
    pg_needs_verif:'Les programmes neufs sont réservés aux promoteurs dont le registre de commerce est vérifié. Faites vérifier votre compte pour en publier.',
    pg_none_mine:"Aucun programme pour l'instant. Créez-en un, puis rattachez-y vos lots en publiant une annonce.",
    pg_hidden_short:'masqué (vérification requise)',
    pub_as_title:'🏢 Publier au nom de', pub_as_self:'Moi-même (particulier)', pub_project:'Programme neuf', pub_project_none:'Aucun (annonce indépendante)',
    dash_st_expired:'Retirée (non confirmée)',
    dash_calls:'Appels', dash_whatsapps:'WhatsApp',
    dash_confirmed:'Disponibilité confirmée le {date}', dash_expires:'⚠ À reconfirmer avant le {date}',
    dash_expired_note:'Retirée faute de confirmation : renouvelez-la si le bien est toujours disponible.',
    dash_still:'✓ Toujours disponible', dash_renew:'🔄 Renouveler', dash_renewed:'Merci ! Votre annonce est confirmée.',
    dash_clicks_tip:'Clics sur « Appeler » et « WhatsApp » depuis cette annonce',
    det_confirmed:'Disponibilité confirmée le',
    rn_title:"L'annonce est-elle toujours disponible ?", rn_yes:'✓ Oui, toujours disponible', rn_no:'Non, elle est vendue / louée',
    rn_done:'Merci ! Votre annonce reste en ligne.', rn_closed:'Annonce retirée : elle est marquée comme vendue / louée.',
    q_price_low:"Le prix au m² est très inférieur à celui des biens comparables : notre équipe vérifiera l'annonce avant de la publier.",
    q_price_high:"Le prix au m² est très supérieur à celui des biens comparables : notre équipe vérifiera l'annonce avant de la publier.",
    q_dup_own:'Vous avez déjà publié une annonce très semblable (« {title} »).',
    q_dup_other:"Le texte de cette annonce est identique à celui d'une annonce déjà publiée : notre équipe la vérifiera avant de la publier.",
    q_content_bypass:"La description contient un contact direct (téléphone, email ou lien) : utilisez uniquement le système de contact de la plateforme. Notre équipe vérifiera l'annonce.",
    q_held:"Votre compte est de confiance, mais cette annonce est vérifiée avant publication à cause de l'avertissement ci-dessus.",
    q_pending_flag:'En vérification : prix inhabituel ou texte identique à une autre annonce.',
    g_terms:'En continuant avec Google, vous acceptez les <a href="#" data-p="cgu" onclick="return goLegal(this)">CGU</a> et la <a href="#" data-p="confidentialite" onclick="return goLegal(this)">politique de confidentialité</a>.',
    g_created:'Compte créé avec Google. Bienvenue, {name} !', g_connected:'Connecté avec Google : {name}',
    mfa_title:'Vérification en deux étapes', mfa_help:"Saisissez le code à 6 chiffres de votre application d'authentification, ou l'un de vos codes de secours.",
    mfa_code:'Code de vérification', mfa_verify:'Vérifier', mfa_back:'Retour', mfa_need_code:'Saisissez le code de vérification.',
    mfa_recovery_low:'Il vous reste {n} code(s) de secours : pensez à en générer de nouveaux (Administration → Sécurité).',
    m_phone_hint:"Ce numéro est affiché sur vos annonces (boutons Appeler et WhatsApp). Depuis l'étranger : commencez par + et l'indicatif du pays (ex. <bdi dir=\"ltr\">+33 6 12 34 56 78</bdi>).",
    adv_identity:'Identité vérifiée', adv_business:'Professionnel vérifié',
    adv_identity_tip:"DzImmo a contrôlé une pièce d'identité de cet annonceur. Cela ne prouve pas qu'il est propriétaire du bien.",
    adv_business_tip:"DzImmo a contrôlé le registre de commerce ou l'agrément de ce professionnel.",
    vf_title:'Faire vérifier mon compte',
    vf_intro:"Un badge « vérifié » rassure les acheteurs et les locataires. Envoyez un justificatif : un administrateur DzImmo l'examine, puis le supprime.",
    vf_ok_identity:'Votre identité est vérifiée depuis le {date}.',
    vf_ok_business:'Votre statut de professionnel est vérifié depuis le {date}.',
    vf_pending:"Votre demande est en cours d'examen (envoyée le {date}). Vous serez prévenu par notification et par email dès la décision.",
    vf_rejected:'Votre dernière demande a été refusée : {reason}',
    vf_cancel:'Annuler la demande', vf_cancel_confirm:'Annuler cette demande et supprimer les documents envoyés ?', vf_canceled:'Demande annulée.',
    vf_upgrade:'Vous êtes un professionnel ? Faites aussi vérifier votre registre de commerce ou votre agrément.',
    vf_no_ownership:"La vérification d'identité ne prouve pas la propriété d'un bien précis : elle confirme seulement qui est l'annonceur.",
    vf_kind:'Vous êtes', vf_kind_identity:"Un particulier — pièce d'identité", vf_kind_business:'Un professionnel ou une agence — registre de commerce ou agrément',
    vf_doc:'Type de document',
    vf_doc_cni:"Carte nationale d'identité", vf_doc_passeport:'Passeport', vf_doc_permis:'Permis de conduire',
    vf_doc_registre_commerce:'Registre de commerce', vf_doc_agrement:'Agrément',
    vf_ref:"Numéro du registre de commerce ou de l'agrément",
    vf_files:'Photos du document (recto, puis verso)', vf_files_hint:'JPEG, PNG ou WebP · 2 photos au plus, 8 Mo chacune · texte lisible, sans reflet',
    vf_consent:"J'accepte que DzImmo examine ce document pour vérifier mon compte. Il sera supprimé dès la décision ; seul le résultat est conservé.",
    vf_send:'Envoyer pour vérification', vf_sent:'✅ Demande envoyée. Nous vous prévenons dès la décision.', vf_need_file:'Ajoutez au moins une photo du document.',
    btn_create_alert:'🔔 Créer une alerte',
    alert_title:'Mes alertes email', alert_empty:'Aucune alerte. Créez-en une depuis la page Annonces.',
    alert_new:'+ Nouvelle alerte', alert_del:'Supprimer',
    alert_wilaya:'Wilaya', alert_mode:'Mode', alert_type:'Type de bien',
    alert_min_price:'Prix min (DZD)', alert_max_price:'Prix max (DZD)', alert_min_surf:'Surface min (m²)',
    alert_save:'Enregistrer l\'alerte', alert_cancel:'Annuler',
    alert_saved:'✅ Alerte créée ! Vous serez notifié par email.', alert_max:'Maximum 5 alertes atteint.',
    alert_criteria:'Critères :',
    agencies_title:'🏢 Agences immobilières',
    btn_back:'← Retour',
    sort_label:'Trier', sort_date_desc:'Plus récentes', sort_date_asc:'Plus anciennes',
    sort_price_asc:'Prix croissant', sort_price_desc:'Prix décroissant', sort_surface_desc:'Plus grande surface',
    similar_title:'Biens similaires', agency_detail_listings:'Annonces de l\'agence',
    cgu_title:"Conditions Générales d'Utilisation",
    privacy_title:'Politique de Confidentialité', mentions_title:'Mentions Légales',
    contact_title:'Contactez-nous', contact_sub:'Notre équipe vous répond dans les 24 h ouvrées.',
    filter_wilaya:'Wilaya', filter_mode:'Mode', filter_type:'Type',
    filter_price_min:'Prix min (DZD)', filter_price_max:'Prix max (DZD)', filter_rooms:'Pièces min',
    filter_surf_min:'Surface min (m²)', filter_no_limit:'Sans limite', opt_more:'+',
    filter_features:'Équipements :',
    filter_has_video:'Vidéo', filter_has_tour:'Visite virtuelle',
    recently_viewed:'Récemment vus',
    market_title:'Tendances du marché', market_sub:'Prix médian au m² par wilaya (annonces actives)',
    market_no_data:'Pas encore assez de données disponibles.',
    trend_up:'↑ {n}%', trend_down:'↓ {n}%', trend_stable:'→ stable',
    share_search:'🔗 Partager', link_copied:'Lien copié !',
    cgu_sub:'Dernière mise à jour : 1er janvier 2026',
    cgu_h1:'1. Objet', cgu_h2:"2. Accès et inscription", cgu_h3:"3. Publication d'annonces",
    cgu_h4:'4. Responsabilité', cgu_h5:'5. Propriété intellectuelle',
    cgu_h6:'6. Modification et résiliation', cgu_h7:'7. Droit applicable',
    cgu_p1:"Les présentes Conditions Générales d'Utilisation (CGU) régissent l'accès et l'utilisation de la plateforme DzImmo, disponible à l'adresse dzimmo.dz, éditée par EURL INGENICA CIVIL, société de droit algérien. En accédant à la plateforme, l'utilisateur accepte sans réserve les présentes CGU.",
    cgu_p2:"L'accès aux services de DzImmo nécessite la création d'un compte personnel. L'utilisateur s'engage à fournir des informations exactes et à maintenir la confidentialité de ses identifiants. Toute utilisation du compte relève de la responsabilité de son titulaire.",
    cgu_p3:"Les utilisateurs peuvent publier des annonces immobilières sous leur entière responsabilité. DzImmo se réserve le droit de supprimer toute annonce contraire aux lois algériennes, aux bonnes mœurs ou aux présentes CGU. Les annonces doivent être rédigées en langue française ou arabe et porter sur des biens situés sur le territoire algérien.",
    cgu_p4:"DzImmo est une plateforme de mise en relation et n'est pas partie aux transactions entre utilisateurs. Elle ne garantit pas l'exactitude des annonces et ne saurait être tenue responsable des préjudices résultant des transactions conclues entre utilisateurs.",
    cgu_p5:"L'ensemble des éléments de la plateforme (marque, logo, interface, code) est protégé par le droit algérien de la propriété intellectuelle. Toute reproduction, même partielle, est interdite sans autorisation préalable écrite de DzImmo.",
    cgu_p6:"DzImmo se réserve le droit de modifier les présentes CGU à tout moment. Les utilisateurs en seront informés par email. La poursuite de l'utilisation de la plateforme après notification vaut acceptation des nouvelles CGU. Tout compte peut être résilié par l'utilisateur depuis son espace personnel.",
    cgu_p7:'Les présentes CGU sont soumises au droit algérien. Tout litige relève de la compétence exclusive des juridictions algériennes.',
    priv_sub:'Dernière mise à jour : 20 septembre 2026',
    priv_h9:'9. Connexion avec Google',
    priv_p9:"Si vous choisissez « Continuer avec Google », Google nous transmet votre nom, votre adresse email (que Google a vérifiée) et votre photo de profil. Nous ne recevons pas votre mot de passe Google et nous n'accédons ni à vos contacts ni à vos autres données Google. Google traite ces informations selon sa propre politique de confidentialité. Si cette adresse email était déjà inscrite chez nous sans avoir été confirmée, sa confirmation par Google nous permet de la rattacher à votre compte. Vous pouvez toujours utiliser un email et un mot de passe à la place.",
    priv_h8:'8. Vérification des annonceurs',
    priv_p8:"Si vous demandez la vérification de votre compte, vous nous transmettez une pièce d'identité (particulier) ou un justificatif professionnel (registre de commerce, agrément). Ces documents servent uniquement à contrôler l'identité ou l'activité de l'annonceur : ils ne sont consultables que par les administrateurs de DzImmo, sont stockés à l'écart des données publiques du site et sont supprimés dès la décision (acceptation ou refus). Nous conservons seulement le résultat (compte vérifié ou non, date, numéro du registre de commerce ou de l'agrément pour un professionnel, motif d'un refus). Cette démarche est facultative et repose sur votre consentement ; vous pouvez demander à tout moment le retrait de la vérification.",
    priv_h1:'1. Données collectées', priv_h2:'2. Finalités du traitement',
    priv_h3:'3. Base légale', priv_h4:'4. Durée de conservation',
    priv_h5:'5. Droits des utilisateurs', priv_h6:'6. Sécurité', priv_h7:'7. Cookies',
    priv_p1:"DzImmo collecte les données suivantes lors de l'inscription et de l'utilisation de la plateforme : nom complet, adresse email, numéro de téléphone, données de navigation (adresse IP, pages visitées), contenu des annonces publiées et messages échangés entre utilisateurs.",
    priv_p2:"Les données sont traitées aux fins suivantes : gestion des comptes utilisateurs, publication et recherche d'annonces, mise en relation entre parties, envoi de notifications liées aux annonces, amélioration des services et conformité aux obligations légales.",
    priv_p3:"Le traitement est fondé sur l'exécution du contrat (CGU) conclu avec l'utilisateur, le consentement pour les communications marketing, et les obligations légales découlant de la loi algérienne 18-07 relative à la protection des personnes physiques dans le traitement des données à caractère personnel.",
    priv_p4:"Les données sont conservées pendant toute la durée d'activité du compte, puis 3 ans après sa clôture pour les besoins légaux et comptables. Les messages sont conservés 1 an après leur envoi.",
    priv_p5:"Conformément à la loi 18-07, tout utilisateur dispose d'un droit d'accès, de rectification, d'effacement, d'opposition et de portabilité de ses données. Ces droits s'exercent en contactant DzImmo à l'adresse : <strong>privacy@dzimmo.dz</strong>.",
    priv_p6:"DzImmo met en œuvre des mesures techniques et organisationnelles appropriées pour protéger les données contre tout accès non autorisé, perte ou divulgation : chiffrement des mots de passe (bcrypt), communications HTTPS, tokens JWT à durée limitée.",
    priv_p7:"La plateforme utilise uniquement des cookies strictement nécessaires au fonctionnement (session, préférences de langue, thème). Aucun cookie publicitaire ou de traçage tiers n'est déposé.",
    ml_sub:'Conformément aux dispositions légales algériennes en vigueur',
    ml_h1:'Éditeur', ml_h2:'Directeur de la publication', ml_h3:'Hébergement',
    ml_h4:'Propriété intellectuelle', ml_h5:'Droit applicable',
    ml_p1:'<strong>Dénomination :</strong> EURL INGENICA CIVIL<br><strong>Forme juridique :</strong> Entreprise unipersonnelle à responsabilité limitée (EURL), droit algérien<br><strong>Siège social :</strong> 4, rue Sakhr Ibn Salman, 22000 Sidi Bel Abbès, Algérie<br><strong>Capital social :</strong> 50 000 DA<br><strong>Registre du commerce (CNRC) :</strong> 22/00 - 0025204B26<br><strong>Numéro d\'identification fiscale (NIF) :</strong> 002622002520464<br><strong>Email :</strong> contact@dzimmo.dz',
    ml_p2:'Le directeur de la publication est le représentant légal de EURL INGENICA CIVIL.',
    ml_p3:'<strong>Hébergeur :</strong> OVH SAS (OVHcloud)<br><strong>Adresse :</strong> 2 rue Kellermann, 59100 Roubaix, France<br><strong>Site :</strong> ovhcloud.com',
    ml_p4:"L'ensemble du contenu de dzimmo.dz (textes, graphismes, logo, icônes, code source) est la propriété exclusive de EURL INGENICA CIVIL et est protégé par les lois algériennes sur la propriété intellectuelle. Toute reproduction est interdite sans autorisation écrite préalable.",
    ml_p5:'Le présent site est soumis au droit algérien. Tout litige relatif à son utilisation relève de la compétence exclusive des tribunaux algériens.',
    ct_card_email:'Email', ct_card_phone:'Téléphone', ct_card_addr:'Adresse', ct_card_city:'4, rue Sakhr Ibn Salman, 22000 Sidi Bel Abbès, Algérie',
    ct_form_title:'Envoyer un message',
    ct_lbl_name:'Nom complet', ct_lbl_email:'Email', ct_lbl_subject:'Sujet', ct_lbl_msg:'Message',
    ct_ph_name:'Votre nom', ct_ph_msg:'Décrivez votre demande...',
    ct_opt_info:'Renseignement général', ct_opt_annonce:'Problème avec une annonce',
    ct_opt_compte:'Mon compte', ct_opt_partner:'Partenariat / Agence', ct_opt_autre:'Autre',
    ct_btn_send:'Envoyer le message', ct_sent:'✅ Message envoyé ! Nous vous répondrons sous 24 h.', ct_failed:'Votre message n’a pas pu être envoyé.',
    ft_sim:'Nos simulateurs', ft_sim_prix:'Prix au m²', ft_sim_estim:'Estimation immobilière',
    ft_sim_notaire:'Frais de notaire', ft_sim_credit:'Simulation de crédit',
    sp_title:'Prix au m²', sp_sub:"Calculez le prix au m² ou le prix total d'un bien.",
    sp_h1:'Prix total → Prix/m²', sp_h2:'Prix/m² → Total',
    sp_lbl_total:'Prix total (DZD)', sp_lbl_pm2:'Prix au m² (DZD)', sp_lbl_surf:'Surface (m²)',
    sp_ph_total:'ex : 15 000 000', sp_ph_pm2:'ex : 150 000', sp_ph_surf:'ex : 100',
    sp_btn:'Calculer', sp_res_pm2:'par m²', sp_res_pour:'Pour',
    se_title:'Estimation immobilière', se_sub:'Obtenez une fourchette de prix basée sur les annonces DzImmo.',
    se_lbl_type:'Type de bien', se_lbl_wilaya:'Wilaya', se_lbl_mode:'Mode',
    se_res_range:'Fourchette de prix/m²', se_res_min:'Bas (25%)', se_res_mid:'Moyen', se_res_max:'Haut (75%)',
    se_est_total:'Estimation pour',
    se_source_wilaya:'annonces DzImmo à',
    se_source_national:'annonces DzImmo (toutes wilayas)',
    se_no_data:'Aucune annonce comparable trouvée. Essayez de modifier les filtres.',
    se_need_mode:'⚠️ Sélectionnez un mode (Vente ou Location) pour obtenir une estimation cohérente.',
    se_disclaimer:'Basé sur les annonces actives de DzImmo.',
    sn_title:'Frais de notaire', sn_sub:"Estimez les frais lors de l'achat d'un bien immobilier en Algérie.",
    se_lbl_rooms:'Pièces', se_rooms_all:'Toutes',
    se_rooms_1:'Studio (F1)', se_rooms_2:'F2', se_rooms_3:'F3', se_rooms_4:'F4', se_rooms_5:'F5', se_rooms_6:'F6+',
    sn_lbl_price:"Prix d'achat (DZD)", sn_lbl_zone:'Type de bien',
    sn_ph_price:'ex : 12 000 000',
    sn_urbain:"Bien urbain (3% d'enregistrement)", sn_rural:'Bien rural / agricole (2% d\'enregistrement)',
    sn_enreg:"Taxe d'enregistrement", sn_pub:'Taxe de publicité foncière',
    sn_hon:'Honoraires notaire', sn_divers:'Frais divers (timbre, copies)',
    sn_total:'Total estimé', sn_pct_label:'du prix de vente',
    sn_disclaimer:'Estimation indicative. Consultez un notaire pour un calcul exact.',
    sn_legal_toggle:'📋 Base légale — références juridiques',
    sn_legal_enreg_title:"Taxe d'enregistrement",
    sn_legal_enreg_text:'<strong>Ord. n° 76-105 du 9 déc. 1976</strong> (Code de l\'enregistrement), modifiée par les lois de finances successives — art. 35 et s.<br>Taux : <strong>3 %</strong> pour les biens urbains (usage autre qu\'habitation) ; <strong>2 %</strong> pour les immeubles ruraux et terrains agricoles.<br>Assiette : prix de cession ou valeur vénale si supérieure. Payable à la recette des impôts.',
    sn_legal_pub_title:'Taxe de publicité foncière',
    sn_legal_pub_text:'<strong>Décret législatif n° 93-03 du 1er mars 1993</strong> relatif à la conservation foncière.<br>Taux : <strong>1 %</strong> du prix de cession. Versée à la Conservation foncière pour la transcription de l\'acte et son opposabilité aux tiers.',
    sn_legal_hon_title:'Honoraires du notaire',
    sn_legal_hon_text:'<strong>Décret exécutif n° 06-23 du 18 janvier 2006</strong> portant tarif des actes notariaux. Barème dégressif appliqué sur le prix de cession :<br><table style="margin-top:.4rem;font-size:.78rem;width:100%;border-collapse:collapse"><tr><td style="padding:.25rem .5rem;border:1px solid var(--border)">≤ 500 000 DZD</td><td style="padding:.25rem .5rem;border:1px solid var(--border);text-align:right;font-weight:700">3 %</td></tr><tr><td style="padding:.25rem .5rem;border:1px solid var(--border)">500 001 → 2 000 000 DZD</td><td style="padding:.25rem .5rem;border:1px solid var(--border);text-align:right;font-weight:700">2 %</td></tr><tr><td style="padding:.25rem .5rem;border:1px solid var(--border)">2 000 001 → 10 000 000 DZD</td><td style="padding:.25rem .5rem;border:1px solid var(--border);text-align:right;font-weight:700">1 %</td></tr><tr><td style="padding:.25rem .5rem;border:1px solid var(--border)">&gt; 10 000 000 DZD</td><td style="padding:.25rem .5rem;border:1px solid var(--border);text-align:right;font-weight:700">0,5 %</td></tr></table>',
    sn_legal_divers_title:'Frais divers',
    sn_legal_divers_text:'<strong>Code du timbre</strong> (Ord. n° 76-104 du 9 déc. 1976). Comprend : droits de timbre sur l\'acte, copies exécutoires, frais d\'inscription et de dossier.<br>Montant forfaitaire indicatif : <strong>~15 000 DZD</strong>.',
    sc_title:'Simulation de crédit', sc_sub:'Calculez vos mensualités et le coût total de votre emprunt.',
    sc_lbl_montant:'Montant emprunté (DZD)', sc_lbl_duree:'Durée (années)', sc_lbl_taux:'Taux annuel (%)',
    sc_ph_montant:'ex : 8 000 000',
    sc_res_mensualite:'Mensualité', sc_res_par_mois:'par mois',
    sc_montant_emprunte:'Montant emprunté', sc_interets:'Intérêts totaux', sc_total:'Coût total',
    sc_disclaimer:'Simulation indicative. Contactez votre banque pour une offre personnalisée.',
    ft_sim_rent:'Rentabilité locative',
    sr_title:'Rentabilité locative', sr_sub:'Calculez le rendement net et le cash-flow de votre investissement locatif.',
    sr_sec_achat:'🏠 Acquisition', sr_sec_revenus:'💰 Revenus & charges',
    sr_lbl_prix:"Prix d'achat (DZD) *", sr_lbl_frais:"Frais d'acquisition (%)",
    sr_lbl_credit:'Mensualité crédit (DZD)', sr_lbl_loyer:'Loyer mensuel (DZD) *',
    sr_lbl_charges:'Charges annuelles (DZD)', sr_lbl_vacance:'Vacance locative (%)',
    sr_cout_total:"Coût total d'acquisition", sr_loyer_brut:'Loyer annuel brut',
    sr_rdt_brut:'Rendement brut', sr_rdt_net:'Rendement net',
    sr_revenu_net:'Revenu locatif net / an', sr_cashflow:'Cash-flow mensuel net',
    sr_recuperation:'Délai de récupération',
    sr_note_excellent:'Excellent investissement', sr_note_bon:'Bon investissement',
    sr_note_moyen:'Investissement moyen', sr_note_faible:'Rendement faible',
    sr_disclaimer:'Simulation indicative. Consultez un conseiller pour une analyse personnalisée.',
    pub_photos_req:'Au moins une photo est requise avant de publier.',
    imp_btn:'📥 Importer en CSV', imp_dl_tpl:'📄 Télécharger le modèle CSV',
    imp_result_ok:'{n} annonce(s) importée(s) en modération.', imp_result_err:'{e} erreur(s).',
    pwa_install:'📲 Installer l\'app',
    map_zone_mode:'📍 Zone', map_zone_exit:'✕ Zone', map_zone_hint:'Cliquez sur la carte pour chercher autour de ce point.',
    map_zone_radius:'Rayon (km)', map_zone_results:'{n} bien(s) dans un rayon de {r} km',
    map_draw_mode:'✏️ Dessiner', map_draw_exit:'✕ Dessin', map_draw_hint:'Cliquez pour poser les points de la zone, puis « Terminer » (ou cliquez sur le premier point).',
    map_draw_finish:'✔ Terminer', map_draw_undo:'↶ Annuler le dernier point', map_draw_clear:'🗑 Effacer',
    map_draw_min:'Posez au moins 3 points pour délimiter une zone.', map_draw_max:'Zone trop détaillée : 60 points au plus.',
    map_zone_results_poly:'{n} bien(s) dans la zone dessinée', map_truncated:'Zone très dense : seuls {n} biens sont affichés, resserrez la recherche.',
    map_me_btn:'🎯 Autour de moi', map_me_locating:'⏳ Localisation…', map_me_denied:"Impossible d'accéder à votre position.", map_me_here:'Vous êtes ici (position approximative)',
    dash_stats_btn:'📈 30j', dash_stats_title:'Statistiques · 30 derniers jours',
    featured_badge:'⭐ À la une', featured_title:'⭐ Annonces à la une', u_day_one:'jour', u_day_two:'jours', u_day_many:'jours',
    dash_feature_btn:'⭐ Mettre à la une', dash_featured_until:"⭐ À la une jusqu'au {date}",
    pr_title:'Mettre votre annonce à la une', pr_intro:"Votre annonce apparaît en tête de l'accueil et de la page Annonces pendant la durée choisie.",
    pr_extend_note:"Si l'annonce est déjà à la une, la durée s'ajoute à la fin de la période en cours.", pr_test_note:"Mode test : aucun argent n'est prélevé.",
    pr_pay:'Payer et mettre à la une', pr_closed:'Les mises à la une ne sont pas ouvertes pour le moment.', pr_choose:'Choisissez une formule.', pr_done:"Votre annonce est à la une jusqu'au {date}.",
    st_views:'Vues', st_favs:'Favoris', st_clicks:'Clics', st_calls:'Appels', st_wa:'WhatsApp', st_contacts:'Demandes', st_conversion:'Taux de contact',
    st_favs_total:'{n} au total', st_no_data:"Pas encore de visite sur cette période.", st_advice:'Conseils', st_advice_tip:"Conseils calculés d'après les statistiques de cette annonce.",
    st_export_csv:'⬇ CSV',
    dash_edit:'✏️ Modifier', pub_edit_heading:"✏️ Modifier l'annonce", pub_edit_submit:'Enregistrer les modifications',
    pub_edit_locked:"Le mode, le type de bien et la wilaya ne se modifient pas : republiez une annonce pour les changer.",
    pub_edit_saved:'Modifications enregistrées.', pub_edit_pending:"Modifications enregistrées. L'annonce repasse en validation avant de reparaître sur le site.",
    price_drop_badge:'📉 Prix en baisse',
    adv_price_high:"Votre prix au m² est environ {pct} % au-dessus de la médiane des annonces comparables : le revoir peut relancer les visites.",
    adv_few_photos:"Votre annonce n'a que {n} photo(s) : visez au moins {min}. Les annonces bien illustrées reçoivent plus de contacts.",
    adv_no_phone:"Aucun numéro de téléphone n'est renseigné : les boutons Appeler et WhatsApp ne s'affichent pas sur votre annonce. Ajoutez-le dans votre profil.",
    adv_no_engagement:"{views} vues en 30 jours mais aucun favori, clic ni demande : vérifiez le prix, la première photo et la description.",
    adv_views_drop:"Les vues ont baissé d'environ {pct} % par rapport à la semaine précédente : actualisez l'annonce (photos, prix) ou confirmez-la « toujours disponible ».",
    adv_low_visibility:"Seulement {n} vue(s) ces 7 derniers jours : soignez le titre (type de bien, quartier) et la première photo.",
    adv_short_description:"Votre description ne compte que {n} caractères : détaillez l'état du bien, l'environnement et les commodités (au moins {min}).",
    adv_no_location:"Aucune position sur la carte : indiquez l'adresse pour que le bien apparaisse dans la recherche sur la carte.",
    adv_no_media:"Ajoutez une vidéo ou une visite virtuelle (YouTube, Vimeo, Matterport, Kuula) : elles rassurent les visiteurs.",
    adv_no_features:"Aucun équipement n'est indiqué (parking, ascenseur, balcon…) : cochez ceux de votre bien, ils servent aux filtres.",
    adv_no_floor:"L'étage n'est pas renseigné : les acheteurs et locataires filtrent souvent par étage pour un appartement ou un bureau.",
    adv_low_conversion:"Seulement {contacts} demande(s) pour {views} vues en 30 jours (moins de 2 %) : enrichissez la description, ajoutez des équipements et vérifiez que votre prix est compétitif.",
    adv_all_good:"Votre annonce est complète et suscite de l'intérêt. Confirmez-la régulièrement pour qu'elle reste bien placée.",
    responsive_badge:'⚡ Réactif',
    pub_estimate_loading:"Calcul de l’estimation…",
    pub_estimate_hint:'Annonces similaires : fourchette <b>{low}</b> – <b>{high}</b> DZD (médiane {median})',
    pub_estimate_per_m2:'{per_m2} DZD/m² en médiane',
    pub_estimate_none:"Pas assez d’annonces similaires pour estimer.",
    fav_share_btn:'🔗 Partager mes favoris',
    fav_share_copied:'Lien copié !',
    fav_share_revoke:'Révoquer le lien',
    fav_share_revoked:'Lien révoqué.',
    fav_shared_title:'Favoris partagés',
    fav_share_intro:'Partagez ce lien pour que vos contacts voient votre sélection sans créer de compte.',
    mkt_title:'Tendances du marché',
    mkt_wilaya:'Wilaya',
    mkt_med:'Prix médian/m²',
    mkt_count:'Annonces',
    mkt_trend:'Tendance',
    mkt_up:'↑ hausse',
    mkt_down:'↓ baisse',
    mkt_stable:'→ stable',
    mkt_no_data:'Données insuffisantes.',
    mkt_filter_mode:'Mode',
    mkt_filter_type:'Type',
    mkt_filter_all:'Tous',
    audit_title:'Journal d\'audit',
    audit_date:'Date',
    audit_admin:'Administrateur',
    audit_action:'Action',
    audit_target:'Cible',
    audit_details:'Détails',
    pass_weak:'Faible',
    pass_fair:'Moyen',
    pass_good:'Bon',
    pass_strong:'Fort',
    trust_title:'Fiabilité de l\'annonceur', trust_low:'Peu d\'historique', trust_mid:'Profil établi', trust_high:'Annonceur de confiance',
    evol_title:'Évolution sur', evol_days:'jours', evol_users:'Inscriptions', evol_listings:'Annonces publiées', evol_views:'Vues', evol_contacts:'Demandes',
    prof_export:'Télécharger mes données (RGPD)',
    push_ask:'Activer les notifications push pour ne rien manquer ?', push_yes:'Oui', push_skip:'Plus tard',
    push_on:'🔔 Push activé', push_off:'🔕 Push désactivé',
    dash_tab_calendrier:'Calendrier des visites',
    cal_title:'📅 Calendrier des visites', cal_none:'Aucune visite confirmée à venir.',
    calc_title:'🏦 Simulateur de crédit', calc_amount:'Prix du bien (DZD)', calc_apport:'Apport personnel (DZD)',
    calc_duration:'Durée (années)', calc_rate:'Taux annuel (%)', calc_btn:'Calculer',
    calc_loan:'Montant emprunté', calc_monthly:'Mensualité estimée', calc_total_interest:'Coût du crédit', calc_total:'Total à rembourser',
    calc_disclaimer:'Simulation indicative. Conditions selon votre banque.',
    est_title:'🔍 Estimation du prix', est_intro:'Fourchette basée sur les annonces actives comparables.',
    est_surface:'Surface (m²)', est_btn:'Estimer',
    est_low:'Fourchette basse', est_mid:'Estimation médiane', est_high:'Fourchette haute',
    est_pm2:'prix/m²',
    est_scope_wilaya:'Source : annonces de la wilaya.', est_scope_national:'Source : annonces nationales (données wilaya insuffisantes).',
    est_no_data:'Pas assez d\'annonces comparables. Élargissez les critères.',
    est_count:'{n} annonces comparables',
    share_native:'📤 Partager',
    vd_member_since:'Membre depuis', vd_listings:'annonces actives', vd_profile:'Voir le profil du vendeur',
    vd_see_listings:'Voir ses annonces', vd_no_listings:'Aucune annonce active.',
    src_title:'Requêtes de recherche (30 derniers jours)', src_top:'Les plus recherchées',
    src_daily:'Volume journalier', src_count:'recherche(s)', src_no_data:'Aucune recherche texte enregistrée.',
    src_avg:'résultats moy.',
    fav_note_ph:'Ma note privée (500 car. max.)…', fav_note_save:'Enregistrer', fav_note_saved:'✅ Note enregistrée.',
    fav_note_del:'Effacer la note',
  },
  ar: {
    site_title:'DzImmo — العقارات في الجزائر',
    nav_home:'الرئيسية', nav_annonces:'الإعلانات', nav_agences:'الوكالات', nav_carte:'الخريطة', nav_estimer:'🔍 تقدير', menu_label:'القائمة',
    btn_publier:'+ نشر', btn_login:'تسجيل الدخول', btn_register:'إنشاء حساب',
    hero_title:'ابحث عن عقارك في الجزائر',
    hero_sub:'شقق، فلل، أراضي، محلات · بيع وإيجار في جميع أنحاء الجزائر',
    err_server:'خطأ في الخادم.', err_network:'تعذّر الاتصال. تحقّق من الشبكة.',
    s_all_wilayas:'جميع الولايات', s_all_modes:'بيع وإيجار',
    s_vente:'بيع', s_loc_longue:'إيجار طويل الأمد', s_loc_courte:'إيجار قصير الأمد',
    s_all_types:'جميع الأنواع', s_appart:'شقة', s_villa:'فيلا',
    s_maison:'منزل', s_bureau:'مكتب', s_local:'محل تجاري',
    s_terrain:'أرض', s_ferme:'مزرعة', s_entrepot:'مستودع',
    btn_search:'🔍 بحث',
    tab_tout:'الكل', tab_vente:'بيع', tab_loc_long:'إيجار طويل', tab_loc_court:'إيجار قصير',
    recent_listings:'إعلانات حديثة', loading:'جارٍ التحميل…', see_all:'عرض جميع الإعلانات ←',
    ft_nav:'التنقل', ft_all:'جميع الإعلانات', ft_agencies:'الوكالات', ft_publish:'نشر إعلان',
    ft_types:'أنواع العقارات', ft_apparts:'شقق', ft_villas:'فلل',
    ft_terrains:'أراضي', ft_locals:'محلات تجارية',
    ft_legal:'قانوني', ft_cgu:'شروط الاستخدام', ft_privacy:'سياسة الخصوصية',
    ft_mentions:'الإشعارات القانونية', ft_contact:'اتصل بنا',
    ft_stats:'📊 إحصائيات المنصة', ft_contrats:'📄 نماذج العقود',
    ft_explore:'استكشف',
    ft_about:'المنصة المرجعية للعقارات في الجزائر. شراء، بيع، إيجار.',
    nav_admin:'⚙️ الإدارة', notif_title:'🔔 الإشعارات', notif_read_all:'قراءة الكل', notif_empty:'لا توجد إشعارات',
    cmp_compare:'⚖ مقارنة', cmp_clear:'✕ إفراغ', cmp_title:'⚖ مقارنة العقارات', cmp_close:'✕ إغلاق',
    filter_search:'بحث', filter_kw_ph:'كلمة مفتاحية…', filter_apply:'🔍 تصفية',
    near_me:'📍 بالقرب مني', near_me_results:'📍 نتائج بالقرب من:', near_me_clear:'✕ إزالة', commune_in:'🏘️ البلدية:',
    annonces_heading:'إعلانات عقارية', res_one:'نتيجة', res_many:'نتائج',
    search_suggest:'هل تقصد:',
    pub_first_photo:'ستكون الصورة الأولى هي الصورة الرئيسية.',
    msg_title:'💬 الرسائل', msg_select:'اختر محادثة', msg_none:'لا توجد محادثات',
    u_dzd:'د.ج', u_month:'/شهر', u_m2:'م²',
    u_room_one:'غرفة', u_room_two:'غرفتان', u_room_many:'غرف',
    u_bath_one:'حمام', u_bath_two:'حمامان', u_bath_many:'حمامات',
    u_view_one:'مشاهدة', u_view_two:'مشاهدتان', u_view_many:'مشاهدات', st_ad_two:'إعلانان',
    no_listings:'لا توجد إعلانات متاحة', verified_badge:'✓ موثَّق', fav_tip:'المفضلة', cmp_tip:'مقارنة',
    fav_removed:'تمت الإزالة من المفضلة.', fav_added:'❤️ تمت الإضافة إلى المفضلة!', link_copied:'🔗 تم نسخ الرابط!',
    feat_meuble:'مفروش', feat_parking:'موقف سيارات', feat_balcon:'شرفة', feat_terrasse:'تراس', feat_ascenseur:'مصعد',
    feat_gardien:'حارس', feat_piscine:'مسبح', feat_climatisation:'تكييف', feat_chauffage:'تدفئة',
    feat_wifi:'واي فاي', feat_cave:'قبو', feat_jardin:'حديقة', feat_alarme:'جهاز إنذار', feat_interphone:'إنتركوم',
    feat_eau:'ماء', feat_electricite:'كهرباء', feat_gaz:'غاز', feat_route:'مدخل على الطريق', feat_fibre:'ألياف بصرية',
    det_see_photos:'📷 عرض {n} صور', det_desc:'الوصف', det_no_desc:'لا يوجد وصف.',
    det_reviews:'التقييمات', det_anon:'مجهول', det_agency:'وكالة عقارية', det_private:'فرد',
    det_contact:'تواصل مع البائع', det_req_type:'نوع الطلب',
    det_opt_info:'طلب معلومات', det_opt_visit:'طلب زيارة', det_opt_offer:'تقديم عرض سعر',
    det_visit_date:'تاريخ الزيارة المطلوب', det_visit_time:'الوقت المفضل', det_visit_time_none:'بدون تفضيل',
    det_offer_amount:'مبلغ العرض (د.ج)',
    det_msg:'الرسالة', det_msg_ph:'رسالتك…', det_send_req:'إرسال الطلب', det_call:'اتصال', det_whatsapp:'واتساب', det_wa_msg:'السلام عليكم، أنا مهتم بإعلانكم «{title}» على DzImmo: {url}',
    det_send_msg:'💬 إرسال رسالة',
    det_login_hint:'سجّل الدخول للتواصل مع البائع', det_login:'تسجيل الدخول',
    rp_btn:'الإبلاغ عن هذا الإعلان', rp_login:'سجّل الدخول للإبلاغ عن إعلان.', rp_title:'الإبلاغ عن هذا الإعلان',
    rp_intro:'هل تلاحظ مشكلة في هذا الإعلان؟ أخبرنا بها وسيراجع مشرف بلاغك.',
    rp_choose:'— اختر السبب —', rp_motif:'السبب', rp_message:'تفاصيل (اختياري)', rp_send:'إرسال البلاغ',
    rp_need_motif:'اختر سببًا.', rp_thanks:'شكرًا، تم إرسال بلاغك.',
    rp_m_arnaque:'احتيال أو إعلان مزيف', rp_m_indisponible:'عقار بيع أو أُجّر بالفعل', rp_m_faux:'معلومات مضللة (السعر، المساحة…)',
    rp_m_photos:'صور غير مطابقة', rp_m_doublon:'إعلان مكرر', rp_m_interdit:'محتوى ممنوع أو صادم', rp_m_autre:'أخرى',
    det_published:'نُشر في', det_copy:'🔗 نسخ', det_print:'🖨️ طباعة البطاقة (مع رمز QR)', det_sent:'✅ تم إرسال الطلب إلى البائع!',
    det_price_hist:'📈 تطور السعر', det_stable:'مستقر', det_similar:'عقارات مشابهة', new_badge:'جديد',
    cmp_max:'يمكنك مقارنة 3 عقارات كحد أقصى.', cmp_min:'اختر عقارين على الأقل للمقارنة.',
    cmp_remove:'إزالة', cmp_view:'عرض ←', cmp_r_price:'السعر', cmp_r_commune:'البلدية', cmp_r_surface:'المساحة',
    cmp_r_floor:'الطابق', cmp_r_published:'تاريخ النشر', cmp_r_verified:'موثَّق',
    map_no_pos:'بدون موقع', map_view:'عرض الإعلان ←', map_error:'خطأ في التحميل',
    ag_none:'لا توجد وكالات مسجّلة', ag_rating:'التقييم', ag_website:'🌐 الموقع الإلكتروني',
    dash_chart:'📊 المشاهدات حسب الإعلان (أفضل 8)', dash_archive_confirm:'هل تريد أرشفة هذا الإعلان؟ لن يعود ظاهراً.',
    dash_archived:'تمت أرشفة الإعلان.', dash_error:'خطأ', dash_none:'لا توجد إعلانات', dash_more:'عرض المزيد من الإعلانات', dash_first:'انشر إعلانك الأول!',
    dash_view:'عرض', dash_archive:'أرشفة', u_req_one:'طلب', u_req_two:'طلبان', u_req_many:'طلبات',
    dash_no_req:'لا توجد طلبات مستلمة', dash_t_visite:'🗓 زيارة', dash_t_offre:'💰 عرض', dash_t_info:'ℹ️ معلومات',
    dash_c_pending:'في الانتظار', dash_c_confirmed:'مؤكَّد', dash_c_rejected:'مرفوض', dash_c_done:'منتهٍ',
    dash_status_updated:'تم تحديث الحالة.', dash_no_fav:'لا توجد مفضلات', dash_fav_hint:'أضف إعلانات إلى المفضلة لتجدها هنا.',
    alert_active:'🔔 تنبيه نشط', ph_example:'مثال: {v}',
    prof_title:'المعلومات الشخصية', prof_name:'الاسم', prof_email:'البريد الإلكتروني', prof_phone:'الهاتف', prof_bio:'نبذة',
    prof_notify_drop:'تنبيهات انخفاض الأسعار', prof_notify_drop_hint:'إشعار وبريد إلكتروني عندما ينخفض سعر إعلان في مفضلتك بنسبة 3٪ على الأقل.',
    prof_push_enable:'🔔 تفعيل الإشعارات الفورية', prof_push_disable:'🔕 إلغاء الإشعارات الفورية',
    prof_push_hint:'استلم التنبيهات حتى عندما يكون المتصفح مغلقاً.', prof_push_na:'الإشعارات الفورية غير متوفرة في هذا المتصفح.',
    prof_save:'حفظ', prof_logout:'تسجيل الخروج', prof_logout_confirm:'هل تريد تسجيل الخروج؟', prof_updated:'✅ تم تحديث الملف الشخصي!',
    logout_done:'تم تسجيل الخروج.', pub_choose:'اختر…',
    mod_pending_ok:'تم إرسال الإعلان! سيظهر بعد مراجعة فريقنا له (عادةً خلال 24 ساعة). سيتم إشعارك بالقرار.',
    mod_banner_pending:'إعلانك في انتظار المراجعة: لا يراه سواك وفريقنا.',
    mod_banner_rejected:'إعلان مرفوض.', dash_reason:'سبب الرفض:',
    dash_st_active:'نشط', dash_st_sold:'مباع', dash_st_rented:'مؤجَّر', dash_st_archived:'مؤرشف',
    dash_st_pending:'في انتظار المراجعة', dash_st_rejected:'مرفوض',
    dash_delete:'حذف', dash_delete_confirm:'هل تريد حذف هذا الإعلان نهائياً؟',
    seo_t_appartement:'شقق', seo_t_villa:'فيلات', seo_t_maison:'منازل', seo_t_bureau:'مكاتب',
    seo_t_local_commercial:'محلات تجارية', seo_t_terrain:'أراضٍ', seo_t_ferme:'مزارع', seo_t_entrepot:'مستودعات',
    seo_t_all:'عقارات', seo_m_vente:'للبيع', seo_m_location_longue:'للإيجار',
    seo_m_location_courte:'للإيجار الموسمي', seo_in:'في',
    mc_title:'نماذج العقود', mc_sub:'عقد إيجار، وصل إيجار، محضر معاينة… املأ النموذج، راجع المعاينة ثم اطبعه بصيغة PDF أو حمّله بصيغة Word.',
    mc_disclaimer:'نماذج استرشادية مستوحاة من الأعراف ومن القانون المدني الجزائري (أحكام الإيجار). وهي لا تغني عن استشارة موثّق أو محامٍ: بالنسبة لعقد الإيجار الطويل الأمد أو أي عقد يستلزم الشكل الرسمي، توجّه إلى موثّق. تذكّر تسجيل العقد لدى مصالح الضرائب. لا يتم إرسال أي بيانات مُدخَلة إلى الخادم ولا حفظها.',
    mc_use:'استعمال هذا النموذج', mc_all:'→ جميع النماذج', mc_doc_lang:'لغة الوثيقة',
    mc_print:'طباعة / PDF', mc_word:'Word', mc_reset:'إعادة التعيين',
    st_title:'📊 DzImmo بالأرقام', st_sub:'إحصائيات المنصة في الوقت الحقيقي',
    st_active:'الإعلانات النشطة', st_sold:'العقارات المباعة', st_rented:'العقارات المؤجرة',
    st_users:'المستخدمون', st_agencies:'الوكالات', st_views:'إجمالي المشاهدات',
    st_by_mode:'التوزيع حسب نوع الإعلان', st_active_sub:'الإعلانات النشطة',
    st_mode_long:'إيجار طويل', st_mode_short:'إيجار قصير',
    st_types:'أنواع العقارات', st_types_sub:'أعلى 6 — الإعلانات النشطة',
    st_wilayas:'أعلى الولايات', st_wilayas_sub:'الإعلانات النشطة حسب الولاية',
    st_ad_one:'إعلان', st_ad_many:'إعلانات', st_footer:'بيانات في الوقت الحقيقي',
    ft_copy:'© 2026 DzImmo · الجزائر · جميع الحقوق محفوظة',
    nl_title:'النشرة البريدية', nl_desc:'احصل على أخبارنا ومختارات من الإعلانات. إلغاء الاشتراك بنقرة واحدة.',
    nl_btn:'اشتراك', nl_sent:'✅ أُرسلت إليك رسالة تأكيد. اضغط على الرابط فيها لتفعيل اشتراكك.',
    nl_failed:'تعذّر الاشتراك حالياً.',
    nl_confirm_ask_title:'تأكيد اشتراكك', nl_confirm_ask_msg:'نقرة أخيرة لتصلك النشرة البريدية لـ DzImmo.', nl_confirm_ask_btn:'أؤكد اشتراكي',
    nl_confirm_done_title:'تم تأكيد الاشتراك', nl_confirm_done_msg:'شكراً! ستصلك نشرتنا البريدية من الآن. تحتوي كل رسالة على رابط لإلغاء الاشتراك.',
    nl_unsub_ask_title:'إلغاء الاشتراك في النشرة البريدية', nl_unsub_ask_msg:'أكِّد لتتوقف عن استلام رسائلنا.', nl_unsub_ask_btn:'إلغاء اشتراكي',
    nl_unsub_done_title:'تم إلغاء اشتراكك', nl_unsub_done_msg:'لن تصلك النشرة البريدية لـ DzImmo بعد الآن.',
    nl_bad_title:'الرابط غير صالح أو منتهي الصلاحية', nl_bad_msg:'لم يعد هذا الرابط صالحاً. إن كنت قد اشتركت منذ أكثر من 7 أيام دون تأكيد، فاشترك من جديد عبر أسفل الصفحة.',
    m_login:'تسجيل الدخول', m_email:'البريد الإلكتروني', m_pass:'كلمة المرور',
    m_connect:'تسجيل الدخول', m_or:'أو', m_create_account:'إنشاء حساب',
    m_forgot:'نسيت كلمة المرور؟', m_register:'إنشاء حساب',
    m_name:'الاسم الكامل', m_phone:'الهاتف', m_already:'لدي حساب بالفعل',
    m_forgot_title:'نسيت كلمة المرور', m_send_link:'إرسال الرابط',
    pub_heading:'📋 نشر إعلان', pub_title_label:'عنوان الإعلان *',
    pub_title_ph:'مثال: شقة F3 مضيئة في حيدرة',
    pub_mode:'النوع *', pub_type:'نوع العقار *', pub_price:'السعر (د.ج) *',
    pub_surface:'المساحة (م²)', pub_rooms:'الغرف', pub_baths:'دورات المياه',
    pub_floor:'الطابق', pub_wilaya:'الولاية *', pub_commune:'البلدية',
    pub_commune_ph:'مثال: حيدرة', pub_address:'العنوان',
    pub_address_ph:'العنوان التفصيلي (اختياري)', pub_desc:'الوصف',
    pub_desc_ph:'صف عقارك: الحالة، التجهيزات، المحيط…',
    pub_features:'🏷️ المميزات', pub_photos:'📷 الصور',
    pub_photos_hint:'انقر لإضافة صور (10 كحد أقصى، JPEG/PNG/WebP)',
    pub_media:'🎬 فيديو وجولة افتراضية (اختياري)', pub_video:'فيديو (يوتيوب أو فيميو)', pub_tour:'جولة افتراضية (Matterport أو Kuula)',
    pub_video_ph:'https://www.youtube.com/watch?v=…', pub_tour_ph:'https://my.matterport.com/show/?m=…',
    pub_media_hint:'الصق رابط المشاركة: نحن لا نستضيف أي ملف فيديو. لا يُحمَّل المشغّل إلا بعد نقر الزائر.',
    media_video:'فيديو', media_tour:'جولة افتراضية', media_load_video:'▶ تشغيل الفيديو', media_load_tour:'🧭 بدء الجولة الافتراضية',
    media_privacy:'لا يُحمَّل مشغّل {p} إلا بعد النقر: لا ملفات تعريف ارتباط من طرف ثالث قبل ذلك.', media_open:'فتح على {p}', media_badge_video:'فيديو', media_badge_tour:'جولة 3D',
    pub_submit:'نشر الإعلان', pub_cancel:'إلغاء',
    pub_score_label:'اكتمال الإعلان',
    f_meuble:'مفروشة', f_parking:'موقف سيارات', f_balcon:'شرفة', f_terrasse:'تراس',
    f_ascenseur:'مصعد', f_gardien:'حارس', f_piscine:'مسبح',
    f_clim:'تكييف هواء', f_chauff:'تدفئة مركزية', f_wifi:'واي فاي',
    f_cave:'قبو', f_jardin:'حديقة', f_alarme:'إنذار', f_interphone:'إنتيرفون',
    f_eau:'ماء الصنبور', f_elec:'كهرباء', f_gaz:'غاز طبيعي',
    f_route:'وصول طريق', f_fibre:'ألياف بصرية',
    dash_title:'مساحتي', dash_annonces:'الإعلانات', dash_actives:'النشطة',
    dash_demandes:'الطلبات المستلمة', dash_attente:'في الانتظار', dash_vues:'إجمالي المشاهدات',
    dash_tab_annonces:'إعلاناتي', dash_tab_contacts:'الطلبات المستلمة',
    dash_tab_favoris:'المفضلة', dash_tab_alertes:'تنبيهات البريد', dash_tab_profil:'الملف الشخصي',
    dash_tab_verif:'التوثيق',
    dash_tab_vitrine:'واجهتي',
    ft_promoters:'المروّجون العقاريون', ft_programmes:'المشاريع الجديدة',
    home_pros_title:'وكالات ومروّجون عقاريون موثَّقون', home_pros_all:'عرض الدليل ←',
    pro_dir_title:'الوكالات والمروّجون العقاريون',
    pro_dir_sub:'مهنيون موثَّقون، وإعلاناتهم ومشاريعهم الجديدة في كامل أنحاء الجزائر.',
    pro_tab_all:'الكل', pro_tab_agence:'الوكالات', pro_tab_promoteur:'المروّجون', pro_tab_prog:'المشاريع الجديدة',
    pro_title_all:'الوكالات والمروّجون العقاريون في الجزائر', pro_title_promoteur:'المروّجون العقاريون في الجزائر',
    pro_title_prog:'مشاريع عقارية جديدة في الجزائر',
    pro_search_ph:'الاسم، البلدية…', pro_verified_only:'الموثَّقون فقط',
    pro_sort_relevance:'الأكثر صلة', pro_sort_listings:'الأكثر إعلانات', pro_sort_rating:'الأعلى تقييماً', pro_sort_recent:'الأحدث', pro_sort_name:'الاسم (أ ← ي)',
    pro_more:'عرض المزيد', pro_none:'لا يوجد مهني يطابق بحثك.',
    pro_verified:'موثَّق', pro_verified_tip:'تم التحقق من السجل التجاري أو الاعتماد من طرف DzImmo',
    kind_agence:'وكالة عقارية', kind_promoteur:'مروّج عقاري',
    svc_vente:'البيع', svc_location:'الإيجار', svc_location_courte:'الإيجار الموسمي', svc_neuf:'المشاريع الجديدة',
    svc_gestion:'تسيير الإيجارات', svc_estimation:'تقدير مجاني', svc_accompagnement:'المساعدة في القرض والتوثيق',
    u_prog_one:'مشروع', u_prog_two:'مشروعان', u_prog_many:'مشاريع',
    u_review_one:'تقييم', u_review_two:'تقييمان', u_review_many:'تقييمات',
    u_year_one:'سنة', u_year_two:'سنتان', u_year_many:'سنوات',
    ag_share:'مشاركة', ag_link_copied:'تم نسخ الرابط', ag_edit:'تعديل واجهتي', ag_website_short:'الموقع', ag_founded:'تأسست سنة {y}',
    ag_unverified:'لم يقم هذا المهني بعد بالتحقق من سجله التجاري أو اعتماده.',
    ag_stat_done:'عقار مباع أو مؤجَّر', ag_stat_exp:'من الخبرة', ag_stat_since:'عضو منذ',
    ag_sec_about:'نبذة', ag_sec_programmes:'المشاريع الجديدة', ag_sec_listings:'الإعلانات', ag_sec_reviews:'آراء العملاء',
    ag_services:'الخدمات', ag_coverage:'مناطق النشاط', ag_hours:'ساعات العمل', ag_address:'العنوان', ag_map:'عرض على الخريطة',
    ag_all_programmes:'جميع المشاريع', ag_filter_all:'الكل', ag_no_listings:'لا توجد إعلانات لهذا التصفية.',
    ag_review_on:'تقييم حول', ag_wa_msg:'مرحباً {name}، أتواصل معكم من DzImmo: {url}',
    pg_dir_title:'مشاريع عقارية جديدة', pg_dir_sub:'إقامات على المخطط أو قيد الإنجاز أو مسلَّمة، ينشرها مروّجون موثَّقون.',
    pg_all_status:'كل مراحل الإنجاز', pg_st_sur_plan:'على المخطط', pg_st_en_construction:'قيد الإنجاز', pg_st_livre:'مسلَّم',
    pg_q_short:'ف', pg_delivery_at:'التسليم {when}', pg_delivered:'سُلِّم سنة {y}',
    pg_from:'ابتداءً من',
    u_lot_avail_one:'وحدة متاحة', u_lot_avail_two:'وحدتان متاحتان', u_lot_avail_many:'وحدات متاحة',
    u_lot_sold_one:'وحدة مباعة', u_lot_sold_two:'وحدتان مباعتان', u_lot_sold_many:'وحدات مباعة',
    u_lot_total_one:'وحدة إجمالاً', u_lot_total_two:'وحدتان إجمالاً', u_lot_total_many:'وحدات إجمالاً',
    u_pro_one:'مهني', u_pro_two:'مهنيان', u_pro_many:'مهنيون',
    pg_none:'لا توجد مشاريع حالياً.', pg_of:'مشاريع',
    pg_features:'المرافق', pg_lots:'وحدات المشروع', pg_no_lots:'لا توجد وحدات معروضة حالياً.',
    pg_lot_of:'وحدة من مشروع', pg_title_suffix:'مشروع جديد',
    pg_hidden_note:'هذا المشروع غير ظاهر للعموم: يظهر من جديد بعد التحقق من سجلك التجاري.',
    pg_wa_msg:'مرحباً، أرغب في معلومات حول المشروع «{name}»: {url}',
    pg_feat_ascenseur:'مصعد', pg_feat_parking:'موقف سيارات', pg_feat_espaces_verts:'مساحات خضراء', pg_feat_securite:'حراسة 24/24',
    pg_feat_aire_jeux:'فضاء ألعاب', pg_feat_commerces:'محلات تجارية', pg_feat_gaz_ville:'غاز المدينة', pg_feat_fibre:'الألياف البصرية',
    vt_intro_title:'هل أنت وكالة عقارية أو مروّج عقاري؟', vt_intro_text:'أنشئ واجهتك: صفحة باسمك تجمع كل إعلاناتك.',
    vt_benefit_1:'صفحة عامة بشعارك وبيانات الاتصال وآراء عملائك',
    vt_benefit_2:'شارة «موثَّق» بعد التحقق من سجلك التجاري', vt_benefit_3:'للمروّجين: مشاريعك الجديدة ووحداتها',
    vt_create_title:'إنشاء واجهتي', vt_profile:'واجهتي', vt_create:'إنشاء واجهتي', vt_save:'حفظ', vt_saved:'تم حفظ الواجهة.', vt_created:'تم إنشاء الواجهة.',
    vt_kind_agence_hint:'تبيع أو تؤجر لحساب الملاك', vt_kind_promoteur_hint:'تبني وتبيع مشاريعها الجديدة',
    vt_logo:'الشعار', vt_logo_hint:'مربع، ويفضَّل بخلفية موحَّدة', vt_cover:'صورة الغلاف', vt_cover_hint:'شكل عريض (3:1): وكالتك أو أحد إنجازاتك…',
    vt_upload:'اختر صورة', vt_remove:'إزالة', vt_img_big:'الصورة كبيرة جداً (10 ميغابايت كحد أقصى).',
    vt_name:'اسم الوكالة أو الشركة', vt_tagline:'شعار جملة', vt_tagline_ph:'مثال: شريكك العقاري منذ 2010',
    vt_desc:'التعريف', vt_desc_ph:'تخصصاتك، فريقك، التزاماتك…',
    vt_wilaya:'الولاية', vt_commune:'البلدية', vt_address:'العنوان', vt_phone:'الهاتف', vt_founded:'سنة التأسيس', vt_website:'الموقع الإلكتروني',
    vt_hours:'ساعات العمل', vt_hours_ph:'مثال: الأحد–الخميس 9س–17س',
    vt_services:'الخدمات المقدَّمة', vt_coverage:'مناطق النشاط (ولايات أخرى)', vt_coverage_add:'إضافة ولاية', vt_coverage_max:'20 ولاية كحد أقصى.',
    vt_required:'الاسم والولاية مطلوبان.', vt_delete:'حذف واجهتي',
    vt_delete_confirm:'حذف واجهتك؟ تبقى إعلاناتك منشورة وتُحذف مشاريعك.', vt_deleted:'تم حذف الواجهة.',
    vt_view:'عرض واجهتي', vt_complete:'اكتمل الملف بنسبة {p} %',
    vt_stats_title:'إحصاءات الوكالة · 30 يوماً', vt_stats_listings:'إعلانات نشطة', vt_stats_top:'أفضل الإعلانات (30 يوماً)',
    vt_todo_logo:'أضف شعاراً', vt_todo_cover:'صورة غلاف', vt_todo_tagline:'شعاراً', vt_todo_desc:'تعريفاً مفصَّلاً',
    vt_todo_phone:'رقم هاتف', vt_todo_web:'موقعاً أو شبكة اجتماعية', vt_todo_hours:'ساعات العمل', vt_todo_services:'خدماتك',
    vt_todo_zone:'مناطق نشاطك', vt_todo_year:'سنة التأسيس',
    vt_verified_ok:'تم التحقق من سجلك التجاري: تظهر شارة «موثَّق» على واجهتك وتُنشر إعلاناتك دون مراجعة.',
    vt_verify_title:'احصل على شارة «موثَّق»',
    vt_verify_text:'أرسل سجلك التجاري أو اعتمادك: يطمئن الزوار، ويضعك في مقدمة الدليل، ويتيح النشر دون مراجعة وإنشاء مشاريع جديدة.',
    vt_verify_btn:'طلب التحقق',
    pg_mine_title:'مشاريعي الجديدة', pg_new:'مشروع جديد', pg_edit:'تعديل', pg_name:'اسم المشروع', pg_status:'مرحلة الإنجاز',
    pg_units:'عدد الوحدات', pg_delivery:'التسليم المتوقع', pg_photos:'الصور',
    pg_save:'حفظ المشروع', pg_saved:'تم حفظ المشروع.', pg_delete_confirm:'حذف هذا المشروع؟ تبقى وحداته منشورة.', pg_deleted:'تم حذف المشروع.',
    pg_needs_verif:'المشاريع الجديدة مخصصة للمروّجين الذين تم التحقق من سجلهم التجاري. وثِّق حسابك لتتمكن من نشرها.',
    pg_none_mine:'لا توجد مشاريع بعد. أنشئ مشروعاً ثم اربط به وحداتك عند نشر إعلان.',
    pg_hidden_short:'مخفي (التحقق مطلوب)',
    pub_as_title:'🏢 النشر باسم', pub_as_self:'أنا (فرد)', pub_project:'مشروع جديد', pub_project_none:'بدون (إعلان مستقل)',
    dash_st_expired:'مسحوب (غير مؤكَّد)',
    dash_calls:'المكالمات', dash_whatsapps:'واتساب',
    dash_confirmed:'تم تأكيد التوفر في {date}', dash_expires:'⚠ يجب تأكيده قبل {date}',
    dash_expired_note:'تم سحبه لعدم التأكيد: جدِّده إذا كان العقار ما زال متاحاً.',
    dash_still:'✓ ما زال متاحاً', dash_renew:'🔄 تجديد', dash_renewed:'شكراً! تم تأكيد إعلانك.',
    dash_clicks_tip:'النقرات على «اتصال» و«واتساب» من هذا الإعلان',
    det_confirmed:'تم تأكيد التوفر في',
    rn_title:'هل ما زال الإعلان متاحاً؟', rn_yes:'✓ نعم، ما زال متاحاً', rn_no:'لا، تم بيعه / تأجيره',
    rn_done:'شكراً! يبقى إعلانك منشوراً.', rn_closed:'تم سحب الإعلان: سُجِّل على أنه مباع / مؤجَّر.',
    q_price_low:'سعر المتر المربع أقل بكثير من العقارات المماثلة: سيراجع فريقنا الإعلان قبل نشره.',
    q_price_high:'سعر المتر المربع أعلى بكثير من العقارات المماثلة: سيراجع فريقنا الإعلان قبل نشره.',
    q_dup_own:'لقد نشرت من قبل إعلاناً مشابهاً جداً («{title}»).',
    q_dup_other:'نص هذا الإعلان مطابق لنص إعلان منشور من قبل: سيراجعه فريقنا قبل نشره.',
    q_content_bypass:'الوصف يحتوي على معلومات اتصال مباشرة (هاتف أو بريد أو رابط): استخدم فقط نظام التواصل في المنصة. سيراجع فريقنا الإعلان.',
    q_held:'حسابك موثوق، لكن هذا الإعلان يُراجَع قبل النشر بسبب التنبيه أعلاه.',
    q_pending_flag:'قيد المراجعة: سعر غير معتاد أو نص مطابق لإعلان آخر.',
    g_terms:'بالمتابعة عبر Google فإنك توافق على <a href="#" data-p="cgu" onclick="return goLegal(this)">شروط الاستخدام</a> و<a href="#" data-p="confidentialite" onclick="return goLegal(this)">سياسة الخصوصية</a>.',
    g_created:'تم إنشاء الحساب عبر Google. مرحباً {name}!', g_connected:'تم تسجيل الدخول عبر Google: {name}',
    mfa_title:'التحقق بخطوتين', mfa_help:'أدخل الرمز المكوَّن من 6 أرقام من تطبيق المصادقة، أو أحد رموز الطوارئ الخاصة بك.',
    mfa_code:'رمز التحقق', mfa_verify:'تحقق', mfa_back:'رجوع', mfa_need_code:'أدخل رمز التحقق.',
    mfa_recovery_low:'بقي لديك {n} من رموز الطوارئ: فكّر في إنشاء رموز جديدة (الإدارة ← الأمان).',
    m_phone_hint:'يظهر هذا الرقم على إعلاناتك (زرّا الاتصال والواتساب). من الخارج: ابدأ بـ + ثم رمز البلد (مثال: <bdi dir="ltr">+33 6 12 34 56 78</bdi>).',
    adv_identity:'الهوية موثَّقة', adv_business:'مهني موثَّق',
    adv_identity_tip:'تحقق DzImmo من وثيقة هوية هذا المعلن. وهذا لا يثبت أنه مالك العقار.',
    adv_business_tip:'تحقق DzImmo من السجل التجاري أو الاعتماد الخاص بهذا المهني.',
    vf_title:'توثيق حسابي',
    vf_intro:'تطمئن شارة «موثَّق» المشترين والمستأجرين. أرسل وثيقة: يراجعها مشرف في DzImmo ثم يحذفها.',
    vf_ok_identity:'هويتك موثَّقة منذ {date}.',
    vf_ok_business:'صفتك كمهني موثَّقة منذ {date}.',
    vf_pending:'طلبك قيد المراجعة (أُرسل في {date}). سنعلمك بإشعار وبريد إلكتروني فور اتخاذ القرار.',
    vf_rejected:'تم رفض طلبك الأخير: {reason}',
    vf_cancel:'إلغاء الطلب', vf_cancel_confirm:'هل تريد إلغاء هذا الطلب وحذف الوثائق المرسلة؟', vf_canceled:'تم إلغاء الطلب.',
    vf_upgrade:'هل أنت مهني؟ وثّق أيضاً سجلك التجاري أو اعتمادك.',
    vf_no_ownership:'توثيق الهوية لا يثبت ملكية عقار محدد، بل يؤكد فقط من هو المعلن.',
    vf_kind:'أنت', vf_kind_identity:'فرد — وثيقة هوية', vf_kind_business:'مهني أو وكالة — سجل تجاري أو اعتماد',
    vf_doc:'نوع الوثيقة',
    vf_doc_cni:'بطاقة التعريف الوطنية', vf_doc_passeport:'جواز السفر', vf_doc_permis:'رخصة السياقة',
    vf_doc_registre_commerce:'السجل التجاري', vf_doc_agrement:'الاعتماد',
    vf_ref:'رقم السجل التجاري أو الاعتماد',
    vf_files:'صور الوثيقة (الوجه ثم الظهر)', vf_files_hint:'JPEG أو PNG أو WebP · صورتان على الأكثر، 8 ميغابايت لكل واحدة · نص مقروء دون انعكاس ضوئي',
    vf_consent:'أوافق على أن يراجع DzImmo هذه الوثيقة للتحقق من حسابي. ستُحذف فور اتخاذ القرار، ونحتفظ بالنتيجة فقط.',
    vf_send:'إرسال للتوثيق', vf_sent:'✅ تم إرسال الطلب. سنعلمك فور اتخاذ القرار.', vf_need_file:'أضف صورة واحدة على الأقل للوثيقة.',
    btn_create_alert:'🔔 إنشاء تنبيه',
    alert_title:'تنبيهات البريد الإلكتروني', alert_empty:'لا توجد تنبيهات. أنشئ واحدة من صفحة الإعلانات.',
    alert_new:'+ تنبيه جديد', alert_del:'حذف',
    alert_wilaya:'الولاية', alert_mode:'النوع', alert_type:'نوع العقار',
    alert_min_price:'الحد الأدنى للسعر (د.ج)', alert_max_price:'الحد الأقصى للسعر (د.ج)', alert_min_surf:'أدنى مساحة (م²)',
    alert_save:'حفظ التنبيه', alert_cancel:'إلغاء',
    alert_saved:'✅ تم إنشاء التنبيه! ستصلك إشعارات بالبريد الإلكتروني.', alert_max:'وصلت للحد الأقصى (5 تنبيهات).',
    alert_criteria:'المعايير:',
    agencies_title:'🏢 الوكالات العقارية',
    btn_back:'رجوع →',
    sort_label:'ترتيب', sort_date_desc:'الأحدث أولاً', sort_date_asc:'الأقدم أولاً',
    sort_price_asc:'السعر تصاعدي', sort_price_desc:'السعر تنازلي', sort_surface_desc:'أكبر مساحة',
    similar_title:'عقارات مشابهة', agency_detail_listings:'إعلانات الوكالة',
    cgu_title:'شروط الاستخدام',
    privacy_title:'سياسة الخصوصية', mentions_title:'الإشعارات القانونية',
    contact_title:'اتصل بنا', contact_sub:'فريقنا يرد خلال 24 ساعة عمل.',
    filter_wilaya:'الولاية', filter_mode:'النوع', filter_type:'نوع العقار',
    filter_price_min:'السعر الأدنى (د.ج)', filter_price_max:'السعر الأقصى (د.ج)', filter_rooms:'الغرف الدنيا',
    filter_surf_min:'أدنى مساحة (م²)', filter_no_limit:'بدون حد', opt_more:' فأكثر',
    filter_features:'التجهيزات :',
    filter_has_video:'فيديو', filter_has_tour:'جولة افتراضية',
    recently_viewed:'شوهدت مؤخراً',
    market_title:'توجهات السوق', market_sub:'متوسط السعر بالم² لكل ولاية (الإعلانات النشطة)',
    market_no_data:'لا توجد بيانات كافية.',
    trend_up:'↑ {n}%', trend_down:'↓ {n}%', trend_stable:'→ مستقر',
    share_search:'🔗 مشاركة', link_copied:'تم نسخ الرابط !',
    cgu_sub:'آخر تحديث: 1 يناير 2026',
    cgu_h1:'1. الموضوع', cgu_h2:'2. الوصول والتسجيل', cgu_h3:'3. نشر الإعلانات',
    cgu_h4:'4. المسؤولية', cgu_h5:'5. الملكية الفكرية',
    cgu_h6:'6. التعديل والإنهاء', cgu_h7:'7. القانون المطبق',
    cgu_p1:'تحكم شروط الاستخدام العامة هذه الوصول إلى منصة DzImmo واستخدامها، المتاحة على dzimmo.dz، والصادرة عن شركة EURL INGENICA CIVIL، شركة خاضعة للقانون الجزائري. بالوصول إلى المنصة، يقبل المستخدم هذه الشروط دون تحفظ.',
    cgu_p2:'يستلزم الوصول إلى خدمات DzImmo إنشاء حساب شخصي. يلتزم المستخدم بتقديم معلومات دقيقة والحفاظ على سرية بيانات الدخول الخاصة به. أي استخدام للحساب يقع تحت مسؤولية صاحبه.',
    cgu_p3:'يجوز للمستخدمين نشر إعلانات عقارية تحت مسؤوليتهم الكاملة. تحتفظ DzImmo بحق حذف أي إعلان يتعارض مع القوانين الجزائرية أو الآداب العامة أو هذه الشروط. يجب أن تُكتب الإعلانات باللغة العربية أو الفرنسية وأن تتعلق بعقارات واقعة على الأراضي الجزائرية.',
    cgu_p4:'DzImmo هي منصة وساطة وليست طرفًا في المعاملات بين المستخدمين. لا تضمن دقة الإعلانات ولا تتحمل المسؤولية عن الأضرار الناجمة عن المعاملات المبرمة بين المستخدمين.',
    cgu_p5:'جميع عناصر المنصة (العلامة التجارية، الشعار، الواجهة، الكود) محمية بموجب قانون الملكية الفكرية الجزائري. يُحظر أي نسخ، حتى جزئي، دون إذن كتابي مسبق من DzImmo.',
    cgu_p6:'تحتفظ DzImmo بحق تعديل هذه الشروط في أي وقت. سيتم إخطار المستخدمين عبر البريد الإلكتروني. يُعدّ الاستمرار في استخدام المنصة بعد الإخطار قبولًا للشروط الجديدة. يمكن للمستخدم إنهاء حسابه من مساحته الشخصية.',
    cgu_p7:'تخضع هذه الشروط للقانون الجزائري. يختص القضاء الجزائري حصريًا بالنظر في أي نزاع.',
    priv_sub:'آخر تحديث: 20 سبتمبر 2026',
    priv_h9:'9. الدخول عبر Google',
    priv_p9:'إذا اخترتَ «المتابعة عبر Google» فإن Google ترسل إلينا اسمك وعنوان بريدك الإلكتروني (الذي تحقق منه) وصورة ملفك الشخصي. لا نتلقى كلمة مرور Google الخاصة بك ولا نطّلع على جهات اتصالك أو على بياناتك الأخرى في Google. تعالج Google هذه المعلومات وفق سياسة الخصوصية الخاصة بها. وإذا كان هذا البريد مسجَّلاً لدينا من قبل دون تأكيد، فإن تأكيده من Google يتيح لنا ربطه بحسابك. يمكنك دائماً استعمال البريد الإلكتروني وكلمة المرور بدلاً من ذلك.',
    priv_h8:'8. توثيق المعلنين',
    priv_p8:'إذا طلبتَ توثيق حسابك فإنك ترسل إلينا وثيقة هوية (للأفراد) أو وثيقة مهنية (سجل تجاري، اعتماد). تُستعمل هذه الوثائق حصراً للتحقق من هوية المعلن أو نشاطه: لا يطّلع عليها إلا مشرفو DzImmo، وتُخزَّن بمعزل عن البيانات العلنية للموقع، وتُحذف فور اتخاذ القرار (قبولاً أو رفضاً). نحتفظ بالنتيجة فقط (حساب موثَّق أو غير موثَّق، التاريخ، رقم السجل التجاري أو الاعتماد بالنسبة للمهني، وسبب الرفض). هذا الإجراء اختياري ويقوم على موافقتك، ويمكنك في أي وقت طلب سحب التوثيق.',
    priv_h1:'1. البيانات المجمعة', priv_h2:'2. أغراض المعالجة',
    priv_h3:'3. الأساس القانوني', priv_h4:'4. مدة الاحتفاظ',
    priv_h5:'5. حقوق المستخدمين', priv_h6:'6. الأمان', priv_h7:'7. ملفات تعريف الارتباط',
    priv_p1:'تجمع DzImmo البيانات التالية عند التسجيل واستخدام المنصة: الاسم الكامل، البريد الإلكتروني، رقم الهاتف، بيانات التصفح (عنوان IP، الصفحات المزارة)، محتوى الإعلانات المنشورة والرسائل المتبادلة بين المستخدمين.',
    priv_p2:'تُعالج البيانات للأغراض التالية: إدارة حسابات المستخدمين، نشر الإعلانات والبحث عنها، التواصل بين الأطراف، إرسال الإشعارات المتعلقة بالإعلانات، تحسين الخدمات والامتثال للالتزامات القانونية.',
    priv_p3:'تستند المعالجة إلى تنفيذ العقد (الشروط العامة) المبرم مع المستخدم، والموافقة على الاتصالات التسويقية، والالتزامات القانونية المنبثقة عن القانون الجزائري 18-07 المتعلق بحماية الأشخاص الطبيعيين في معالجة البيانات الشخصية.',
    priv_p4:'تُحتفظ بالبيانات طوال فترة نشاط الحساب، ثم 3 سنوات بعد إغلاقه للأغراض القانونية والمحاسبية. تُحتفظ بالرسائل لمدة سنة واحدة بعد إرسالها.',
    priv_p5:'وفقًا للقانون 18-07، يحق لكل مستخدم الوصول إلى بياناته وتصحيحها وحذفها والاعتراض عليها ونقلها. تُمارَس هذه الحقوق بالتواصل مع DzImmo على العنوان: <strong>privacy@dzimmo.dz</strong>.',
    priv_p6:'تتخذ DzImmo التدابير التقنية والتنظيمية المناسبة لحماية البيانات من أي وصول غير مصرح به أو فقدان أو إفصاح: تشفير كلمات المرور (bcrypt)، اتصالات HTTPS، رموز JWT محدودة المدة.',
    priv_p7:'تستخدم المنصة فقط ملفات تعريف الارتباط الضرورية للتشغيل (الجلسة، تفضيلات اللغة، السمة). لا تُودَع أي ملفات تعريف إعلانية أو تتبعية من أطراف ثالثة.',
    ml_sub:'وفقًا للأحكام القانونية الجزائرية النافذة',
    ml_h1:'الناشر', ml_h2:'مدير النشر', ml_h3:'الاستضافة',
    ml_h4:'الملكية الفكرية', ml_h5:'القانون المطبق',
    ml_p1:'<strong>التسمية:</strong> EURL INGENICA CIVIL<br><strong>الشكل القانوني:</strong> مؤسسة ذات شخص وحيد وذات مسؤولية محدودة (EURL)، القانون الجزائري<br><strong>المقر الاجتماعي:</strong> 4 شارع صخر بن سلمان، 22000 سيدي بلعباس، الجزائر<br><strong>رأس المال:</strong> 50,000 د.ج<br><strong>السجل التجاري (CNRC):</strong> 22/00 - 0025204B26<br><strong>NIF:</strong> 002622002520464<br><strong>البريد الإلكتروني:</strong> contact@dzimmo.dz',
    ml_p2:'مدير النشر هو الممثل القانوني لشركة EURL INGENICA CIVIL.',
    ml_p3:'<strong>المضيف:</strong> OVH SAS (OVHcloud)<br><strong>العنوان:</strong> 2 rue Kellermann, 59100 Roubaix, France<br><strong>الموقع:</strong> ovhcloud.com',
    ml_p4:'جميع محتويات dzimmo.dz (نصوص، رسومات، شعار، أيقونات، كود مصدري) هي الملكية الحصرية لشركة EURL INGENICA CIVIL وتحظى بالحماية بموجب قوانين الملكية الفكرية الجزائرية. يُحظر أي نسخ دون إذن كتابي مسبق.',
    ml_p5:'يخضع هذا الموقع للقانون الجزائري. يختص القضاء الجزائري حصريًا بالنظر في أي نزاع يتعلق باستخدامه.',
    ct_card_email:'البريد الإلكتروني', ct_card_phone:'الهاتف', ct_card_addr:'العنوان', ct_card_city:'4 شارع صخر بن سلمان، 22000 سيدي بلعباس، الجزائر',
    ct_form_title:'إرسال رسالة',
    ct_lbl_name:'الاسم الكامل', ct_lbl_email:'البريد الإلكتروني', ct_lbl_subject:'الموضوع', ct_lbl_msg:'الرسالة',
    ct_ph_name:'اسمك الكامل', ct_ph_msg:'صِف طلبك...',
    ct_opt_info:'استفسار عام', ct_opt_annonce:'مشكلة مع إعلان',
    ct_opt_compte:'حسابي', ct_opt_partner:'شراكة / وكالة', ct_opt_autre:'أخرى',
    ct_btn_send:'إرسال الرسالة', ct_sent:'✅ تم إرسال رسالتك! سنرد عليك خلال 24 ساعة.', ct_failed:'تعذّر إرسال رسالتك.',
    ft_sim:'محاكياتنا', ft_sim_prix:'سعر المتر المربع', ft_sim_estim:'تقدير العقار',
    ft_sim_notaire:'رسوم التوثيق', ft_sim_credit:'محاكاة القرض',
    sp_title:'سعر المتر المربع', sp_sub:'احسب سعر المتر المربع أو السعر الإجمالي لعقارك.',
    sp_h1:'السعر الإجمالي → سعر/م²', sp_h2:'سعر/م² → السعر الإجمالي',
    sp_lbl_total:'السعر الإجمالي (د.ج)', sp_lbl_pm2:'سعر المتر المربع (د.ج)', sp_lbl_surf:'المساحة (م²)',
    sp_ph_total:'مثال: 15,000,000', sp_ph_pm2:'مثال: 150,000', sp_ph_surf:'مثال: 100',
    sp_btn:'احسب', sp_res_pm2:'للمتر المربع', sp_res_pour:'لـ',
    se_title:'تقدير العقار', se_sub:'احصل على نطاق سعري بناءً على إعلانات DzImmo الحقيقية.',
    se_lbl_type:'نوع العقار', se_lbl_wilaya:'الولاية', se_lbl_mode:'نوع العملية',
    se_res_range:'نطاق السعر/م²', se_res_min:'منخفض (25%)', se_res_mid:'متوسط', se_res_max:'مرتفع (75%)',
    se_est_total:'تقدير لـ',
    se_source_wilaya:'إعلان DzImmo في',
    se_source_national:'إعلان DzImmo (جميع الولايات)',
    se_no_data:'لا توجد إعلانات مماثلة. حاول تغيير الفلاتر.',
    se_need_mode:'⚠️ اختر نوع العملية (بيع أو إيجار) للحصول على تقدير دقيق.',
    se_disclaimer:'مبني على الإعلانات النشطة في DzImmo.',
    sn_title:'رسوم التوثيق', sn_sub:'قدّر رسوم شراء العقار في الجزائر.',
    se_lbl_rooms:'الغرف', se_rooms_all:'الكل',
    se_rooms_1:'ستوديو (F1)', se_rooms_2:'F2', se_rooms_3:'F3', se_rooms_4:'F4', se_rooms_5:'F5', se_rooms_6:'F6+',
    sn_lbl_price:'سعر الشراء (د.ج)', sn_lbl_zone:'نوع العقار',
    sn_ph_price:'مثال: 12,000,000',
    sn_urbain:'عقار حضري (رسم تسجيل 3%)', sn_rural:'عقار ريفي / زراعي (رسم تسجيل 2%)',
    sn_enreg:'رسم التسجيل', sn_pub:'رسم الشهر العقاري',
    sn_hon:'أتعاب الموثق', sn_divers:'رسوم متنوعة (طوابع، نسخ)',
    sn_total:'المجموع التقديري', sn_pct_label:'من سعر البيع',
    sn_disclaimer:'تقدير استرشادي. استشر موثقًا للحصول على حساب دقيق.',
    sn_legal_toggle:'📋 المرجعية القانونية',
    sn_legal_enreg_title:'رسم التسجيل',
    sn_legal_enreg_text:'<strong>الأمر رقم 76-105 المؤرخ في 9 ديسمبر 1976</strong> (قانون التسجيل)، المعدَّل بقوانين المالية المتعاقبة — المادة 35 وما يليها.<br>النسبة: <strong>3%</strong> للعقارات الحضرية (غير السكنية)؛ <strong>2%</strong> للعقارات الريفية والأراضي الزراعية.<br>الوعاء: سعر التنازل أو القيمة التجارية أيهما أكبر. تُدفع لمديرية الضرائب.',
    sn_legal_pub_title:'رسم الشهر العقاري',
    sn_legal_pub_text:'<strong>المرسوم التشريعي رقم 93-03 المؤرخ في 1 مارس 1993</strong> المتعلق بالمحافظة العقارية.<br>النسبة: <strong>1%</strong> من سعر التنازل. يُدفع للمحافظة العقارية لتسجيل العقد وإمكانية الاحتجاج به في مواجهة الغير.',
    sn_legal_hon_title:'أتعاب الموثق',
    sn_legal_hon_text:'<strong>المرسوم التنفيذي رقم 06-23 المؤرخ في 18 يناير 2006</strong> المتضمن تعريفة العقود التوثيقية. سلّم تنازلي مطبَّق على سعر التنازل:<br><table style="margin-top:.4rem;font-size:.78rem;width:100%;border-collapse:collapse"><tr><td style="padding:.25rem .5rem;border:1px solid var(--border)">≤ 500,000 د.ج</td><td style="padding:.25rem .5rem;border:1px solid var(--border);text-align:right;font-weight:700">3%</td></tr><tr><td style="padding:.25rem .5rem;border:1px solid var(--border)">500,001 → 2,000,000 د.ج</td><td style="padding:.25rem .5rem;border:1px solid var(--border);text-align:right;font-weight:700">2%</td></tr><tr><td style="padding:.25rem .5rem;border:1px solid var(--border)">2,000,001 → 10,000,000 د.ج</td><td style="padding:.25rem .5rem;border:1px solid var(--border);text-align:right;font-weight:700">1%</td></tr><tr><td style="padding:.25rem .5rem;border:1px solid var(--border)">&gt; 10,000,000 د.ج</td><td style="padding:.25rem .5rem;border:1px solid var(--border);text-align:right;font-weight:700">0.5%</td></tr></table>',
    sn_legal_divers_title:'الرسوم المتنوعة',
    sn_legal_divers_text:'<strong>قانون الطابع الجبائي</strong> (الأمر رقم 76-104 المؤرخ في 9 ديسمبر 1976). يشمل: طوابع العقد، النسخ التنفيذية، رسوم التسجيل والملف.<br>مبلغ جزافي استرشادي: <strong>~15,000 د.ج</strong>.',
    sc_title:'محاكاة القرض', sc_sub:'احسب أقساطك الشهرية والتكلفة الإجمالية لقرضك.',
    sc_lbl_montant:'مبلغ القرض (د.ج)', sc_lbl_duree:'المدة (سنوات)', sc_lbl_taux:'الفائدة السنوية (%)',
    sc_ph_montant:'مثال: 8,000,000',
    sc_res_mensualite:'القسط الشهري', sc_res_par_mois:'في الشهر',
    sc_montant_emprunte:'مبلغ القرض', sc_interets:'إجمالي الفوائد', sc_total:'التكلفة الإجمالية',
    sc_disclaimer:'محاكاة استرشادية. تواصل مع بنكك للحصول على عرض شخصي.',
    ft_sim_rent:'مردودية الإيجار',
    sr_title:'مردودية الإيجار', sr_sub:'احسب صافي المردودية والتدفق النقدي لاستثمارك العقاري.',
    sr_sec_achat:'🏠 الاقتناء', sr_sec_revenus:'💰 الدخل والمصاريف',
    sr_lbl_prix:'سعر الشراء (د.ج) *', sr_lbl_frais:'رسوم الاقتناء (%)',
    sr_lbl_credit:'قسط القرض الشهري (د.ج)', sr_lbl_loyer:'الإيجار الشهري (د.ج) *',
    sr_lbl_charges:'المصاريف السنوية (د.ج)', sr_lbl_vacance:'نسبة الشغور (%)',
    sr_cout_total:'التكلفة الإجمالية للاقتناء', sr_loyer_brut:'الإيجار السنوي الإجمالي',
    sr_rdt_brut:'المردودية الإجمالية', sr_rdt_net:'المردودية الصافية',
    sr_revenu_net:'الدخل الإيجاري الصافي / سنة', sr_cashflow:'التدفق النقدي الشهري الصافي',
    sr_recuperation:'مدة استرداد رأس المال',
    sr_note_excellent:'استثمار ممتاز', sr_note_bon:'استثمار جيد',
    sr_note_moyen:'استثمار متوسط', sr_note_faible:'مردودية ضعيفة',
    sr_disclaimer:'محاكاة استرشادية. استشر مستشاراً لتحليل شخصي.',
    pub_photos_req:'مطلوبة صورة واحدة على الأقل قبل النشر.',
    imp_btn:'📥 استيراد بملف CSV', imp_dl_tpl:'📄 تحميل نموذج CSV',
    imp_result_ok:'{n} إعلان مُرسَل للمراجعة.', imp_result_err:'{e} خطأ.',
    pwa_install:'📲 تثبيت التطبيق',
    map_zone_mode:'📍 منطقة', map_zone_exit:'✕ منطقة', map_zone_hint:'انقر على الخريطة للبحث حول هذه النقطة.',
    map_zone_radius:'نطاق (كم)', map_zone_results:'{n} عقار في نطاق {r} كم',
    map_draw_mode:'✏️ رسم', map_draw_exit:'✕ رسم', map_draw_hint:'انقر لوضع نقاط المنطقة، ثم اضغط «إنهاء» (أو انقر على النقطة الأولى).',
    map_draw_finish:'✔ إنهاء', map_draw_undo:'↶ إلغاء آخر نقطة', map_draw_clear:'🗑 مسح',
    map_draw_min:'ضع 3 نقاط على الأقل لتحديد منطقة.', map_draw_max:'المنطقة معقّدة جدًا: 60 نقطة كحد أقصى.',
    map_zone_results_poly:'{n} عقار في المنطقة المرسومة', map_truncated:'منطقة مزدحمة جدًا: يتم عرض {n} عقار فقط، ضيّق البحث.',
    map_me_btn:'🎯 حولي', map_me_locating:'⏳ جارٍ التحديد…', map_me_denied:'تعذّر الوصول إلى موقعك.', map_me_here:'أنت هنا (موقع تقريبي)',
    dash_stats_btn:'📈 30ي', dash_stats_title:'الإحصائيات · آخر 30 يوماً',
    featured_badge:'⭐ مميز', featured_title:'⭐ إعلانات مميزة', u_day_one:'يوم', u_day_two:'يومان', u_day_many:'أيام',
    dash_feature_btn:'⭐ إبراز الإعلان', dash_featured_until:'⭐ مميز حتى {date}',
    pr_title:'إبراز إعلانك', pr_intro:'يظهر إعلانك في أعلى الصفحة الرئيسية وصفحة الإعلانات طوال المدة المختارة.',
    pr_extend_note:'إذا كان الإعلان مميزاً بالفعل، تُضاف المدة إلى نهاية الفترة الحالية.', pr_test_note:'وضع تجريبي: لا يُخصم أي مبلغ.',
    pr_pay:'الدفع والإبراز', pr_closed:'الإبراز غير متاح حالياً.', pr_choose:'اختر صيغة.', pr_done:'إعلانك مميز حتى {date}.',
    st_views:'المشاهدات', st_favs:'المفضّلة', st_clicks:'النقرات', st_calls:'المكالمات', st_wa:'واتساب', st_contacts:'الطلبات', st_conversion:'معدل التواصل',
    st_favs_total:'{n} في المجموع', st_no_data:'لا توجد زيارات بعد خلال هذه الفترة.', st_advice:'نصائح', st_advice_tip:'نصائح محسوبة انطلاقاً من إحصائيات هذا الإعلان.',
    st_export_csv:'⬇ تصدير CSV',
    dash_edit:'✏️ تعديل', pub_edit_heading:'✏️ تعديل الإعلان', pub_edit_submit:'حفظ التعديلات',
    pub_edit_locked:'لا يمكن تغيير نمط الإعلان ونوع العقار والولاية: انشر إعلاناً جديداً لتغييرها.',
    pub_edit_saved:'تم حفظ التعديلات.', pub_edit_pending:'تم حفظ التعديلات. سيخضع الإعلان للمراجعة من جديد قبل ظهوره على الموقع.',
    price_drop_badge:'📉 انخفض السعر',
    adv_price_high:'سعر المتر المربع لديك أعلى بنحو {pct}% من وسيط الإعلانات المماثلة: مراجعته قد تعيد الزيارات.',
    adv_few_photos:'إعلانك يضم {n} صورة فقط: احرص على {min} صور على الأقل. الإعلانات المصوَّرة جيداً تتلقى طلبات أكثر.',
    adv_no_phone:'لم يتم إدخال رقم هاتف: لن يظهر زرّا «اتصال» و«واتساب» في إعلانك. أضِفه في ملفك الشخصي.',
    adv_no_engagement:'{views} مشاهدة خلال 30 يوماً دون أي مفضّلة أو نقرة أو طلب: راجع السعر والصورة الأولى والوصف.',
    adv_views_drop:'انخفضت المشاهدات بنحو {pct}% مقارنة بالأسبوع السابق: حدّث الإعلان (الصور، السعر) أو أكّد أنه «لا يزال متاحاً».',
    adv_low_visibility:'{n} مشاهدة فقط خلال آخر 7 أيام: اعتنِ بالعنوان (نوع العقار، الحي) وبالصورة الأولى.',
    adv_short_description:'وصفك لا يتجاوز {n} حرفاً: فصّل حالة العقار ومحيطه ومرافقه ({min} حرفاً على الأقل).',
    adv_no_location:'لا يوجد موقع على الخريطة: أدخل العنوان ليظهر العقار في البحث على الخريطة.',
    adv_no_media:'أضف فيديو أو جولة افتراضية (YouTube أو Vimeo أو Matterport أو Kuula): فهي تطمئن الزوّار.',
    adv_no_features:'لم تُذكر أي تجهيزات (موقف سيارات، مصعد، شرفة…): حدّد ما يتوفر في عقارك، فهي تُستعمل في التصفية.',
    adv_no_floor:'الطابق غير مُدرج: كثير من المشترين والمستأجرين يبحثون بالطابق في الشقق والمكاتب.',
    adv_low_conversion:'طلب {contacts} فقط من أصل {views} مشاهدة في 30 يوماً (أقل من 2٪): أثروا الوصف وأضيفوا المزايا وتأكدوا من تنافسية السعر.',
    adv_all_good:'إعلانك مكتمل ويثير الاهتمام. أكّده بانتظام ليبقى في مرتبة جيدة.',
    responsive_badge:'⚡ متجاوب',
    pub_estimate_loading:'جارٍ حساب التقدير…',
    pub_estimate_hint:'إعلانات مشابهة: نطاق <b>{low}</b> – <b>{high}</b> دج (الوسيط {median})',
    pub_estimate_per_m2:'{per_m2} دج/م² وسيطاً',
    pub_estimate_none:'لا توجد إعلانات مشابهة كافية للتقدير.',
    fav_share_btn:'🔗 مشاركة مفضلتي',
    fav_share_copied:'تم نسخ الرابط!',
    fav_share_revoke:'إلغاء الرابط',
    fav_share_revoked:'تم إلغاء الرابط.',
    fav_shared_title:'مفضلة مشتركة',
    fav_share_intro:'شارك هذا الرابط ليطّلع أقاربك على اختياراتك دون إنشاء حساب.',
    mkt_title:'اتجاهات السوق',
    mkt_wilaya:'الولاية',
    mkt_med:'السعر الوسيط/م²',
    mkt_count:'الإعلانات',
    mkt_trend:'الاتجاه',
    mkt_up:'↑ ارتفاع',
    mkt_down:'↓ انخفاض',
    mkt_stable:'→ مستقر',
    mkt_no_data:'بيانات غير كافية.',
    mkt_filter_mode:'الوضع',
    mkt_filter_type:'النوع',
    mkt_filter_all:'الكل',
    audit_title:'سجل التدقيق',
    audit_date:'التاريخ',
    audit_admin:'المشرف',
    audit_action:'الإجراء',
    audit_target:'الهدف',
    audit_details:'التفاصيل',
    pass_weak:'ضعيفة',
    pass_fair:'متوسطة',
    pass_good:'جيدة',
    pass_strong:'قوية',
    trust_title:'موثوقية المُعلِن', trust_low:'ملف ناشئ', trust_mid:'ملف راسخ', trust_high:'مُعلِن موثوق',
    evol_title:'التطور خلال', evol_days:'يوماً', evol_users:'تسجيلات', evol_listings:'إعلانات منشورة', evol_views:'مشاهدات', evol_contacts:'طلبات',
    prof_export:'تنزيل بياناتي (RGPD)',
    push_ask:'تفعيل الإشعارات الفورية لا تفوّت شيئاً؟', push_yes:'نعم', push_skip:'لاحقاً',
    push_on:'🔔 الإشعارات مفعّلة', push_off:'🔕 الإشعارات معطّلة',
    dash_tab_calendrier:'تقويم الزيارات',
    cal_title:'📅 تقويم الزيارات', cal_none:'لا توجد زيارات مؤكدة قادمة.',
    calc_title:'🏦 محاكي الائتمان', calc_amount:'سعر العقار (دج)', calc_apport:'الحصة الشخصية (دج)',
    calc_duration:'المدة (سنوات)', calc_rate:'معدل الفائدة السنوي (%)', calc_btn:'حساب',
    calc_loan:'المبلغ المقترض', calc_monthly:'القسط الشهري التقديري', calc_total_interest:'تكلفة الائتمان', calc_total:'إجمالي المبلغ المستحق',
    calc_disclaimer:'محاكاة تقريبية. الشروط الفعلية تعتمد على بنكك.',
    est_title:'🔍 تقدير السعر', est_intro:'نطاق السعر بناءً على الإعلانات المشابهة النشطة.',
    est_surface:'المساحة (م²)', est_btn:'تقدير',
    est_low:'الحد الأدنى', est_mid:'التقدير المتوسط', est_high:'الحد الأعلى',
    est_pm2:'سعر/م²',
    est_scope_wilaya:'المصدر: إعلانات الولاية.', est_scope_national:'المصدر: إعلانات وطنية (بيانات الولاية غير كافية).',
    est_no_data:'إعلانات مقارنة غير كافية. وسّع المعايير.',
    est_count:'{n} إعلان مقارن',
    share_native:'📤 مشاركة',
    vd_member_since:'عضو منذ', vd_listings:'إعلانات نشطة', vd_profile:'عرض ملف البائع',
    vd_see_listings:'عرض إعلاناته', vd_no_listings:'لا توجد إعلانات نشطة.',
    src_title:'استعلامات البحث (آخر 30 يوماً)', src_top:'الأكثر بحثاً',
    src_daily:'الحجم اليومي', src_count:'بحث', src_no_data:'لا توجد عمليات بحث مسجَّلة.',
    src_avg:'متوسط النتائج',
    fav_note_ph:'ملاحظة خاصة (500 حرف كحد أقصى)…', fav_note_save:'حفظ', fav_note_saved:'✅ تم حفظ الملاحظة.',
    fav_note_del:'حذف الملاحظة',
  }
};

function T(key) { return (TRANSLATIONS[currentLang] || TRANSLATIONS.fr)[key] || TRANSLATIONS.fr[key] || key; }

// reload = false au démarrage : init() charge alors la page une seule fois (sinon l'accueil appelait deux fois l'API)
function applyLang(lang, reload = true) {
  currentLang = lang;
  localStorage.setItem('dz_lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  if ([TRANSLATIONS.fr.site_title, TRANSLATIONS.ar.site_title].includes(document.title)) document.title = T('site_title');
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const attr = el.getAttribute('data-i18n-attr');
    if (attr) el.setAttribute(attr, T(key));
    else el.textContent = T(key);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = T(el.getAttribute('data-i18n-html'));
  });
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  renderGoogleButtons();
  rebuildSelects();
  if (!reload) { /* démarrage */ }
  else if (currentPage === 'home') { loadHomeProperties(); loadHomePros(); }
  else if (currentPage === 'annonces') loadAnnonces();
  else if (currentPage === 'stats') loadStatsPage();
  else if (currentPage === 'contrats' && window.MC) MC.refresh();
  else if (currentPage === 'detail' && window._detailProp) renderDetail(window._detailProp);
  else if (currentPage === 'agences') loadAgences();
  else if (currentPage === 'agency-detail' && window._agencyId) loadAgencyDetail(window._agencyId);
  else if (currentPage === 'programmes') loadProgrammes();
  else if (currentPage === 'programme-detail' && window._programmeId) loadProgrammeDetail(window._programmeId);
  else if (currentPage === 'carte' && mapInstance) loadMapMarkers();
  else if (currentPage === 'dashboard' && currentUser) loadDashboard();
  relabelSeo();
  syncLangUrl();
}

function rebuildSelects() {
  const typeOpts = [
    ['','s_all_types'],['appartement','s_appart'],['villa','s_villa'],['maison','s_maison'],
    ['bureau','s_bureau'],['local_commercial','s_local'],['terrain','s_terrain'],
    ['ferme','s_ferme'],['entrepot','s_entrepot']
  ];
  const modeOpts = [
    ['','s_all_modes'],['vente','s_vente'],['location_longue','s_loc_longue'],['location_courte','s_loc_courte']
  ];
  ['s-type','pub-type','f-type'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    const opts = id === 's-type' || id === 'f-type' ? typeOpts : typeOpts;
    el.innerHTML = opts.map(([v,k]) => `<option value="${v}">${T(k)}</option>`).join('');
    el.value = cur;
  });
  ['s-mode','pub-mode','f-mode'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = modeOpts.map(([v,k]) => `<option value="${v}">${T(k)}</option>`).join('');
    el.value = cur;
  });
  ['s-wilaya','pub-wilaya','f-wilaya','se-wilaya','map-wilaya','ag-wilaya','pg-wilaya'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    const first = id.startsWith('pub') ? T('pub_choose') : T('s_all_wilayas');
    el.innerHTML = `<option value="">${first}</option>` +
      WILAYAS.map(w => `<option value="${w}">${wilayaName(w)}</option>`).join('');
    el.value = cur;
  });
  // Fourchettes « minimum » : unité et « et plus » traduits (« 30 m²+ » / « 30 م² فأكثر », « 3+ » / « 3 فأكثر »)
  document.querySelectorAll('#f-min-surface option:not([value=""])').forEach(o => { o.textContent = o.value + ' ' + T('u_m2') + T('opt_more'); });
  document.querySelectorAll('#f-rooms option:not([value=""])').forEach(o => { o.textContent = o.value + T('opt_more'); });
  // Fourchettes de prix : séparateurs insécables (formatPrice). Avec de simples espaces, l'écriture de droite
  // à gauche inverse les groupes de chiffres : « 50 000 000 » s'affichait « 000 000 50 » en arabe.
  document.querySelectorAll('#f-min-price option:not([value=""]), #f-max-price option:not([value=""])')
    .forEach(o => { o.textContent = formatPrice(o.value); });
  // Labels des boutons de filtre équipements (traduits selon la langue courante)
  document.querySelectorAll('.f-feat-btn[data-v]').forEach(b => { b.textContent = T('feat_' + b.dataset.v); });
}

// ── Wilayas d'Algérie — 69 wilayas (loi n°26-06 du 4 avril 2026)
const WILAYAS = [
  'Adrar','Chlef','Laghouat','Oum El Bouaghi','Batna','Béjaïa','Biskra','Béchar',
  'Blida','Bouira','Tamanrasset','Tébessa','Tlemcen','Tiaret','Tizi Ouzou','Alger',
  'Djelfa','Jijel','Sétif','Saïda','Skikda','Sidi Bel Abbès','Annaba','Guelma',
  'Constantine','Médéa','Mostaganem','M\'Sila','Mascara','Ouargla','Oran','El Bayadh',
  'Illizi','Bordj Bou Arreridj','Boumerdès','El Tarf','Tindouf','Tissemsilt',
  'El Oued','Khenchela','Souk Ahras','Tipaza','Mila','Aïn Defla','Naâma',
  'Aïn Témouchent','Ghardaïa','Relizane','Timimoun','Bordj Badji Mokhtar',
  'Ouled Djellal','Béni Abbès','In Salah','In Guezzam','Touggourt','Djanet',
  'El M\'Ghair','El Menia',
  // Nouvelles wilayas — codes 59-69 (loi n°26-06 du 4 avril 2026)
  'Aflou','Barika','El Kantara','Bir El Ater','El Aricha','Ksar Chellala',
  'Aïn Ouessara','Messaad','Ksar El Boukhari','Bou Saâda','El Abiodh Sidi Cheikh'
];

// Noms arabes des 69 wilayas (la valeur de référence reste le nom français ci-dessus)
const WILAYAS_AR = {
  'Adrar':'أدرار', 'Chlef':'الشلف', 'Laghouat':'الأغواط', 'Oum El Bouaghi':'أم البواقي', 'Batna':'باتنة',
  'Béjaïa':'بجاية', 'Biskra':'بسكرة', 'Béchar':'بشار', 'Blida':'البليدة', 'Bouira':'البويرة',
  'Tamanrasset':'تمنراست', 'Tébessa':'تبسة', 'Tlemcen':'تلمسان', 'Tiaret':'تيارت', 'Tizi Ouzou':'تيزي وزو',
  'Alger':'الجزائر العاصمة', 'Djelfa':'الجلفة', 'Jijel':'جيجل', 'Sétif':'سطيف', 'Saïda':'سعيدة',
  'Skikda':'سكيكدة', 'Sidi Bel Abbès':'سيدي بلعباس', 'Annaba':'عنابة', 'Guelma':'قالمة', 'Constantine':'قسنطينة',
  'Médéa':'المدية', 'Mostaganem':'مستغانم', "M'Sila":'المسيلة', 'Mascara':'معسكر', 'Ouargla':'ورقلة',
  'Oran':'وهران', 'El Bayadh':'البيض', 'Illizi':'إليزي', 'Bordj Bou Arreridj':'برج بوعريريج', 'Boumerdès':'بومرداس',
  'El Tarf':'الطارف', 'Tindouf':'تندوف', 'Tissemsilt':'تيسمسيلت', 'El Oued':'الوادي', 'Khenchela':'خنشلة',
  'Souk Ahras':'سوق أهراس', 'Tipaza':'تيبازة', 'Mila':'ميلة', 'Aïn Defla':'عين الدفلى', 'Naâma':'النعامة',
  'Aïn Témouchent':'عين تموشنت', 'Ghardaïa':'غرداية', 'Relizane':'غليزان', 'Timimoun':'تيميمون',
  'Bordj Badji Mokhtar':'برج باجي مختار', 'Ouled Djellal':'أولاد جلال', 'Béni Abbès':'بني عباس', 'In Salah':'عين صالح',
  'In Guezzam':'عين قزام', 'Touggourt':'تقرت', 'Djanet':'جانت', "El M'Ghair":'المغير', 'El Menia':'المنيعة',
  'Aflou':'أفلو', 'Barika':'بريكة', 'El Kantara':'القنطرة', 'Bir El Ater':'بئر العاتر', 'El Aricha':'العريشة',
  'Ksar Chellala':'قصر الشلالة', 'Aïn Ouessara':'عين وسارة', 'Messaad':'مسعد', 'Ksar El Boukhari':'قصر البخاري',
  'Bou Saâda':'بوسعادة', 'El Abiodh Sidi Cheikh':'الأبيض سيدي الشيخ',
};
// Nom de wilaya à afficher dans la langue courante (les valeurs de formulaire / d'URL restent en français)
const wilayaName = w => (currentLang === 'ar' && WILAYAS_AR[w]) || w;

// Libellés traduits (FR / AR) : la clé de traduction est lue à chaque accès, donc à jour après un changement de langue
const i18nMap = keys => new Proxy(keys, { get: (m, k) => (Object.hasOwn(m, k) ? T(m[k]) : undefined) });
const MODES = i18nMap({ vente:'s_vente', location_longue:'s_loc_longue', location_courte:'s_loc_courte' });
const TYPES = i18nMap({ appartement:'s_appart', villa:'s_villa', maison:'s_maison', bureau:'s_bureau',
  local_commercial:'s_local', terrain:'s_terrain', ferme:'s_ferme', entrepot:'s_entrepot' });
const FEATURES = i18nMap(Object.fromEntries(['meuble','parking','balcon','terrasse','ascenseur','gardien','piscine',
  'climatisation','chauffage','wifi','cave','jardin','alarme','interphone','eau','electricite','gaz','route','fibre']
  .map(k => [k, 'feat_' + k])));
// Prix avec unité traduite : « 75 000 DZD/mois » / « 75 000 د.ج/شهر »
const priceText = p => formatPrice(p.price) + ' ' + T('u_dzd') + (p.mode === 'vente' ? '' : T('u_month'));
const capFirst = str => str.charAt(0).toUpperCase() + str.slice(1);
// Mot au bon nombre : unit(3, 'u_room') -> « pièces » / « غرف » ; l'arabe a un duel (2) et repasse au singulier dès 11
function unit(n, base) {
  n = Number(n) || 0;
  if (currentLang !== 'ar') return T(base + (n > 1 ? '_many' : '_one'));
  const m = n % 100;
  return T(base + (n === 1 ? '_one' : n === 2 ? '_two' : (m >= 3 && m <= 10) ? '_many' : '_one'));
}

// ── Thème sombre / clair ─────────────────────────────
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('dzimmo_theme', t);
  document.querySelectorAll('.theme-btn').forEach(b => { b.textContent = t === 'dark' ? '☀️' : '🌙'; });
  renderGoogleButtons();
}

// ── Menu mobile ──────────────────────────────────────
function toggleMenu(force) {
  const menu = document.getElementById('mobile-menu'), btn = document.getElementById('menu-btn');
  const open = force === undefined ? !menu.classList.contains('open') : !!force;
  menu.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? '✕' : '☰';
}
// Se referme : clic ailleurs, touche Échap, agrandissement de la fenêtre au-delà du mode mobile
document.addEventListener('click', e => {
  if (!e.target.closest('#mobile-menu, #menu-btn')) toggleMenu(false);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleMenu(false); });
window.matchMedia('(max-width: 768px)').addEventListener('change', e => { if (!e.matches) toggleMenu(false); });
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme')
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

// ── Initialisation ─────────────────────────────────
async function init() {
  const savedTheme = localStorage.getItem('dzimmo_theme');
  if (savedTheme) applyTheme(savedTheme);
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme('dark');

  populateWilayas();
  initGoogle();
  document.getElementById('f-wilaya').addEventListener('change', () => setCommune(null));   // la commune appartient à une wilaya
  if (token) await loadCurrentUser();
  loadHomeProperties();
  loadHomePros();

  const params = new URLSearchParams(location.search);
  if (params.get('verify') === 'ok') toast('✅ Email vérifié. Bienvenue !');
  const landing = parseLandingPath(routePath());
  if (landing) {
    document.getElementById('f-mode').value   = landing.mode;
    document.getElementById('f-type').value   = landing.type;
    document.getElementById('f-wilaya').value = landing.wilaya;
    showPage('annonces');
    setCommune(landing.commune, document.querySelector('#seo-landing [data-seo-k]')?.dataset.seoK);   // libellé exact rendu par le serveur
    loadAnnonces(1);
  }
  // Annuaires et fiches de la vitrine : /agences, /promoteurs, /programmes, /agence/12-nom, /promoteur/7-nom, /programme/5-nom
  const path = routePath();
  const proMatch = path.match(/^\/(?:agence|promoteur)\/(\d+)/), progMatch = path.match(/^\/programme\/(\d+)/);
  if (path === '/agences' || path === '/promoteurs') { _pro.kind = path === '/promoteurs' ? 'promoteur' : ''; showPage('agences'); }
  else if (path === '/programmes') showPage('programmes');
  else if (proMatch)  showPage('agency-detail', Number(proMatch[1]));
  else if (progMatch) showPage('programme-detail', Number(progMatch[1]));
  else if (path === '/newsletter/confirmation' || path === '/newsletter/desinscription')
    showNewsletterLink(path === '/newsletter/confirmation' ? 'confirm' : 'unsub', params);
  const sharedFavMatch = path.match(/^\/favoris-partages\/([0-9a-f]{64})$/);
  if (sharedFavMatch) showPage('favoris-partages', sharedFavMatch[1]);
  const vendeurMatch = path.match(/^\/vendeur\/(\d+)$/);
  if (vendeurMatch) showPage('vendeur', Number(vendeurMatch[1]));
  const annonceMatch = routePath().match(/^\/annonce\/(\d+)/);
  // Lien de l'email de rappel (?renew=jeton) : mémorisé avant que la fiche ne réécrive l'adresse
  if (annonceMatch && params.get('renew')) { window._renewToken = params.get('renew'); window._renewFor = Number(annonceMatch[1]); }
  if (annonceMatch)                  showPage('detail', Number(annonceMatch[1]));
  else if (params.get('p'))          showPage('detail', Number(params.get('p')));
  if (window.location.hash.includes('reset_token=')) openModal('login');
  if (navigator.serviceWorker) navigator.serviceWorker.register('/sw.js');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); _pwaPrompt = e;
    document.getElementById('pwa-install-btn')?.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    _pwaPrompt = null;
    document.getElementById('pwa-install-btn')?.classList.add('hidden');
  });

  // Restaurer une recherche filtrée partagée par URL
  if (params.get('page') === 'annonces') {
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    set('f-wilaya',      params.get('f-wilaya'));
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(params.get('f-commune') || '')) setCommune(params.get('f-commune'));
    set('f-mode',        params.get('f-mode'));
    set('f-type',        params.get('f-type'));
    set('f-min-price',   params.get('f-min-price'));
    set('f-max-price',   params.get('f-max-price'));
    set('f-rooms',       params.get('f-rooms'));
    set('f-min-surface', params.get('f-min-surface'));
    set('f-q',           params.get('f-q'));
    set('f-sort',        params.get('f-sort'));
    const featsParam = params.get('f-features');
    if (featsParam) {
      const feats = featsParam.split(',');
      document.querySelectorAll('.f-feat-btn[data-v]').forEach(b => {
        if (feats.includes(b.dataset.v)) b.classList.add('active');
      });
    }
    if (params.get('f-has-video') === '1') document.getElementById('f-has-video')?.classList.add('active');
    if (params.get('f-has-tour')  === '1') document.getElementById('f-has-tour')?.classList.add('active');
    showPage('annonces');
    loadAnnonces(Number(params.get('p')) || 1);
  }
  initPublishScore();
  initEstimate();
  initSuggest();
}

// Les listes de wilayas sont construites (et retraduites) par rebuildSelects()
function populateWilayas() {
  rebuildSelects();
}

// ── Auth ─────────────────────────────────────────
async function loadCurrentUser() {
  try {
    const r = await api('/auth/me');
    currentUser = r;
    document.getElementById('auth-btns').classList.add('hidden');
    document.getElementById('user-btns').classList.remove('hidden');
    document.getElementById('menu-register').classList.add('hidden');
    const btn = document.getElementById('avatar-btn');
    btn.textContent = (r.name || '?')[0].toUpperCase();
    if (r.is_admin) document.querySelectorAll('.nav-admin').forEach(l => l.classList.remove('hidden'));
    setupWs();
    loadUnreadCount();
    loadNotifsFromStorage();
    updateNotifBadge();
    registerPush();
  } catch { token = null; localStorage.removeItem('dzimmo_token'); }
}

// ── Connexion avec Google ────────────────────────────
// Le bouton n'apparaît que si le serveur a un GOOGLE_CLIENT_ID (GET /api/auth/config). Google renvoie un jeton d'identité
// signé, que le serveur vérifie (POST /api/auth/google) avant de créer ou de retrouver le compte.
let googleReady = false;

function loadGoogleScript() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.defer = true;
    sc.onload = resolve; sc.onerror = reject;
    document.head.appendChild(sc);
  });
}

async function initGoogle() {
  try {
    const cfg = await api('/auth/config');
    if (!cfg.google_client_id) return;
    await loadGoogleScript();
    google.accounts.id.initialize({ client_id: cfg.google_client_id, callback: onGoogleCredential, ux_mode: 'popup', cancel_on_tap_outside: true });
    googleReady = true;
    document.querySelectorAll('[data-google]').forEach(w => w.classList.remove('hidden'));
    renderGoogleButtons();
  } catch { /* Google injoignable (réseau, bloqueur de publicité) : email et mot de passe restent disponibles */ }
}

// Dessine le bouton officiel à la largeur de la fenêtre ouverte (0 tant qu'elle est fermée : rendu à l'ouverture)
function renderGoogleButtons() {
  if (!googleReady) return;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  for (const [id, text] of [['g-btn-login', 'signin_with'], ['g-btn-register', 'signup_with']]) {
    const el = document.getElementById(id);
    const width = el ? Math.round(el.getBoundingClientRect().width) : 0;
    if (width < 200) continue;
    el.innerHTML = '';
    google.accounts.id.renderButton(el, { type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', text,
      shape: 'rectangular', logo_alignment: 'left', width: Math.min(400, width), locale: currentLang });
  }
}

async function onGoogleCredential(resp) {
  const errId = document.getElementById('modal-register').classList.contains('hidden') ? 'login-error' : 'register-error';
  try {
    const r = await api('/auth/google', 'POST', { credential: resp.credential });
    if (r.mfa_required) { closeModal('register'); openModal('login'); showMfaStep(r.mfa_token); return; }
    token = r.token; localStorage.setItem('dzimmo_token', token);
    currentUser = r.user;
    closeModal('login'); closeModal('register');
    await loadCurrentUser();
    toast(T(r.created ? 'g_created' : 'g_connected').replace('{name}', r.user.name));
  } catch (e) { showError(errId, e.message); }
}

// Liens des conditions et de la confidentialité, sous le bouton d'inscription
function goLegal(a) {
  closeModal('login'); closeModal('register');
  showPage(a.dataset.p);
  return false;
}

async function doLogin() {
  const email = document.getElementById('login-email').value;
  const pass  = document.getElementById('login-pass').value;
  try {
    const r = await api('/auth/login', 'POST', { email, password: pass });
    if (r.mfa_required) { showMfaStep(r.mfa_token); return; }   // mot de passe juste, mais la double authentification reste à passer
    token = r.token; localStorage.setItem('dzimmo_token', token);
    currentUser = r.user;
    closeModal('login');
    await loadCurrentUser();
    toast('✅ Connecté en tant que ' + r.user.name);
  } catch (e) { showError('login-error', e.message); }
}

// ── Double authentification : seconde étape de la connexion ──
// Le jeton de défi (5 min) ne vit qu'en mémoire : il n'ouvre aucune route, seul POST /api/auth/2fa/login l'accepte avec un code.
let _mfaToken = null;

function showMfaStep(mfaToken) {
  _mfaToken = mfaToken;
  document.getElementById('login-step1').classList.add('hidden');
  document.getElementById('login-step2').classList.remove('hidden');
  document.getElementById('login-mfa-error').classList.add('hidden');
  const input = document.getElementById('login-code');
  input.value = ''; input.focus();
}

function resetMfaStep() {
  _mfaToken = null;
  document.getElementById('login-step1')?.classList.remove('hidden');
  document.getElementById('login-step2')?.classList.add('hidden');
  const input = document.getElementById('login-code');
  if (input) input.value = '';
  document.getElementById('login-mfa-error')?.classList.add('hidden');
}

function mfaBack() { resetMfaStep(); return false; }

async function doMfaLogin() {
  const code = document.getElementById('login-code').value.trim();
  if (!code) { showError('login-mfa-error', T('mfa_need_code')); return; }
  try {
    const r = await api('/auth/2fa/login', 'POST', { mfa_token: _mfaToken, code });
    token = r.token; localStorage.setItem('dzimmo_token', token);
    currentUser = r.user;
    closeModal('login');
    await loadCurrentUser();
    toast('✅ Connecté en tant que ' + r.user.name);
    if (r.recovery_left !== undefined && r.recovery_left <= 3)   // un code de secours vient d'être consommé
      toast(T('mfa_recovery_low').replace('{n}', r.recovery_left), 6000);
  } catch (e) { showError('login-mfa-error', e.message); }
}

function passStrength(p) {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^a-zA-Z0-9]/.test(p)) s++;
  return Math.min(s, 4);
}

function updatePassMeter(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!val) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const n = passStrength(val);
  const labels = [T('pass_weak'), T('pass_weak'), T('pass_fair'), T('pass_good'), T('pass_strong')];
  const colors = ['#dc2626','#dc2626','#d97706','#16a34a','#0C6E4F'];
  el.innerHTML = `<div style="display:flex;gap:.3rem;align-items:center;margin-top:.3rem">
    ${[1,2,3,4].map(i => `<div style="height:4px;flex:1;border-radius:2px;background:${i<=n?colors[n]:'var(--border)'}"></div>`).join('')}
    <span style="font-size:.75rem;color:${colors[n]};min-width:4rem;margin-inline-start:.35rem">${labels[n]}</span>
  </div>`;
}

async function doRegister() {
  const name  = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const phone = document.getElementById('reg-phone').value;
  const pass  = document.getElementById('reg-pass').value;
  try {
    const r = await api('/auth/register', 'POST', { name, email, phone, password: pass });
    token = r.token; localStorage.setItem('dzimmo_token', token);
    currentUser = r.user;
    closeModal('register');
    await loadCurrentUser();
    toast('🎉 Compte créé ! Vérifiez votre email.');
  } catch (e) { showError('register-error', e.message); }
}

async function doForgot() {
  const email = document.getElementById('forgot-email').value;
  try {
    await api('/auth/forgot-password', 'POST', { email });
    const el = document.getElementById('forgot-msg');
    el.className = 'success-msg'; el.textContent = 'Lien envoyé ! Vérifiez votre boite email.';
  } catch (e) { const el = document.getElementById('forgot-msg'); el.className = 'error-msg'; el.textContent = e.message; }
}

function logout() {
  unregisterPush();
  token = null; currentUser = null;
  localStorage.removeItem('dzimmo_token');
  if (wsConn) { wsConn.close(); wsConn = null; }
  document.getElementById('auth-btns').classList.remove('hidden');
  document.getElementById('user-btns').classList.add('hidden');
  document.getElementById('menu-register').classList.remove('hidden');
  document.querySelectorAll('.nav-admin').forEach(l => l.classList.add('hidden'));   // le lien Admin ne survit pas à la déconnexion
  showPage('home');
  toast(T('logout_done'));
}

// ── API helper ────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  // X-Lang : le serveur renvoie ses messages d'erreur dans la langue du site
  const opts = { method, headers: { 'Content-Type': 'application/json', 'X-Lang': currentLang } };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body)  opts.body = JSON.stringify(body);
  let r;
  try { r = await fetch(API + path, opts); }
  catch { throw new Error(T('err_network')); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || T('err_server')), { status: r.status, code: d.code });   // status : distinguer « introuvable » d'une panne
  return d;
}

// ── CAPTCHA Cloudflare Turnstile (chargé à la demande, invisible) ──────────────
// TURNSTILE_SITE_KEY absent côté serveur → captchaToken() renvoie '' et les routes l'ignorent.
// Une erreur réseau → graceful : le formulaire est quand même envoyé.
let _tsState = null;   // null = pas encore initialisé, '' = désactivé, 'ready' = prêt
let _tsWidgetId = null, _tsResolve = null, _tsKey = '';

async function _initTurnstile() {
  if (_tsState !== null) return;
  _tsState = '';
  try { const r = await api('/captcha'); _tsKey = r.enabled ? (r.key || '') : ''; } catch { _tsKey = ''; }
  if (!_tsKey) return;
  await new Promise((ok, ko) => {
    window._tsCb = ok;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=_tsCb';
    s.onerror = ko;
    document.head.appendChild(s);
  });
  const c = document.createElement('div'); document.body.appendChild(c);
  _tsWidgetId = window.turnstile.render(c, {
    sitekey: _tsKey, size: 'invisible',
    callback:            t  => { if (_tsResolve) { _tsResolve(t);  _tsResolve = null; } },
    'expired-callback': () => { if (_tsResolve) { window.turnstile.reset(_tsWidgetId); window.turnstile.execute(_tsWidgetId); } },
    'error-callback':   () => { if (_tsResolve) { _tsResolve(''); _tsResolve = null; } },
  });
  _tsState = 'ready';
}

async function captchaToken() {
  try { await _initTurnstile(); } catch { return ''; }
  if (_tsState !== 'ready') return '';
  return new Promise(ok => {
    _tsResolve = ok;
    window.turnstile.reset(_tsWidgetId);
    window.turnstile.execute(_tsWidgetId);
  });
}

// ── Navigation ────────────────────────────────────
const PAGES = ['home','annonces','detail','publier','agences','agency-detail','programmes','programme-detail','dashboard','messages','admin','cgu','confidentialite','mentions','contact','sim-prix','sim-estimation','sim-notaire','sim-credit','sim-rentabilite','carte','stats','contrats','newsletter','tendances','favoris-partages','vendeur'];

const defaultTitle = () => T('site_title');   // titre du site dans la langue affichée (identique à celui que le serveur rend pour / et /ar)
const PRO_PAGES = ['agences', 'agency-detail', 'programmes', 'programme-detail'];

// Même algorithme que server/seo.js (slugify) pour des URL identiques des deux côtés
function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

function annonceUrl(id, title) {
  const slug = slugify(title);
  return window.location.origin + langPath('/annonce/' + id + (slug ? '-' + slug : ''));
}

// ── Correction orthographique légère des mots-clés de recherche ──────────────
// Détecte les fautes de frappe (distance d'édition ≤ 2) par rapport au vocabulaire
// connu (wilayas, types de biens, modes) et propose une correction dans l'état "0 résultat".
function _normForSearch(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function _levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++)
      curr[j] = a[i-1] === b[j-1] ? prev[j-1] : 1 + Math.min(prev[j], curr[j-1], prev[j-1]);
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

let _searchVocab = null;
function _getSearchVocab() {
  if (_searchVocab) return _searchVocab;
  const types = ['appartement', 'villa', 'maison', 'bureau', 'terrain', 'ferme', 'entrepot'];
  const modes = ['vente', 'location'];
  _searchVocab = [
    ...types.map(w => ({ norm: w, display: w })),
    ...modes.map(w => ({ norm: w, display: w })),
    ...WILAYAS.map(w => ({ norm: _normForSearch(w), display: w })),
  ];
  return _searchVocab;
}

function correctQuery(query) {
  if (!query || query.length < 3) return null;
  const vocab = _getSearchVocab();
  const words = _normForSearch(query).split(' ');
  let corrected = [...words];
  let changed = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.length < 4) continue;
    const maxDist = w.length > 5 ? 2 : 1;
    let best = null, bestDist = maxDist + 1;
    for (const entry of vocab) {
      if (entry.norm.includes(' ')) continue;
      const d = _levenshtein(w, entry.norm);
      if (d > 0 && d <= maxDist && d < bestDist) { bestDist = d; best = entry; }
    }
    if (best) { corrected[i] = best.display; changed = true; }
  }
  return changed ? corrected.join(' ') : null;
}

function applyQueryCorrection(text) {
  const el = document.getElementById('f-q');
  if (el) { el.value = text; loadAnnonces(); }
}

// ── Pages de recherche indexables : /vente/appartements/oran (voir server/seo.js) ──
const SEO_MODES = { 'vente': 'vente', 'location': 'location_longue', 'location-saisonniere': 'location_courte' };
const SEO_TYPES = { 'appartements': 'appartement', 'villas': 'villa', 'maisons': 'maison', 'bureaux': 'bureau',
  'locaux-commerciaux': 'local_commercial', 'terrains': 'terrain', 'fermes': 'ferme', 'entrepots': 'entrepot' };
const invertMap = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));

// /vente/appartements/oran/bir-el-djir -> { mode, type, wilaya, commune } ; null si ce n'est pas une page de recherche.
// La commune est un texte libre : on ne garde que son slug (le serveur le reconnaît et le rend lisible), jamais un texte de l'adresse tel quel.
function parseLandingPath(pathname) {
  const seg = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!seg.length || !Object.hasOwn(SEO_MODES, seg[0]) || seg.length > 4) return null;
  const rest = seg.slice(1), f = { mode: SEO_MODES[seg[0]], type: '', wilaya: '', commune: '' };
  let i = 0;
  if (Object.hasOwn(SEO_TYPES, rest[i])) f.type = SEO_TYPES[rest[i++]];
  if (i < rest.length) {
    const w = WILAYAS.find(n => slugify(n) === rest[i]);
    if (!w) return null;
    f.wilaya = w; i++;
  }
  if (i === rest.length - 1 && !f.type && Object.hasOwn(SEO_TYPES, rest[i])) f.type = SEO_TYPES[rest[i++]];   // ancienne forme wilaya/type
  if (i < rest.length) {
    if (i !== rest.length - 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rest[i])) return null;
    f.commune = rest[i];
  }
  return f;
}

function landingPath(mode, type, wilaya, commune) {
  return '/' + [invertMap(SEO_MODES)[mode], type && invertMap(SEO_TYPES)[type], wilaya && slugify(wilaya), wilaya && commune && slugify(commune)]
    .filter(Boolean).join('/');
}

// Libellé traduit (FR / AR) : « Appartements à vendre à Oran » / « شقق للبيع في وهران » ; avec une commune : « … à Bir El Djir, Oran »
function seoLabel(mode, type, wilaya, commune) {
  const place = wilaya && commune ? T('seo_in') + ' ' + commune + (currentLang === 'ar' ? '، ' : ', ') + wilayaName(wilaya)
    : wilaya ? T('seo_in') + ' ' + wilayaName(wilaya) : '';
  return T(type ? 'seo_t_' + type : 'seo_t_all') + ' ' + T('seo_m_' + mode) + (place ? ' ' + place : '');
}

// Commune de la recherche en cours (page /vente/oran/bir-el-djir ou pastille) : { slug, label } ou null. Se retire avec la wilaya, la pastille ou en quittant la liste.
let _commune = null;
const prettySlug = slug => slug.replace(/-/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());
function setCommune(slug, label) {
  _commune = slug ? { slug, label: label || prettySlug(slug) } : null;
  const chip = document.getElementById('commune-chip');
  if (!chip) return;
  chip.classList.toggle('hidden', !_commune);
  document.getElementById('commune-label').textContent = _commune ? _commune.label : '';
}
function clearCommune() { setCommune(null); loadAnnonces(); }

// ── Filtre équipements ──────────────────────────────────────────────────
// Les labels des boutons sont renseignés par rebuildSelects() car ils dépendent de la langue.
function toggleFeatFilter(btn) {
  btn.classList.toggle('active');
  loadAnnonces();
}
function getActiveFeats() {
  return Array.from(document.querySelectorAll('.f-feat-btn.active')).map(b => b.dataset.v);
}
function clearFeatFilters() {
  document.querySelectorAll('.f-feat-btn.active').forEach(b => b.classList.remove('active'));
}

// ── Filtre "avec média" ────────────────────────────
function toggleMediaFilter(btn) {
  btn.classList.toggle('active');
  loadAnnonces();
}
function getMediaFilters() {
  const out = {};
  if (document.getElementById('f-has-video')?.classList.contains('active')) out.has_video = '1';
  if (document.getElementById('f-has-tour')?.classList.contains('active'))  out.has_tour  = '1';
  return out;
}
function clearMediaFilters() {
  document.getElementById('f-has-video')?.classList.remove('active');
  document.getElementById('f-has-tour')?.classList.remove('active');
}

// ── Annonces récemment vues ────────────────────────
const VIEWED_KEY = 'dzimmo_viewed';
const VIEWED_MAX = 6;
function trackView(p) {
  try {
    const items = JSON.parse(localStorage.getItem(VIEWED_KEY) || '[]');
    const filtered = items.filter(x => x.id !== p.id);
    filtered.unshift({ id: p.id, title: p.title, image: p.image || null,
      price: p.price, wilaya: p.wilaya, mode: p.mode, type_bien: p.type_bien, created_at: p.created_at });
    localStorage.setItem(VIEWED_KEY, JSON.stringify(filtered.slice(0, VIEWED_MAX)));
  } catch {}
  showRecentlyViewed();
}
function recentlyViewedHTML() {
  try {
    const items = JSON.parse(localStorage.getItem(VIEWED_KEY) || '[]');
    if (!items.length) return '';
    return `<section style="margin-top:2rem">
      <div class="section-header"><div class="section-title">${esc(T('recently_viewed'))}</div></div>
      <div class="grid">${items.map(p => cardHTML(p)).join('')}</div>
    </section>`;
  } catch { return ''; }
}
function showRecentlyViewed() {
  const el = document.getElementById('home-recently-viewed');
  if (!el) return;
  const html = recentlyViewedHTML();
  el.innerHTML = html;
  el.classList.toggle('hidden', !html);
}

// ── Partager la recherche ──────────────────────────
function shareSearch() {
  navigator.clipboard.writeText(location.href)
    .then(() => toast(T('link_copied')))
    .catch(() => toast(T('link_copied')));
}

// ── Autocomplétion de la barre de recherche ────────
let _suggestTimer = null;
function initSuggest() {
  const input = document.getElementById('f-q');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(_suggestTimer);
    const q = input.value.trim();
    if (q.length < 2) { closeSuggest(); return; }
    _suggestTimer = setTimeout(() => fetchSuggest(q), 280);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') closeSuggest(); });
  document.addEventListener('click', e => { if (!e.target.closest('#suggest-wrap')) closeSuggest(); });
}
async function fetchSuggest(q) {
  try {
    const items = await api('/search/suggest?q=' + encodeURIComponent(q));
    renderSuggest(items);
  } catch { closeSuggest(); }
}
function renderSuggest(items) {
  const box = document.getElementById('suggest-box');
  if (!box) return;
  if (!items.length) { closeSuggest(); return; }
  box.innerHTML = items.map(p =>
    `<div class="suggest-item" data-id="${p.id}" data-title="${esc(p.title)}" onclick="selectSuggest(this)">
      <span class="suggest-title">${esc(p.title)}</span>
      <span class="suggest-meta">${esc(wilayaName(p.wilaya))} · ${priceText(p)}</span>
    </div>`,
  ).join('');
  box.classList.remove('hidden');
}
function closeSuggest() {
  document.getElementById('suggest-box')?.classList.add('hidden');
}
function selectSuggest(el) {
  const id = Number(el.dataset.id);
  const input = document.getElementById('f-q');
  if (input) input.value = el.dataset.title;
  closeSuggest();
  showPage('detail', id);
}

// ── Tendances du marché ────────────────────────────
async function loadMarket() {
  const el = document.getElementById('market-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const mode      = document.getElementById('mkt-mode')  ?.value || '';
    const type_bien = document.getElementById('mkt-type')  ?.value || '';
    const qs = new URLSearchParams();
    if (mode)      qs.set('mode', mode);
    if (type_bien) qs.set('type_bien', type_bien);
    const q = qs.toString();
    const data = await api('/stats/market' + (q ? '?' + q : ''));
    el.innerHTML = marketHTML(data);
  } catch (e) { el.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; }
}
async function loadSharedFavorites(token) {
  const el = document.getElementById('shared-fav-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const data = await api('/favorites/shared/' + token);
    if (!data.length) { el.innerHTML = '<div class="empty-state"><div class="icon">❤️</div><p>' + T('dash_no_fav') + '</p></div>'; return; }
    el.innerHTML = '<div class="grid">' + data.map(p => cardHTML(p)).join('') + '</div>';
  } catch (e) {
    el.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message || T('err_server'))}</p>`;
  }
}

function marketTrend(t) {
  const n = Number(t);
  if (!Number.isFinite(n) || t === null || t === undefined) return '';
  if (Math.abs(n) < 1) return `<span style="color:var(--text-muted)">${esc(T('trend_stable'))}</span>`;
  if (n > 0) return `<span style="color:var(--primary-text)">${esc(T('trend_up').replace('{n}', n))}</span>`;
  return `<span style="color:#b91c1c">${esc(T('trend_down').replace('{n}', Math.abs(n)))}</span>`;
}
function marketHTML(data) {
  const modeOpts = [['','s_all_modes'],['vente','s_vente'],['location_longue','s_loc_longue'],['location_courte','s_loc_courte']];
  const typeOpts = [['','s_all_types'],['appartement','s_appart'],['villa','s_villa'],['maison','s_maison'],
    ['bureau','s_bureau'],['local_commercial','s_local'],['terrain','s_terrain'],['ferme','s_ferme'],['entrepot','s_entrepot']];
  const sel = (id, opts, val) => `<select id="${id}" style="padding:.3rem .6rem;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;background:var(--bg);color:var(--text);cursor:pointer" onchange="loadMarket()">${opts.map(([v,k]) => `<option value="${v}"${v===val?' selected':''}>${T(k)}</option>`).join('')}</select>`;
  const filters = `<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1.1rem;align-items:center">
    <span style="font-size:.82rem;color:var(--text-muted)">${esc(T('mkt_filter_mode'))} :</span>${sel('mkt-mode', modeOpts, data.mode || '')}
    <span style="font-size:.82rem;color:var(--text-muted)">${esc(T('mkt_filter_type'))} :</span>${sel('mkt-type', typeOpts, data.type_bien || '')}
  </div>`;
  const rows = data.wilayas;
  if (!rows || !rows.length) return filters + `<p style="padding:2rem;color:var(--text-muted)">${esc(T('market_no_data'))}</p>`;
  const max = rows[0].median_price_m2;
  const bars = rows.map(r => {
    const pct    = max > 0 ? Math.round((r.median_price_m2 / max) * 100) : 0;
    const label  = esc(wilayaName(r.wilaya) || r.wilaya);
    const price  = Number(r.median_price_m2).toLocaleString('fr-DZ') + ' ' + T('u_dzd') + '/m²';
    return `<tr>
      <td style="white-space:nowrap;padding:.4rem .6rem;font-size:.85rem">${label}</td>
      <td style="width:100%;padding:.4rem .4rem">
        <div style="background:var(--primary);border-radius:4px;height:18px;width:${pct}%;min-width:3px"></div>
      </td>
      <td style="white-space:nowrap;padding:.4rem .6rem;font-size:.85rem;font-weight:600;color:var(--primary-text)">${price}</td>
      <td style="white-space:nowrap;padding:.4rem .6rem;font-size:.75rem;color:var(--text-muted)">${r.count}</td>
      <td style="white-space:nowrap;padding:.4rem .6rem;font-size:.8rem">${marketTrend(r.trend_pct)}</td>
    </tr>`;
  }).join('');
  return `${filters}<p style="font-size:.88rem;color:var(--text-muted);margin-bottom:1.2rem">${esc(T('market_sub'))}</p>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">${bars}</table>
    </div>`;
}

// Les liens et titres rendus par le serveur (data-seo-*) suivent la langue choisie
function relabelSeo() {
  document.querySelectorAll('[data-seo-m]').forEach(el => {
    const d = el.dataset;
    el.textContent = seoLabel(d.seoM, d.seoT, d.seoW, d.seoK) + (d.seoC ? ` (${d.seoC})` : '');
  });
}

function showPage(page, data = null) {
  toggleMenu(false);
  document.body.classList.remove('qc-on');   // la barre d'appel n'existe que sur une fiche (renderDetail la remet)
  // Hors fiche annonce, on quitte l'URL /annonce/… (les filtres d'annonces réécrivent ensuite la query).
  // Annuaires, fiches de professionnels et de programmes règlent eux-mêmes leur adresse (/agences, /agence/12-nom…, pro.js).
  if (page !== 'detail') {
    if (routePath() !== '/' && !PRO_PAGES.includes(page)) history.replaceState(null, '', langPath('/'));
    document.title = defaultTitle();
  }
  if (page !== 'publier' && publishEditId) { publishEditId = null; resetPublishForm(); }   // modification abandonnée : le formulaire redevient celui d'une publication
  PAGES.forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.classList.add('hidden');
  });
  const el = document.getElementById('page-' + page);
  if (el) el.classList.remove('hidden');
  currentPage = page;
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === page);
  });
  window.scrollTo(0, 0);

  if (page === 'home')            { loadHomeProperties(); loadHomePros(); }
  if (page === 'annonces')        loadAnnonces();
  if (page === 'agences')         loadAgences();
  if (page === 'programmes')      loadProgrammes();
  if (page === 'publier')         { syncPublishMode(); initPublishAs(); updatePublishScore(); }
  if (page === 'programme-detail' && data) { window._programmeId = data; loadProgrammeDetail(data); }
  if (page === 'dashboard')       loadDashboard();
  if (page === 'messages')        loadMessages();
  if (page === 'detail' && data)       loadDetail(data);
  if (page === 'agency-detail' && data) { window._agencyId = data; loadAgencyDetail(data); }
  if (page === 'admin')                 loadAdmin();
  if (page === 'sim-estimation')  initSeWilayaSelect();
  if (page === 'carte')           initMap();
  if (page === 'stats')           loadStatsPage();
  if (page === 'tendances')       loadMarket();
  if (page === 'favoris-partages' && data) loadSharedFavorites(data);
  if (page === 'contrats' && window.MC) MC.open();
  if (page === 'vendeur' && data) loadVendeur(data);
}

function goBack() { showPage(currentPage === 'detail' ? 'annonces' : 'home'); }

function tryPublier() {
  if (!token) { openModal('login'); return; }
  showPage('publier');
}

function filterMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  loadHomeProperties(mode);
}

function filterType(type) {
  showPage('annonces');
  document.getElementById('f-type').value = type;
  loadAnnonces();
}

// Centroïdes approximatifs des 69 wilayas (ordre = WILAYAS)
const WILAYA_COORDS = [
  [27.87,-0.29],[36.17,1.33],[33.80,2.86],[35.87,7.11],[35.55,6.17],
  [36.75,5.06],[34.85,5.73],[31.62,-2.22],[36.47,2.83],[36.37,3.90],
  [22.79,5.52],[35.40,8.12],[34.88,-1.32],[35.37,1.32],[36.72,4.05],
  [36.74,3.06],[34.67,3.25],[36.82,5.77],[36.19,5.41],[34.84,0.15],
  [36.87,6.91],[35.19,-0.63],[36.90,7.77],[36.46,7.43],[36.37,6.61],
  [36.27,2.75],[35.93,0.09],[35.70,4.54],[35.40,0.14],[31.95,5.33],
  [35.70,-0.63],[33.68,1.02],[26.51,8.48],[36.07,4.76],[36.76,3.47],
  [36.77,8.31],[27.67,-8.15],[35.60,1.81],[33.37,6.86],[35.44,7.14],
  [36.28,7.95],[36.59,2.45],[36.45,6.26],[36.26,1.97],[33.27,-0.31],
  [35.30,-1.14],[32.49,3.67],[35.74,0.55],[29.26,0.24],[21.33,0.95],
  [34.42,5.07],[30.13,-2.17],[27.20,2.47],[19.57,5.77],[33.10,6.07],
  [24.55,9.48],[33.95,5.92],[30.58,2.88],
  [34.11,2.10],[35.39,5.37],[35.22,5.67],[35.07,7.93],[34.22,-1.26],
  [35.18,2.32],[35.45,2.91],[34.15,3.50],[35.88,2.76],[35.21,4.19],[32.89,0.54],
];

let _nearCoords = null;

function nearMe() {
  const btn = document.getElementById('btn-near-me');
  if (!navigator.geolocation) { toast('Géolocalisation non supportée.'); return; }
  btn.disabled = true; btn.textContent = '⏳ Localisation…';
  navigator.geolocation.getCurrentPosition(pos => {
    btn.disabled = false; btn.textContent = T('near_me');
    const { latitude: lat, longitude: lng } = pos.coords;
    _nearCoords = [lat, lng];
    let bestIdx = 0, bestDist = Infinity;
    WILAYA_COORDS.forEach(([wlat, wlng], i) => {
      const d = Math.hypot(lat - wlat, lng - wlng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    const wilaya = WILAYAS[bestIdx];
    setCommune(null);
    document.getElementById('f-wilaya').value = wilaya;
    document.getElementById('near-me-label').textContent = wilayaName(wilaya);
    document.getElementById('near-me-badge').style.display = '';
    loadAnnonces();
  }, () => {
    btn.disabled = false; btn.textContent = T('near_me');
    toast('Impossible d\'accéder à votre position.');
  }, { timeout: 8000 });
}

function clearNearMe() {
  _nearCoords = null;
  document.getElementById('near-me-badge').style.display = 'none';
  document.getElementById('near-me-label').textContent = '';
  document.getElementById('f-wilaya').value = '';
  setCommune(null);
  loadAnnonces();
}

function doSearch() {
  const wilaya = document.getElementById('s-wilaya').value;
  const mode   = document.getElementById('s-mode').value;
  const type   = document.getElementById('s-type').value;
  showPage('annonces');
  setCommune(null);
  if (wilaya) document.getElementById('f-wilaya').value = wilaya;
  if (mode)   document.getElementById('f-mode').value = mode;
  if (type)   document.getElementById('f-type').value = type;
  loadAnnonces();
}

// ── Chargement des annonces ───────────────────────
async function loadHomeProperties(mode = '') {
  const grid = document.getElementById('home-grid');
  const countEl = document.getElementById('props-count');
  grid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const params = new URLSearchParams({ status: 'active', limit: 12 });
    if (mode) params.set('mode', mode);
    const resp = await api('/properties?' + params);
    countEl.textContent = resp.total + ' ' + unit(resp.total, 'st_ad');   // « 7 annonces » / « 7 إعلانات » (duel et pluriel arabes compris)
    renderGrid(grid, resp.data);
    loadFeatured('home-featured', { mode });
    showRecentlyViewed();
  } catch (e) { grid.innerHTML = `<p style="color:red;padding:1rem">${e.message}</p>`; }
}

let annoncesPage = 1;

async function loadAnnonces(page = 1) {
  annoncesPage = page;
  const grid = document.getElementById('annonces-grid');
  const countEl = document.getElementById('annonces-count');
  grid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  document.getElementById('annonces-pagination').innerHTML = '';

  const params = new URLSearchParams({ status: 'active', page, limit: 12 });
  const get = id => document.getElementById(id)?.value;
  if (get('f-wilaya'))      params.set('wilaya',      get('f-wilaya'));
  if (_commune && get('f-wilaya')) params.set('commune', _commune.slug);
  if (get('f-mode'))        params.set('mode',        get('f-mode'));
  if (get('f-type'))        params.set('type_bien',   get('f-type'));
  if (get('f-min-price'))   params.set('min_price',   get('f-min-price'));
  if (get('f-max-price'))   params.set('max_price',   get('f-max-price'));
  if (get('f-rooms'))       params.set('rooms',       get('f-rooms'));
  if (get('f-min-surface')) params.set('min_surface', get('f-min-surface'));
  if (get('f-q'))           params.set('q',           get('f-q'));
  if (get('f-sort'))        params.set('sort',        get('f-sort'));
  const activeFeats = getActiveFeats();
  if (activeFeats.length) params.set('features', activeFeats.join(','));
  const mf = getMediaFilters();
  if (mf.has_video) params.set('has_video', '1');
  if (mf.has_tour)  params.set('has_tour',  '1');

  // Persister les filtres dans l'URL (partage de recherche)
  const urlParams = new URLSearchParams();
  urlParams.set('page', 'annonces');
  ['f-wilaya','f-mode','f-type','f-min-price','f-max-price','f-rooms','f-min-surface','f-q','f-sort'].forEach(id => {
    const v = get(id);
    if (v) urlParams.set(id, v);
  });
  if (activeFeats.length) urlParams.set('f-features', activeFeats.join(','));
  if (mf.has_video) urlParams.set('f-has-video', '1');
  if (mf.has_tour)  urlParams.set('f-has-tour',  '1');
  if (_commune && get('f-wilaya')) urlParams.set('f-commune', _commune.slug);
  if (page > 1) urlParams.set('p', page);
  // Seuls mode / type / wilaya (+ commune) (tri par défaut, page 1, sans autres filtres) : URL indexable /vente/appartements/oran
  const landingOnly = get('f-mode') && page === 1 && (!get('f-sort') || get('f-sort') === 'date_desc')
    && !['f-min-price', 'f-max-price', 'f-rooms', 'f-min-surface', 'f-q'].some(id => get(id))
    && !activeFeats.length && !mf.has_video && !mf.has_tour;
  if (landingOnly) {
    const commune = get('f-wilaya') && _commune ? _commune : null;
    history.replaceState(null, '', langPath(landingPath(get('f-mode'), get('f-type'), get('f-wilaya'), commune?.slug)));
    document.title = seoLabel(get('f-mode'), get('f-type'), get('f-wilaya'), commune?.label) + ' | DzImmo';
  } else {
    history.replaceState(null, '', langPath('/') + '?' + urlParams.toString());
  }

  try {
    const resp = await api('/properties?' + params);
    const { data, total, pages } = resp;
    countEl.textContent = total + ' ' + T(total > 1 ? 'res_many' : 'res_one');
    if (!data.length) {
      document.getElementById('annonces-featured')?.classList.add('hidden');
      const rawQ = get('f-q');
      const suggestion = rawQ ? correctQuery(rawQ) : null;
      const suggHTML = suggestion
        ? `<p style="margin:.5rem 0 0;font-size:.9rem">${T('search_suggest')} <a href="#" class="js-query-suggestion" data-q="${esc(suggestion)}" style="color:var(--primary-text);font-weight:600">${esc(suggestion)}</a> ?</p>`
        : '';
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🔍</div><h3>Aucune annonce trouvée</h3><p>Essayez d'élargir vos critères.${suggHTML}</p></div>`;
      const suggLink = grid.querySelector('.js-query-suggestion');
      if (suggLink) suggLink.addEventListener('click', e => { e.preventDefault(); applyQueryCorrection(suggLink.dataset.q); });
      return;
    }
    renderGrid(grid, data);
    if (page === 1) loadFeatured('annonces-featured', { mode: get('f-mode'), type_bien: get('f-type'), wilaya: get('f-wilaya') }, 3);
    else document.getElementById('annonces-featured')?.classList.add('hidden');
    renderPagination('annonces-pagination', page, pages, 'loadAnnonces');
  } catch (e) { grid.innerHTML = `<p style="color:red;padding:1rem">${e.message}</p>`; }
}

function renderPagination(containerId, page, pages, fnName) {
  const c = document.getElementById(containerId);
  if (!c || pages <= 1) { if (c) c.innerHTML = ''; return; }

  const dot = `<span style="padding:.4rem .2rem;color:var(--text-muted)">…</span>`;

  const btn = (label, p, active, disabled) => {
    const style = `min-width:36px;padding:.35rem .65rem;font-size:.85rem`;
    if (disabled) return `<button class="btn btn-outline btn-sm" style="${style};opacity:.4" disabled>${label}</button>`;
    if (active)   return `<button class="btn btn-primary btn-sm" style="${style}">${label}</button>`;
    return `<button class="btn btn-outline btn-sm" style="${style}" onclick="${fnName}(${p})">${label}</button>`;
  };

  const range = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) range.push(p);

  const first = range[0] > 1
    ? btn(1, 1, false, false) + (range[0] > 2 ? dot : '')
    : '';
  const last  = range[range.length - 1] < pages
    ? (range[range.length - 1] < pages - 1 ? dot : '') + btn(pages, pages, false, false)
    : '';

  c.innerHTML = `<div style="display:flex;gap:.3rem;flex-wrap:wrap;justify-content:center;padding:1.5rem 0">
    ${btn('←', page - 1, false, page <= 1)}
    ${first}${range.map(p => btn(p, p, p === page, false)).join('')}${last}
    ${btn('→', page + 1, false, page >= pages)}
  </div>`;
}

function renderGrid(container, props) {
  if (!props.length) {
    container.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="icon">🏠</div><h3>' + T('no_listings') + '</h3></div>';
    return;
  }
  container.innerHTML = props.map(p => cardHTML(p)).join('');
}

// Formules « À la une » (GET /api/promotions/plans) : lues une fois ; un échec n'est pas mémorisé (on réessaie au prochain affichage)
let _promo = null;
async function promoPlans() {
  if (_promo) return _promo;
  try { _promo = await api('/promotions/plans'); } catch { return { enabled: false, plans: [], simulated: false }; }
  return _promo;
}

// À la une : la date de fin vient du serveur (properties.featured_until) ; le navigateur ne fait que la comparer à l'heure courante
const isFeatured = p => !!(p && p.featured_until && new Date(p.featured_until).getTime() > Date.now());

// Bande « À la une » : quelques annonces tirées au hasard par le serveur (rotation équitable), au-dessus de la liste normale.
// Masquée s'il n'y en a aucune ou si le chargement échoue (la liste, elle, n'en dépend pas).
async function loadFeatured(containerId, filters = {}, limit = 4) {
  const box = document.getElementById(containerId);
  if (!box) return;
  const params = new URLSearchParams({ limit });
  for (const k of ['mode', 'type_bien', 'wilaya']) if (filters[k]) params.set(k, filters[k]);
  try {
    const { data } = await api('/properties/featured?' + params);
    if (!data || !data.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.innerHTML = '<div class="section-header"><div class="section-title">' + T('featured_title') + '</div></div>'
      + '<div class="grid">' + data.map(p => cardHTML(p)).join('') + '</div>';
    box.classList.remove('hidden');
  } catch { box.classList.add('hidden'); box.innerHTML = ''; }
}

function cardHTML(p) {
  window._propCache[p.id] = p;
  const price = priceText(p);
  const meta = [
    p.rooms      ? p.rooms + ' ' + unit(p.rooms, 'u_room') : null,
    p.surface_m2 ? p.surface_m2 + ' ' + T('u_m2') : null,
    p.baths      ? p.baths + ' ' + unit(p.baths, 'u_bath') : null,
  ].filter(Boolean).join(' · ');
  const isCmp = _compareList.some(x => x.id === p.id);
  const isNew = p.created_at && (Date.now() - new Date(p.created_at).getTime()) < 3 * 24 * 60 * 60 * 1000;
  const isPriceDrop = p.price_drop_notified_at && (Date.now() - new Date(p.price_drop_notified_at).getTime()) < 7 * 24 * 60 * 60 * 1000;
  return `
  <div class="card-wrapper" onclick="showPage('detail', ${p.id})">
    <div class="card">
      <img class="card-img" ${imgAttrs(p.image || 'https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=600&q=70', '(max-width: 640px) 100vw, 320px')} alt="${esc(p.title)}" loading="lazy" onerror="this.removeAttribute('srcset');this.src='https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=600&q=70'">
      ${p.verified ? '<span class="verified-badge">' + T('verified_badge') + '</span>' : ''}
      ${isNew ? '<span class="new-badge">' + T('new_badge') + '</span>' : ''}
      ${isPriceDrop && !isNew ? '<span class="price-drop-badge">' + T('price_drop_badge') + '</span>' : ''}
      ${p.owner_responsive ? '<span class="responsive-badge">' + T('responsive_badge') + '</span>' : ''}
      ${isFeatured(p) ? '<span class="featured-badge">' + T('featured_badge') + '</span>' : ''}
      ${p.video_url || p.tour_url ? '<span class="media-badge">' + (p.tour_url ? '🧭 ' + T('media_badge_tour') : '🎬 ' + T('media_badge_video')) + '</span>' : ''}
      ${token ? `<button class="card-fav" onclick="event.stopPropagation();toggleFav(${p.id},this)" title="${T('fav_tip')}">🤍</button>` : ''}
      <button class="card-cmp${isCmp ? ' active' : ''}" data-id="${p.id}"
              onclick="event.stopPropagation();toggleCompare(${p.id})" title="${T('cmp_tip')}">⚖</button>
      <div class="card-body">
        <span class="card-mode mode-${p.mode}">${MODES[p.mode] || p.mode}</span>
        <div class="card-title">${esc(p.title)}</div>
        <div class="card-loc">📍 ${esc(p.commune || wilayaName(p.wilaya))}, ${esc(wilayaName(p.wilaya))}</div>
        ${advBadgeHTML(advKind(p))}
        <div class="card-price">${price}</div>
        <div class="card-meta">
          <span>${TYPES[p.type_bien] || p.type_bien}</span>
          ${meta ? `<span>${meta}</span>` : ''}
          <span>${p.views || 0} ${unit(p.views || 0, 'u_view')}</span>
        </div>
      </div>
    </div>
  </div>`;
}

// ── Vidéo et visite virtuelle de la fiche ────────
// Le serveur renvoie { provider, url, embed } reconstruits depuis l'identifiant (server/videos.js). Le lecteur d'un tiers ne se charge qu'au
// clic du visiteur (aucun cookie ni requête vers YouTube, Vimeo, Matterport ou Kuula avant), et il est incrusté dans un iframe isolé (sandbox).
const MEDIA_NAMES = { youtube: 'YouTube', vimeo: 'Vimeo', matterport: 'Matterport', kuula: 'Kuula' };
const isHttps = v => typeof v === 'string' && v.startsWith('https://');

function mediaHTML(p) {
  return ['video', 'tour'].map(kind => {
    const m = p[kind];
    if (!m || !MEDIA_NAMES[m.provider] || !isHttps(m.embed) || !isHttps(m.url)) return '';
    const name = MEDIA_NAMES[m.provider];
    return `
    <div class="media-block">
      <h3 style="font-size:1rem;font-weight:700;margin:1.5rem 0 .75rem">${kind === 'tour' ? '🧭' : '🎬'} ${T('media_' + kind)}</h3>
      <button type="button" class="media-facade" data-kind="${kind}" onclick="loadMedia(this)">
        <span class="media-play">${T('media_load_' + kind)}</span>
        <span class="media-note">${esc(T('media_privacy').replace('{p}', name))}</span>
      </button>
      <a class="media-open" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(T('media_open').replace('{p}', name))}</a>
    </div>`;
  }).join('');
}

function loadMedia(btn) {
  const kind = btn.dataset.kind;
  const m = window._detailMedia && window._detailMedia[kind];
  if (!m || !isHttps(m.embed)) return;
  const f = document.createElement('iframe');
  f.className = 'media-frame';
  f.src = m.embed;
  f.title = T('media_' + kind);
  f.loading = 'lazy';
  f.referrerPolicy = 'strict-origin-when-cross-origin';
  f.allowFullscreen = true;
  f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen; accelerometer; gyroscope; xr-spatial-tracking');
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
  btn.replaceWith(f);
}

// ── Détail annonce ────────────────────────────────
async function loadDetail(id) {
  const container = document.getElementById('detail-content');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const p = await api('/properties/' + id);
    window._detailProp = p;
    renderDetail(p);
  } catch (e) { container.innerHTML = `<p style="color:red;padding:2rem">${e.message}</p>`; }
}

// Bandeau de reconfirmation : l'annonceur arrive depuis l'email de rappel, sans avoir à se connecter
function renewBannerHTML(p) {
  if (!window._renewToken || window._renewFor !== p.id || !['active', 'archived'].includes(p.status)) return '';
  return `<div class="renew-banner" id="renew-banner"><strong>${T('rn_title')}</strong>
    <div class="renew-actions">
      <button class="btn btn-primary" onclick="confirmListing(${p.id}, 'available')">${T('rn_yes')}</button>
      <button class="btn btn-outline" onclick="confirmListing(${p.id}, 'closed')">${T('rn_no')}</button>
    </div></div>`;
}

async function confirmListing(id, action) {
  try {
    await api('/properties/' + id + '/confirm', 'POST', { token: window._renewToken, action });
    window._renewToken = null;
    toast(T(action === 'available' ? 'rn_done' : 'rn_closed'));
    loadDetail(id);
  } catch (e) { toast('❌ ' + e.message); }
}

// Rendu de la fiche (rejoué sans nouvel appel API quand la langue change : pas de vue comptée en double)
function renderDetail(p) {
  const container = document.getElementById('detail-content');
  try {
    // URL propre + titre d'onglet (utile au partage et à l'historique)
    history.replaceState(null, '', new URL(annonceUrl(p.id, p.title)).pathname);
    document.title = p.title + ' | DzImmo';
    trackView(p);
    // Annonce non publiée (visible seulement de son propriétaire / d'un admin) : bandeau d'information
    const modBanner = p.status === 'pending'
      ? `<div style="background:#fef3c7;color:#92400e;border:1px solid #f59e0b;border-radius:10px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.9rem">⏳ ${T('mod_banner_pending')}</div>`
      : p.status === 'rejected'
      ? `<div style="background:#fee2e2;color:#991b1b;border:1px solid #f87171;border-radius:10px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.9rem">❌ ${T('mod_banner_rejected')} ${p.moderation_reason ? T('dash_reason') + ' ' + esc(modReason(p.moderation_reason)) : ''}</div>`
      : '';
    const photos = Array.isArray(p.photos) ? p.photos : [p.image].filter(Boolean);
    const price  = priceText(p);
    const feats  = Array.isArray(p.features) ? p.features : [];

    // Une clé inconnue est affichée telle quelle : elle vient des données, donc échappée
    let featuresHTML = feats.map(f => `<span class="feature-chip">${esc(FEATURES[f] || f)}</span>`).join('');
    window._detailMedia = { video: p.video || null, tour: p.tour || null };   // lu par loadMedia : jamais d'adresse dans un onclick
    window._detailPhotos = photos;   // lue par la visionneuse : du JSON dans un attribut onclick casserait l'attribut (guillemets)

    container.innerHTML = `
      ${renewBannerHTML(p)}
      ${modBanner}
      <div class="detail-gallery">
        <div style="position:relative">
          <img ${imgAttrs(photos[0] || '', '(max-width: 900px) 100vw, 800px', [960])} alt="${esc(p.title)}"
               onclick="openLightbox(window._detailPhotos, 0)"
               onerror="this.removeAttribute('srcset');this.src='https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=800&q=70'">
          ${photos.length > 3 ? `<button class="gallery-more-btn" onclick="openLightbox(window._detailPhotos, 0)">${T('det_see_photos').replace('{n}', photos.length)}</button>` : ''}
        </div>
        <div class="detail-gallery-side">
          ${photos[1] ? `<img ${imgAttrs(photos[1], '(max-width: 900px) 50vw, 400px')} alt="Photo 2" loading="lazy" onclick="openLightbox(window._detailPhotos, 1)" onerror="this.remove()">` : '<div style="background:var(--border)"></div>'}
          ${photos[2] ? `<img ${imgAttrs(photos[2], '(max-width: 900px) 50vw, 400px')} alt="Photo 3" loading="lazy" onclick="openLightbox(window._detailPhotos, 2)" onerror="this.remove()">` : '<div style="background:var(--border)"></div>'}
        </div>
      </div>
      <div class="detail-body">
        <div class="detail-info">
          <span class="card-mode mode-${p.mode}" style="margin-bottom:.75rem">${MODES[p.mode] || p.mode}</span>
          <h1 style="margin-top:.4rem">${esc(p.title)}</h1>
          <div class="detail-loc">📍 ${esc([p.address, p.commune, wilayaName(p.wilaya)].filter(Boolean).join(', '))}</div>
          <div class="detail-price">${price}</div>
          <div class="detail-stats">
            ${p.surface_m2 ? `<div class="stat-box"><div class="val">${p.surface_m2}</div><div class="lbl">${T('u_m2')}</div></div>` : ''}
            ${p.rooms      ? `<div class="stat-box"><div class="val">${p.rooms}</div><div class="lbl">${capFirst(unit(p.rooms, 'u_room'))}</div></div>` : ''}
            ${p.baths      ? `<div class="stat-box"><div class="val">${p.baths}</div><div class="lbl">${unit(p.baths, 'u_bath')}</div></div>` : ''}
          </div>
          ${featuresHTML ? `<div class="detail-features">${featuresHTML}</div>` : ''}
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:.75rem">${T('det_desc')}</h3>
          <div class="detail-desc">${esc(p.description || T('det_no_desc'))}</div>
          ${mediaHTML(p)}
          ${p.reviews > 0 ? `
          <div style="margin-top:2rem">
            <h3 style="font-size:1rem;font-weight:700;margin-bottom:.75rem">${T('det_reviews')} (${p.reviews})</h3>
            <div>${(p.reviews_list || p.reviews_data || []).map(r => `
              <div style="padding:.75rem 0;border-bottom:1px solid var(--border)">
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem">
                  <strong style="font-size:.88rem">${esc(r.author_name || T('det_anon'))}</strong>
                  <span class="stars">${'⭐'.repeat(Math.round(r.rating))}</span>
                </div>
                <p style="font-size:.88rem;color:var(--text-muted)">${esc(r.comment || '')}</p>
              </div>`).join('')}
            </div>
          </div>` : ''}
        </div>
        <div>
          <div class="contact-card">
            <div class="owner-card">
              <div class="owner-avatar">${(p.agency_name || p.owner_name || '?')[0].toUpperCase()}</div>
              <div>
                <div class="owner-name">${p.agency_id && p.agency_name
                  ? `<a class="owner-link" href="${esc(proPath({ id: p.agency_id, kind: p.agency_kind, name: p.agency_name }))}" onclick="return proGo(event,'agency-detail',${Number(p.agency_id)})">${esc(p.agency_name)}</a>`
                  : esc(p.agency_name || p.owner_name)}</div>
                <div class="owner-agency">${T(p.agency_name ? (p.agency_kind === 'promoteur' ? 'kind_promoteur' : 'det_agency') : 'det_private')}</div>
                ${advBadgeHTML(advKind(p))}
                ${ownerTrustHTML(p)}
                ${!p.agency_id ? `<a href="/vendeur/${Number(p.owner_id)}" class="btn btn-outline btn-sm" style="margin-top:.5rem;font-size:.8rem;display:block;text-align:center" data-id="${Number(p.owner_id)}" onclick="return showVendeur(event,this.dataset.id)">${T('vd_profile')}</a>` : ''}
              </div>
            </div>
            ${p.project ? `<a class="pro-chip pg-lot-chip" href="${esc(progPath(p.project))}" onclick="return proGo(event,'programme-detail',${Number(p.project.id)})">🏗 ${T('pg_lot_of')} ${esc(p.project.name)}</a>` : ''}
            ${quickContactHTML(p)}
            ${token ? `
            <form class="contact-form" onsubmit="return submitContact(event, ${p.id}, ${p.owner_id})">
              <h3>${T('det_contact')}</h3>
              <label>${T('det_req_type')}</label>
              <select id="ctype-${p.id}">
                <option value="info">${T('det_opt_info')}</option>
                <option value="visite">${T('det_opt_visit')}</option>
                <option value="offre">${T('det_opt_offer')}</option>
              </select>
              <div id="visit-field-${p.id}" class="hidden">
                <label>${T('det_visit_date')}</label>
                <input type="date" id="cdate-${p.id}" min="${new Date().toISOString().slice(0,10)}">
                <label style="margin-top:.5rem">${T('det_visit_time')}</label>
                <select id="ctime-${p.id}">
                  <option value="">${T('det_visit_time_none')}</option>
                  ${(() => { const opts = []; for (let h = 8; h < 20; h++) { opts.push(`<option value="${String(h).padStart(2,'0')}:00">${String(h).padStart(2,'0')}:00</option>`); opts.push(`<option value="${String(h).padStart(2,'0')}:30">${String(h).padStart(2,'0')}:30</option>`); } return opts.join(''); })()}
                </select>
              </div>
              <div id="offer-field-${p.id}" class="hidden">
                <label>${T('det_offer_amount')}</label>
                <input type="number" id="coffer-${p.id}" placeholder="${T('ph_example').replace('{v}', formatPrice(25000000))}">
              </div>
              <label>${T('det_msg')}</label>
              <textarea id="cmsg-${p.id}" placeholder="${T('det_msg_ph')}"></textarea>
              <button type="submit" class="btn btn-primary" style="width:100%;margin-top:.75rem;padding:.7rem">${T('det_send_req')}</button>
            </form>
            <button class="btn btn-outline" style="width:100%;margin-top:.5rem;padding:.7rem" onclick="openChat(${p.id}, ${p.owner_id})">${T('det_send_msg')}</button>
            ` : `
            <p style="font-size:.88rem;color:var(--text-muted);text-align:center;margin-bottom:1rem">${T('det_login_hint')}</p>
            <button class="btn btn-primary" style="width:100%;padding:.7rem" onclick="openModal('login')">${T('det_login')}</button>
            `}
            <div style="margin-top:1rem;font-size:.8rem;color:var(--text-muted);text-align:center">
              👁 ${p.views || 0} ${unit(p.views || 0, 'u_view')} ·
              ${T('det_published')} ${new Date(p.created_at).toLocaleDateString('fr-DZ')}${p.status === 'active' && p.last_confirmed_at
                ? `<br>✔ ${T('det_confirmed')} ${new Date(p.last_confirmed_at).toLocaleDateString('fr-DZ')}` : ''}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.75rem">
              ${navigator.share ? `<button class="btn btn-outline btn-sm" style="flex:1;min-width:calc(50% - .25rem)" data-id="${p.id}" data-title="${esc(p.title)}" data-price="${Number(p.price)||0}" onclick="shareNative(this)">${T('share_native')}</button>` : ''}
              <button class="btn btn-outline btn-sm" style="flex:1;min-width:calc(50% - .25rem);display:flex;align-items:center;justify-content:center;gap:.4rem" data-title="${esc(p.title)}" onclick="shareWhatsApp(${p.id}, this.dataset.title, ${Number(p.price) || 0})">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                WhatsApp
              </button>
              <button class="btn btn-outline btn-sm" style="flex:1;min-width:calc(50% - .25rem)" onclick="copyPropertyLink(${p.id})">${T('det_copy')}</button>
              <button class="btn btn-outline btn-sm" style="flex:1;min-width:calc(50% - .25rem)" data-id="${p.id}" data-title="${esc(p.title)}" onclick="shareProperty('facebook',this)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="#1877F2" style="vertical-align:middle;margin-inline-end:.3rem"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.025 1.791-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
                Facebook
              </button>
              <button class="btn btn-outline btn-sm" style="flex:1;min-width:calc(50% - .25rem)" data-id="${p.id}" data-title="${esc(p.title)}" onclick="shareProperty('x',this)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-inline-end:.3rem"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.258 5.629zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                𝕏
              </button>
            </div>
            <a class="btn btn-outline btn-sm print-link" href="${esc(annonceUrl(p.id, p.title))}/fiche" target="_blank" rel="noopener">${T('det_print')}</a>
            ${p.status === 'active' && !(currentUser && currentUser.id === p.owner_id) ? `
            <button class="btn btn-outline btn-sm" style="width:100%;margin-top:.5rem;border-style:dashed;color:var(--text-muted)" data-id="${Number(p.id) || 0}" onclick="openReport(this.dataset.id)">🚩 ${T('rp_btn')}</button>` : ''}
          </div>
        </div>
      </div>`;

    container.classList.toggle('has-qc', !!container.querySelector('.quick-contact'));
    document.body.classList.toggle('qc-on', !!container.querySelector('.quick-contact'));   // le comparateur se pose au-dessus

    // Gestion des champs conditionnels
    const ctype = document.getElementById('ctype-' + p.id);
    if (ctype) ctype.addEventListener('change', () => {
      document.getElementById('visit-field-' + p.id).classList.toggle('hidden', ctype.value !== 'visite');
      document.getElementById('offer-field-' + p.id).classList.toggle('hidden', ctype.value !== 'offre');
    });

    // Historique des prix + simulateur de crédit + annonces similaires
    loadPriceHistory(p.id, p.price);
    if (p.mode === 'vente') loadCalcCredit(p.id, Number(p.price));
    loadSimilarProperties(p.id);
  } catch (e) { container.innerHTML = `<p style="color:red;padding:2rem">${e.message}</p>`; }
}

async function loadPriceHistory(id, currentPrice) {
  try {
    const history = await api('/properties/' + id + '/price-history');
    if (!history.length || history.length < 2) return;
    const container = document.getElementById('detail-content');
    if (!container) return;

    // Construire le graphique SVG ligne
    const W = 480, H = 100, pad = { t:14, b:22, l:60, r:10 };
    const prices = history.map(h => Number(h.price));
    const minP = Math.min(...prices), maxP = Math.max(...prices);
    const rangeP = maxP - minP || 1;
    const n = history.length;

    const px = (i) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
    const py = (v) => pad.t + (1 - (v - minP) / rangeP) * (H - pad.t - pad.b);

    const pts = history.map((h, i) => `${px(i).toFixed(1)},${py(Number(h.price)).toFixed(1)}`).join(' ');
    const area = `M${px(0).toFixed(1)},${H - pad.b} ` +
      history.map((h, i) => `L${px(i).toFixed(1)},${py(Number(h.price)).toFixed(1)}`).join(' ') +
      ` L${px(n-1).toFixed(1)},${H - pad.b} Z`;

    const diff = prices[prices.length - 1] - prices[0];
    const pct  = prices[0] ? ((diff / prices[0]) * 100).toFixed(1) : 0;
    const trend = diff > 0 ? `<span style="color:#ef4444">▲ +${pct}%</span>`
                : diff < 0 ? `<span style="color:var(--primary-text)">▼ ${pct}%</span>`
                : `<span style="color:var(--text-muted)">→ ${T('det_stable')}</span>`;

    const labels = history.map((h, i) => {
      const d = new Date(h.changed_at);
      const lbl = d.toLocaleDateString('fr-DZ', { day:'2-digit', month:'short' });
      return `<text x="${px(i).toFixed(1)}" y="${H - 6}" text-anchor="${i===0?'start':i===n-1?'end':'middle'}" font-size="9" fill="currentColor" opacity=".6">${lbl}</text>`;
    });
    const yLabels = [minP, maxP].map(v => {
      const y = py(v);
      return `<text x="${pad.l - 4}" y="${y + 4}" text-anchor="end" font-size="9" fill="currentColor" opacity=".65">${(v/1000000).toFixed(1)}M</text>
              <line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--border)" stroke-width=".5" stroke-dasharray="3,3"/>`;
    });

    const section = document.createElement('div');
    section.style.cssText = 'margin-top:1.5rem';
    section.innerHTML = `
      <h3 style="font-size:1rem;font-weight:700;margin-bottom:.5rem">${T('det_price_hist')} <small style="font-weight:400;color:var(--text-muted)">${trend}</small></h3>
      <div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:.75rem;box-shadow:var(--shadow)">
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;color:var(--text);overflow:visible">
          <defs>
            <linearGradient id="pg${id}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#0C6E4F" stop-opacity=".3"/>
              <stop offset="100%" stop-color="#0C6E4F" stop-opacity="0"/>
            </linearGradient>
          </defs>
          ${yLabels.join('')}
          <path d="${area}" fill="url(#pg${id})"/>
          <polyline points="${pts}" fill="none" stroke="#0C6E4F" stroke-width="2" stroke-linejoin="round"/>
          ${history.map((h, i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(Number(h.price)).toFixed(1)}" r="3" fill="#0C6E4F"/>`).join('')}
          ${labels.join('')}
        </svg>
      </div>`;
    container.querySelector('.detail-body')?.parentElement?.insertBefore(section, container.querySelector('.detail-body'));
  } catch {}
}

async function loadSimilarProperties(id) {
  const container = document.getElementById('detail-content');
  if (!container) return;
  try {
    const similar = await api('/properties/' + id + '/similar');
    if (!similar.length) return;
    const section = document.createElement('div');
    section.style.cssText = 'margin-top:2.5rem';
    section.innerHTML = `<h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem">${T('det_similar')}</h3>
      <div class="grid">${similar.map(p => cardHTML(p)).join('')}</div>`;
    container.appendChild(section);
  } catch {}
}

async function submitContact(event, propertyId, ownerId) {
  event.preventDefault();
  if (!token) { openModal('login'); return false; }
  const type    = document.getElementById('ctype-' + propertyId)?.value;
  const message = document.getElementById('cmsg-' + propertyId)?.value;
  const visitDate   = document.getElementById('cdate-' + propertyId)?.value;
  const visitTime   = document.getElementById('ctime-' + propertyId)?.value;
  const offerAmount = document.getElementById('coffer-' + propertyId)?.value;
  try {
    await api('/contacts', 'POST', { property_id: propertyId, type, message, visit_date: visitDate || null, visit_time: visitTime || null, offer_amount: offerAmount || null });
    toast(T('det_sent'));
  } catch (e) { toast('❌ ' + e.message); }
  return false;
}

// ── Simulateurs ───────────────────────────────────────────────────────────────
function fmtDZD(n) {
  return Math.round(n).toLocaleString('fr-DZ') + ' DZD';
}

const SIM_RESULT_STYLE = 'display:none;background:linear-gradient(135deg,rgba(34,197,94,.09),rgba(34,197,94,.03));border:1.5px solid rgba(34,197,94,.35);border-radius:10px;padding:1.25rem;margin-top:1rem';

function calcPrixM2() {
  const price = parseFloat(document.getElementById('sp1-price').value);
  const surf  = parseFloat(document.getElementById('sp1-surf').value);
  const res   = document.getElementById('sp1-res');
  if (!price || !surf) { res.style.display = 'none'; return; }
  const pm2 = price / surf;
  res.innerHTML = `<div style="font-size:1.8rem;font-weight:900;color:var(--primary-text)">${fmtDZD(pm2)}<span style="font-size:1rem;font-weight:500"> /${T('sp_res_pm2') || 'm²'}</span></div>
    <div style="color:var(--text-secondary);font-size:.88rem;margin-top:.4rem">${T('sp_res_pour')} ${surf} m² · ${fmtDZD(price)}</div>`;
  res.style.display = 'block';
}

function calcPrixTotal() {
  const pm2  = parseFloat(document.getElementById('sp2-pm2').value);
  const surf = parseFloat(document.getElementById('sp2-surf').value);
  const res  = document.getElementById('sp2-res');
  if (!pm2 || !surf) { res.style.display = 'none'; return; }
  const total = pm2 * surf;
  res.innerHTML = `<div style="font-size:1.8rem;font-weight:900;color:var(--primary-text)">${fmtDZD(total)}</div>
    <div style="color:var(--text-secondary);font-size:.88rem;margin-top:.4rem">${surf} m² × ${fmtDZD(pm2)}/m²</div>`;
  res.style.display = 'block';
}

function initSeWilayaSelect() {
  const sel = document.getElementById('se-wilaya');
  if (!sel || sel.options.length > 1) return;
  WILAYAS.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w; opt.textContent = w;
    sel.appendChild(opt);
  });
}

async function calcEstimation() {
  const type   = document.getElementById('se-type').value;
  const wilaya = document.getElementById('se-wilaya').value;
  const surf   = parseFloat(document.getElementById('se-surf').value);
  const rooms  = document.getElementById('se-rooms').value;
  const mode   = document.getElementById('se-mode').value;
  const res    = document.getElementById('se-res');

  if (!mode) {
    res.innerHTML = `<div style="text-align:center;font-size:.9rem;padding:.5rem">${T('se_need_mode')}</div>`;
    res.style.display = 'block';
    return;
  }

  res.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:.5rem">${T('loading')}</div>`;
  res.style.display = 'block';

  try {
    const params = new URLSearchParams({ type_bien: type, mode });
    if (wilaya) params.set('wilaya', wilaya);
    if (rooms)  params.set('rooms', rooms);

    const data = await api(`/properties/estimation?${params}`);

    if (!data.count || data.avg_pm2 == null) {
      res.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:.9rem">${T('se_no_data')}</div>`;
      return;
    }

    const sourceLabel = data.scope === 'wilaya'
      ? `📊 ${data.count} ${T('se_source_wilaya')} <strong>${wilaya}</strong>`
      : `📊 ${data.count} ${T('se_source_national')}`;

    const p25 = data.p25_pm2 || data.avg_pm2;
    const p75 = data.p75_pm2 || data.avg_pm2;

    let totalHtml = '';
    if (surf > 0) {
      totalHtml = `
        <div style="border-top:1.5px solid rgba(34,197,94,.3);margin-top:.85rem;padding-top:.85rem">
          <div style="font-size:.78rem;color:var(--text-muted);text-align:center;margin-bottom:.5rem">${T('se_est_total')} ${surf} m²</div>
          <div style="display:flex;gap:.5rem;justify-content:space-around;flex-wrap:wrap;text-align:center">
            <div><div style="font-size:.72rem;color:var(--text-muted)">${T('se_res_min')}</div><div style="font-weight:700">${fmtDZD(p25 * surf)}</div></div>
            <div><div style="font-size:.72rem;color:var(--text-muted)">${T('se_res_mid')}</div><div style="font-size:1.2rem;font-weight:900;color:var(--primary-text)">${fmtDZD(data.avg_pm2 * surf)}</div></div>
            <div><div style="font-size:.72rem;color:var(--text-muted)">${T('se_res_max')}</div><div style="font-weight:700">${fmtDZD(p75 * surf)}</div></div>
          </div>
        </div>`;
    }

    res.innerHTML = `
      <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.85rem;text-align:center">${sourceLabel}</div>
      <div style="font-size:.78rem;color:var(--text-muted);text-align:center;margin-bottom:.5rem">${T('se_res_range')} (DZD/m²)</div>
      <div style="display:flex;gap:.5rem;justify-content:space-around;flex-wrap:wrap;text-align:center">
        <div><div style="font-size:.72rem;color:var(--text-muted)">${T('se_res_min')}</div><div style="font-weight:700">${fmtDZD(p25)}/m²</div></div>
        <div><div style="font-size:.72rem;color:var(--text-muted)">${T('se_res_mid')}</div><div style="font-size:1.25rem;font-weight:900;color:var(--primary-text)">${fmtDZD(data.avg_pm2)}/m²</div></div>
        <div><div style="font-size:.72rem;color:var(--text-muted)">${T('se_res_max')}</div><div style="font-weight:700">${fmtDZD(p75)}/m²</div></div>
      </div>
      ${totalHtml}`;
  } catch (e) {
    res.innerHTML = `<div style="text-align:center;color:var(--text-muted)">${T('se_no_data')}</div>`;
  }
}

function calcNotaire() {
  const price = parseFloat(document.getElementById('sn-price').value);
  const zone  = document.getElementById('sn-zone').value;
  const res   = document.getElementById('sn-res');
  if (!price || price <= 0) { res.style.display = 'none'; return; }
  const tEnreg = price * (zone === 'rural' ? 0.02 : 0.03);
  const tPub   = price * 0.01;
  let hon = 0;
  const tranches = [[500000,0.03],[2000000,0.02],[10000000,0.01],[Infinity,0.005]];
  let reste = price, prev = 0;
  for (const [limit, rate] of tranches) {
    const slice = Math.min(reste, limit - prev);
    hon += slice * rate;
    reste -= slice; prev = limit;
    if (reste <= 0) break;
  }
  const divers = 15000;
  const total  = tEnreg + tPub + hon + divers;
  const pct    = (total / price * 100).toFixed(2);
  const td = (a, b, bold) => `<tr><td style="padding:.4rem 0;color:var(--text-secondary)">${a}</td><td style="text-align:right;font-weight:${bold?'800':'600'};${bold?'font-size:1.05rem;color:var(--primary-text)':''}">${b}</td></tr>`;
  res.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.9rem">
    ${td(`${T('sn_enreg')} (${zone === 'rural' ? '2' : '3'}%)`, fmtDZD(tEnreg))}
    ${td(`${T('sn_pub')} (1%)`,   fmtDZD(tPub))}
    ${td(T('sn_hon'),   fmtDZD(hon))}
    ${td(T('sn_divers'),fmtDZD(divers))}
    <tr style="border-top:2px solid var(--border)">${td(T('sn_total'), fmtDZD(total), true)}</tr>
  </table>
  <div style="color:var(--text-muted);font-size:.78rem;margin-top:.5rem;text-align:center">${pct}% ${T('sn_pct_label')}</div>`;
  res.style.display = 'block';
}

function calcCredit() {
  const P     = parseFloat(document.getElementById('sc-montant').value);
  const years = parseFloat(document.getElementById('sc-duree').value);
  const rate  = parseFloat(document.getElementById('sc-taux').value);
  const res   = document.getElementById('sc-res');
  if (!P || !years || rate == null || isNaN(rate)) { res.style.display = 'none'; return; }
  const n = years * 12;
  const r = rate / 100 / 12;
  const M = r === 0 ? P / n : P * r * Math.pow(1+r,n) / (Math.pow(1+r,n) - 1);
  const total = M * n;
  const interets = total - P;
  const td = (a, b, bold) => `<tr><td style="padding:.35rem 0;color:var(--text-secondary)">${a}</td><td style="text-align:right;font-weight:${bold?'900':'600'};${bold?'color:var(--primary-text)':''}">${b}</td></tr>`;
  res.innerHTML = `
    <div style="text-align:center;margin-bottom:1rem">
      <div style="font-size:.82rem;color:var(--text-muted)">${T('sc_res_mensualite')}</div>
      <div style="font-size:2rem;font-weight:900;color:var(--primary-text)">${fmtDZD(M)}</div>
      <div style="font-size:.78rem;color:var(--text-muted)">${T('sc_res_par_mois')}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:.9rem;border-top:1.5px solid var(--border)">
      ${td(T('sc_montant_emprunte'), fmtDZD(P))}
      ${td(T('sc_interets'), fmtDZD(interets))}
      <tr style="border-top:2px solid var(--border)">${td(T('sc_total'), fmtDZD(total), true)}</tr>
    </table>`;
  res.style.display = 'block';
}

function calcRentabilite() {
  const prix    = parseFloat(document.getElementById('sr-prix')?.value)    || 0;
  const frais   = parseFloat(document.getElementById('sr-frais')?.value)   ?? 7;
  const credit  = parseFloat(document.getElementById('sr-credit')?.value)  || 0;
  const loyer   = parseFloat(document.getElementById('sr-loyer')?.value)   || 0;
  const charges = parseFloat(document.getElementById('sr-charges')?.value) || 0;
  const vacance = parseFloat(document.getElementById('sr-vacance')?.value) ?? 5;
  const res     = document.getElementById('sr-res');
  if (!prix || !loyer) { res.style.display = 'none'; return; }

  const coutTotal     = prix * (1 + frais / 100);
  const loyerBrut     = loyer * 12;
  const loyerEffectif = loyerBrut * (1 - vacance / 100);
  const revenuNet     = loyerEffectif - charges;
  const rdtBrut       = (loyerBrut / coutTotal) * 100;
  const rdtNet        = (revenuNet  / coutTotal) * 100;
  const cashflow      = revenuNet / 12 - credit;
  const recuperation  = revenuNet > 0 ? coutTotal / revenuNet : null;

  // Notation couleur selon rendement net
  const [noteKey, noteColor] =
    rdtNet >= 7 ? ['sr_note_excellent', '#22c55e'] :
    rdtNet >= 5 ? ['sr_note_bon',       '#f59e0b'] :
    rdtNet >= 3 ? ['sr_note_moyen',     '#f97316'] :
                  ['sr_note_faible',    '#ef4444'];

  const tdRow = (label, value, bold, color) =>
    `<tr>
       <td style="padding:.38rem 0;color:var(--text-secondary);font-size:.88rem">${label}</td>
       <td style="text-align:right;font-weight:${bold?'900':'600'};${color?`color:${color}`:''}">
         ${value}
       </td>
     </tr>`;

  const pct = n => n.toFixed(2).replace('.', ',') + ' %';

  res.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(34,197,94,.09),rgba(34,197,94,.03));border:1.5px solid rgba(34,197,94,.35);border-radius:10px;padding:1.25rem;margin-bottom:1rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">
        <div>
          <div style="font-size:.78rem;color:var(--text-muted);font-weight:600">${T('sr_rdt_net')}</div>
          <div style="font-size:2.4rem;font-weight:900;color:${noteColor};line-height:1">${pct(rdtNet)}</div>
        </div>
        <div style="background:${noteColor}22;border:1.5px solid ${noteColor}66;border-radius:8px;padding:.4rem .8rem;font-size:.82rem;font-weight:700;color:${noteColor}">
          ${T(noteKey)}
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;border-top:1.5px solid var(--border)">
        ${tdRow(T('sr_cout_total'),    fmtDZD(coutTotal))}
        ${tdRow(T('sr_loyer_brut'),    fmtDZD(loyerBrut))}
        ${tdRow(T('sr_rdt_brut'),      pct(rdtBrut))}
        ${tdRow(T('sr_revenu_net'),    fmtDZD(revenuNet))}
        <tr style="border-top:2px solid var(--border)">
          ${tdRow(T('sr_rdt_net'),     pct(rdtNet), true, noteColor).replace('<tr>','').replace('</tr>','')}
        </tr>
        <tr style="border-top:2px solid var(--border)">
          ${tdRow(T('sr_cashflow'), `<span style="color:${cashflow>=0?'#22c55e':'#ef4444'}">${fmtDZD(cashflow)}</span>`, true).replace('<tr>','').replace('</tr>','')}
        </tr>
        ${recuperation ? tdRow(T('sr_recuperation'), recuperation.toFixed(1).replace('.',',') + ' ans') : ''}
      </table>
    </div>`;
  res.style.display = 'block';
}

async function submitContactPage(event) {
  event.preventDefault();
  const name    = document.getElementById('cp-name').value.trim();
  const email   = document.getElementById('cp-email').value.trim();
  const subject = document.getElementById('cp-subject').value;
  const message = document.getElementById('cp-message').value.trim();
  try {
    const cf_turnstile_response = await captchaToken();
    await api('/contact', 'POST', { name, email, subject, message, cf_turnstile_response });
    toast(T('ct_sent'));
    event.target.reset();
  } catch (e) { toast('❌ ' + (e.message || T('ct_failed'))); }   // échec : on le dit, et le texte saisi reste dans le formulaire
  return false;
}

// ── Newsletter : inscription (pied de page) et liens des emails ──────────────────
// L'inscription n'est valable qu'après le clic sur le lien de l’email de confirmation ; la réponse est la même que l'adresse soit
// nouvelle ou déjà connue (rien n'est révélé sur les inscrits).
async function newsletterSubscribe(event) {
  event.preventDefault();
  const input = document.getElementById('nl-email');
  try {
    const cf_turnstile_response = await captchaToken();
    await api('/newsletter/subscribe', 'POST', { email: input.value.trim(), lang: currentLang, cf_turnstile_response });
    toast(T('nl_sent'));
    event.target.reset();
  } catch (e) { toast('❌ ' + (e.message || T('nl_failed'))); }
  return false;
}

// Lien reçu par email (/newsletter/confirmation ou /newsletter/desinscription, ?e=&t=) : identifiant et jeton sont gardés en mémoire
// puis effacés de la barre d'adresse (showPage réécrit l'URL). Ni l'un ni l'autre ne s'exécute à l'ouverture : c'est le bouton qui agit,
// pour qu'un robot ou un antivirus de messagerie qui suit le lien ne confirme ni ne désabonne personne.
let _nlLink = null;

function newsletterState(kind, state) {
  const key = state === 'bad' ? 'nl_bad' : 'nl_' + kind + '_' + state;
  const set = (id, k) => { const el = document.getElementById(id); el.dataset.i18n = k; el.textContent = T(k); };
  set('nl-page-title', key + '_title');
  set('nl-page-msg', key + '_msg');
  document.getElementById('nl-page-icon').textContent = state === 'bad' ? '⚠️' : state === 'done' ? '✅' : '📧';
  const btn = document.getElementById('nl-page-btn');
  btn.classList.toggle('hidden', state !== 'ask');
  if (state === 'ask') { btn.dataset.i18n = key + '_btn'; btn.textContent = T(key + '_btn'); btn.disabled = false; }
}

function showNewsletterLink(kind, params) {
  const e = params.get('e') || '', t = params.get('t') || '';
  _nlLink = /^\d{1,10}$/.test(e) && /^[0-9a-f]{40}$/.test(t) ? { kind, e, t } : null;
  showPage('newsletter');
  newsletterState(kind, _nlLink ? 'ask' : 'bad');
}

async function newsletterAct() {
  if (!_nlLink) return;
  const { kind, e, t } = _nlLink, btn = document.getElementById('nl-page-btn');
  btn.disabled = true;
  try {
    await api('/newsletter/' + (kind === 'confirm' ? 'confirm' : 'unsubscribe'), 'POST', { e, t });
    _nlLink = null;
    newsletterState(kind, 'done');
  } catch (err) {
    if (err.status === 400) { _nlLink = null; newsletterState(kind, 'bad'); }   // lien périmé : inutile de réessayer
    else { btn.disabled = false; toast('❌ ' + err.message); }
  }
}

function openChat(propertyId, ownerId) {
  if (!token) { openModal('login'); return; }
  showPage('messages');
  currentChatProperty = propertyId;
  currentChatUser     = ownerId;
  setTimeout(() => loadThread(propertyId, ownerId), 300);
}

// Génère et télécharge un CSV côté client
function exportCSV(rows, filename) {
  if (!rows || !rows.length) { toast('Aucune donnée à exporter.'); return; }
  const keys = Object.keys(rows[0]);
  const escape = v => (v === null || v === undefined) ? '' : `"${String(v).replace(/"/g, '""')}"`;
  const csv = [keys.join(','), ...rows.map(r => keys.map(k => escape(r[k])).join(','))].join('\r\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + csv);
  a.download = filename; a.click();
}

// ── Lightbox ──────────────────────────────────────
let _lbPhotos = [], _lbIdx = 0;

function openLightbox(photos, idx) {
  _lbPhotos = photos; _lbIdx = idx;
  lbRender();
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
}

function lbBackdropClick(e) {
  if (e.target === document.getElementById('lightbox')) closeLightbox();
}

function lbGo(dir) {
  _lbIdx = (_lbIdx + dir + _lbPhotos.length) % _lbPhotos.length;
  lbRender();
}

function lbRender() {
  const img = document.getElementById('lb-img');
  const big = _lbPhotos[_lbIdx] || '';
  img.src = window.innerWidth <= 900 ? thumbUrl(big, 960) : big;   // petit écran : 960 px suffisent (l'original fait jusqu'à 1920 px)
  document.getElementById('lb-counter').textContent = `${_lbIdx + 1} / ${_lbPhotos.length}`;
  document.getElementById('lb-prev').style.display = _lbPhotos.length > 1 ? '' : 'none';
  document.getElementById('lb-next').style.display = _lbPhotos.length > 1 ? '' : 'none';
  const tc = document.getElementById('lb-thumbs');
  tc.innerHTML = _lbPhotos.map((src, i) =>
    `<img src="${esc(thumbUrl(src, 480))}" class="${i === _lbIdx ? 'active' : ''}" onclick="lbGoTo(${i})" alt="Photo ${i+1}" loading="lazy">`
  ).join('');
}

function lbGoTo(i) { _lbIdx = i; lbRender(); }

document.addEventListener('keydown', e => {
  const lb = document.getElementById('lightbox');
  if (!lb.classList.contains('open')) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); lbGo(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); lbGo(1); }
  if (e.key === 'Escape')     closeLightbox();
});

// ── Comparateur ────────────────────────────────────
const _compareList = [];  // max 3 objets {id, title, price, image, ...}
window._propCache = {};   // id → objet bien (peuplé par renderGrid/cardHTML)
const _statsCache  = {};  // id → stats 30j (peuplé par showPropertyStats pour l'export CSV)

function toggleCompare(id) {
  const p = window._propCache[id];
  if (!p) return;
  const idx = _compareList.findIndex(x => x.id === id);
  if (idx !== -1) {
    _compareList.splice(idx, 1);
  } else {
    if (_compareList.length >= 3) { toast(T('cmp_max')); return; }
    _compareList.push(p);
  }
  updateCompareBar();
  // mise à jour visuelle du bouton
  const btn = document.querySelector(`.card-cmp[data-id="${id}"]`);
  if (btn) btn.classList.toggle('active', _compareList.some(x => x.id === id));
}

function clearCompare() {
  _compareList.length = 0;
  updateCompareBar();
  document.querySelectorAll('.card-cmp.active').forEach(b => b.classList.remove('active'));
}

function updateCompareBar() {
  const bar = document.getElementById('compare-bar');
  const tc  = document.getElementById('compare-thumbs');
  document.body.classList.toggle('cmp-on', _compareList.length > 0);   // marge basse de la page (mobile)
  if (!_compareList.length) { bar.classList.remove('visible'); return; }
  bar.classList.add('visible');
  tc.innerHTML = _compareList.map(p => `
    <div class="cmp-thumb" title="${esc(p.title)}">
      <img src="${esc(thumbUrl(p.image, 480) || '')}" alt="" loading="lazy" onerror="this.style.display='none'">
      <span>${esc(p.title)}</span>
      <button class="cmp-rm" onclick="toggleCompare(${p.id})" title="${T('cmp_remove')}" aria-label="${T('cmp_remove')} : ${esc(p.title)}">✕</button>
    </div>`).join('');
}

function openCompare() {
  if (_compareList.length < 2) { toast(T('cmp_min')); return; }
  const ROWS = [
    [T('cmp_r_price'),               p => priceText(p)],
    // Les cellules partent dans innerHTML : tout texte issu des données est échappé
    [T('filter_type'),               p => esc(TYPES[p.type_bien] || p.type_bien)],
    [T('filter_mode'),               p => esc(MODES[p.mode] || p.mode)],
    [T('filter_wilaya'),             p => esc(wilayaName(p.wilaya) || '—')],
    [T('cmp_r_commune'),             p => esc(p.commune || '—')],
    [T('cmp_r_surface'),             p => p.surface_m2 ? p.surface_m2 + ' ' + T('u_m2') : '—'],
    [capFirst(T('u_room_many')),     p => p.rooms || '—'],
    [T('u_bath_one'),                p => p.baths || '—'],
    [T('cmp_r_floor'),               p => p.floor !== null && p.floor !== undefined ? p.floor : '—'],
    [capFirst(T('u_view_many')),     p => p.views || 0],
    [T('cmp_r_published'),           p => new Date(p.created_at).toLocaleDateString('fr-DZ')],
    [T('cmp_r_verified'),            p => p.verified ? '✅' : '—'],
  ];
  const cols = _compareList;
  const tbl  = document.getElementById('compare-table');
  tbl.innerHTML = `
    <thead>
      <tr>
        <th></th>
        ${cols.map(p => `<th>
          <img class="cmp-prop-img" src="${esc(thumbUrl(p.image, 480) || '')}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div style="font-size:.83rem;font-weight:700;margin:.35rem 0 .15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.title)}">${esc(p.title)}</div>
          <button class="btn btn-primary btn-sm" style="font-size:.77rem" onclick="showPage('detail',${p.id});closeCompare()">${T('cmp_view')}</button>
        </th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${ROWS.map(([label, fn]) => `
        <tr>
          <td>${label}</td>
          ${cols.map(p => `<td>${fn(p)}</td>`).join('')}
        </tr>`).join('')}
    </tbody>`;
  document.getElementById('compare-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCompare() {
  document.getElementById('compare-modal').classList.remove('open');
  document.body.style.overflow = '';
}

function cmpBackdrop(e) {
  if (e.target === document.getElementById('compare-modal')) closeCompare();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('compare-modal').classList.contains('open')) closeCompare();
});

// Indicatifs pays courants (diaspora, pays voisins) : ils servent seulement à écrire « +33 612 345 678 » lisiblement
const COUNTRY_CODES = ['1', '7', '20', '31', '32', '33', '34', '39', '41', '44', '46', '47', '49', '90', '212', '216', '218',
  '351', '352', '353', '961', '962', '966', '971', '974'];

// Numéro saisi librement → { intl: '213555123456', national: '0555 12 34 56', mobile: true } ; null si inexploitable.
//  · Algérie (0555 12 34 56, +213 555…, 00213…, fixe 021 12 34 56) : mobile 05 / 06 / 07 → WhatsApp proposé ; ligne fixe → appel seul.
//  · Étranger : uniquement avec « + » ou « 00 » et l'indicatif du pays (+33 6 12 34 56 78) ; 8 à 15 chiffres. On ne sait pas si
//    c'est un mobile (mobile: null) : Appeler et WhatsApp sont proposés (WhatsApp prévient si le numéro n'y est pas inscrit).
//  · Sans « + » ni « 00 », un numéro commençant par 0 est lu comme algérien (0612 34 56 78 = mobile algérien).
function parsePhone(raw) {
  // « +33 (0)6… » : le 0 entre parenthèses ne se compose pas depuis l'étranger
  let d = String(raw || '').replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  const international = d.startsWith('+') || d.startsWith('00');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '213' + d.slice(1);

  if (d.startsWith('213')) {
    let n = d.slice(3);
    if (n.startsWith('0')) n = n.slice(1);               // « +213 0555… » : 0 de trop
    const mobile = /^[567]\d{8}$/.test(n);
    if (!mobile && !/^[2-4]\d{7}$/.test(n)) return null;
    const pairs = t => t.match(/\d{2}/g).join(' ');
    return { intl: '213' + n, mobile,
      national: mobile ? '0' + n.slice(0, 3) + ' ' + pairs(n.slice(3)) : '0' + n.slice(0, 2) + ' ' + pairs(n.slice(2)) };
  }

  if (!international || !/^[1-9]\d{7,14}$/.test(d)) return null;
  // Groupes de 3 chiffres, sans jamais finir sur un chiffre isolé (…519 9 → …51 99)
  const groups = t => {
    const g = t.match(/\d{1,3}/g);
    if (g.length > 1 && g[g.length - 1].length === 1) { const last = g.pop(), prev = g.pop(); g.push(prev.slice(0, 2), prev.slice(2) + last); }
    return g.join(' ');
  };
  const cc = COUNTRY_CODES.filter(c => d.startsWith(c)).sort((x, y) => y.length - x.length)[0];
  const rest = cc ? d.slice(cc.length) : '';
  const shown = !cc ? '+' + groups(d)
    : (cc === '1' && rest.length === 10) ? `+1 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`   // Amérique du Nord : 514 555 0199
    : '+' + cc + ' ' + groups(rest);
  return { intl: d, mobile: null, national: shown };
}

// Compte le clic (anonyme, dédoublonné par le serveur) ; ne doit jamais retarder ni empêcher l'appel
function trackContact(id, channel) {
  try {
    fetch(API + '/properties/' + id + '/click', { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) }).catch(() => {});
  } catch { /* compteur facultatif */ }
}

// Boutons « Appeler » et « WhatsApp » de la fiche : annonce active seulement, jamais pour son propre annonceur.
// Numéro de l'agence pour une annonce d'agence, sinon celui du propriétaire.
function quickContactHTML(p) {
  if (p.status !== 'active' || (currentUser && currentUser.id === p.owner_id)) return '';
  const ph = parsePhone(p.agency_phone) || parsePhone(p.owner_phone);
  if (!ph) return '';
  const text = T('det_wa_msg').replace('{title}', p.title).replace('{url}', annonceUrl(p.id, p.title));
  const wa = ph.mobile !== false   // ligne fixe algérienne : pas de WhatsApp
    ? `<a class="qc-wa" href="https://wa.me/${ph.intl}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener" onclick="trackContact(${p.id},'whatsapp')">
         <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.004 2C6.48 2 2 6.478 2 12c0 1.762.46 3.42 1.264 4.856L2 22l5.297-1.24A9.96 9.96 0 0 0 12.004 22C17.523 22 22 17.522 22 12S17.523 2 12.004 2zm0 18.2a8.19 8.19 0 0 1-4.18-1.145l-.3-.178-3.144.736.77-3.06-.195-.314A8.16 8.16 0 0 1 3.8 12c0-4.518 3.68-8.2 8.204-8.2 4.52 0 8.196 3.682 8.196 8.2 0 4.52-3.676 8.2-8.196 8.2z"/></svg>
         ${T('det_whatsapp')}</a>` : '';
  return `<div class="quick-contact">
    <a class="qc-call" href="tel:+${ph.intl}" onclick="trackContact(${p.id},'call')" aria-label="${T('det_call')} ${ph.national}">📞 ${T('det_call')} <span class="qc-num">${ph.national}</span></a>${wa}
  </div>`;
}

function shareWhatsApp(id, title, price) {
  const url  = annonceUrl(id, title);
  const text = `🏠 ${title} — ${formatPrice(price)} DZD\n${url}`;
  window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

function shareProperty(network, btn) {
  const id    = Number(btn.dataset.id);
  const title = btn.dataset.title;
  const url   = encodeURIComponent(location.origin + '/annonce/' + id);
  const text  = encodeURIComponent('🏠 ' + title);
  if (network === 'facebook')
    window.open('https://www.facebook.com/sharer/sharer.php?u=' + url, '_blank', 'noopener');
  else if (network === 'x')
    window.open('https://x.com/intent/tweet?text=' + text + '&url=' + url, '_blank', 'noopener');
}

function copyPropertyLink(id) {
  // Sur la fiche, l'URL courante est déjà l'URL propre /annonce/id-slug
  const url = routePath().startsWith('/annonce/') ? location.origin + location.pathname : annonceUrl(id, '');
  navigator.clipboard.writeText(url).then(() => toast(T('link_copied'))).catch(() => {
    const el = document.createElement('textarea');
    el.value = url; document.body.appendChild(el); el.select();
    document.execCommand('copy'); document.body.removeChild(el);
    toast(T('link_copied'));
  });
}

function shareNative(btn) {
  const id    = Number(btn.dataset.id);
  const title = btn.dataset.title;
  const url   = location.origin + '/annonce/' + id;
  navigator.share({ title, text: '🏠 ' + title + ' — DzImmo', url }).catch(() => {});
}

function showVendeur(event, id) {
  event.preventDefault();
  showPage('vendeur', Number(id));
  return false;
}

async function loadVendeur(id) {
  const container = document.getElementById('vendeur-content');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  history.replaceState(null, '', langPath('/vendeur/' + id));
  document.title = T('site_title');
  try {
    const [u, propsRes] = await Promise.all([
      api('/auth/users/' + id),
      api('/properties/user/' + id + '?limit=6'),
    ]);
    const since = new Date(u.created_at).toLocaleDateString(T('site_title').startsWith('Dz') ? 'fr-DZ' : 'ar-DZ', { year: 'numeric', month: 'long' });
    const avatarLetter = (u.name || '?')[0].toUpperCase();
    const avatarHTML = u.avatar
      ? `<img src="${esc(u.avatar)}" alt="" style="width:80px;height:80px;border-radius:50%;object-fit:cover">`
      : `<div style="width:80px;height:80px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700">${esc(avatarLetter)}</div>`;
    const verif = u.verified_kind === 'business'
      ? `<span style="color:var(--primary-text);font-size:.85rem">✓ ${T('adv_business')}</span>`
      : u.verified_kind === 'identity'
      ? `<span style="color:var(--primary-text);font-size:.85rem">✓ ${T('adv_identity')}</span>`
      : '';
    const props = Array.isArray(propsRes) ? propsRes : (propsRes.data || []);
    const listingsHTML = props.length
      ? `<div class="grid">${props.map(p => cardHTML(p)).join('')}</div>`
      : `<p style="color:var(--text-muted)">${T('vd_no_listings')}</p>`;
    container.innerHTML = `
      <div style="background:var(--white);border-radius:14px;padding:1.5rem;box-shadow:var(--shadow);max-width:700px;margin:0 auto 1.5rem">
        <div style="display:flex;align-items:center;gap:1.2rem;margin-bottom:1rem">
          ${avatarHTML}
          <div>
            <div style="font-size:1.3rem;font-weight:800">${esc(u.name)}</div>
            ${verif}
            <div style="font-size:.83rem;color:var(--text-muted);margin-top:.3rem">${T('vd_member_since')} ${esc(since)}</div>
            <div style="font-size:.83rem;color:var(--text-muted)">${u.property_count} ${T('vd_listings')}</div>
          </div>
        </div>
        ${u.bio ? `<p style="font-size:.9rem;color:var(--text-secondary);white-space:pre-line">${esc(u.bio)}</p>` : ''}
      </div>
      <h3 style="font-size:1rem;font-weight:700;margin-bottom:.75rem">${T('vd_see_listings')}</h3>
      ${listingsHTML}`;
  } catch (e) {
    container.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message || T('err_server'))}</p>`;
  }
}

// ══════════════════════════════════════════════════
// PANNEAU ADMIN
// ══════════════════════════════════════════════════
const ADMIN_TABS = ['resume','moderation','verifications','users','properties','agencies','signalements','newsletter','evolution','audit','recherches','security'];

function adminTab(name) {
  document.querySelectorAll('#admin-tabs .tab-btn').forEach((b, i) => {
    b.classList.toggle('active', ADMIN_TABS[i] === name);
  });
  document.querySelector('#admin-tabs .tab-btn.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });   // onglet actif visible (mobile)
  ({ resume: adminLoadResume, moderation: () => adminLoadModeration(), verifications: () => adminLoadVerifications(),
     users: adminLoadUsers, properties: adminLoadProperties,
     agencies: adminLoadAgencies, signalements: adminLoadSignalements,
     newsletter: adminLoadNewsletter, evolution: adminLoadEvolution, security: adminLoadSecurity, audit: adminLoadAudit,
     recherches: adminLoadRecherches })[name]?.();
}

async function loadAdmin() {
  if (!currentUser?.is_admin) { showPage('home'); return; }
  // Double authentification exigée et pas encore configurée : le serveur refuse le reste de l'administration, on ouvre donc l'onglet Sécurité
  if (currentUser.two_factor_required) { adminTab('security'); return; }
  adminTab('resume');
  refreshModerationBadge();
  refreshVerifBadge();
}

// ── Sécurité : double authentification (TOTP) ────────────────────────────────
// Activer ou désactiver révoque les autres sessions du compte : le serveur renvoie alors un nouveau jeton, adopté ici.
const SEC_FIELD = 'padding:.5rem .7rem;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:.95rem;width:100%;max-width:18rem;margin:.2rem 0 .7rem;display:block';
let _secCodes = [];   // codes de secours affichés une seule fois, jamais relus depuis le serveur

function adoptSession(r) {
  token = r.token; localStorage.setItem('dzimmo_token', token);
  currentUser = r.user;
  if (wsConn) { wsConn.close(); wsConn = null; }   // l'ancien jeton est révoqué : la connexion temps réel repart avec le nouveau
  setupWs();
}

async function adminLoadSecurity() {
  const c = document.getElementById('admin-content');
  let s;
  try { s = await api('/auth/2fa'); }
  catch (e) { c.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; return; }
  const low = s.recovery_left <= 3;
  c.innerHTML = `
    <h3 style="font-size:1rem;font-weight:800;margin-bottom:.5rem">Double authentification</h3>
    <div class="card" style="padding:1rem;margin-bottom:1.25rem">
      <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:.9rem">Un mot de passe volé ne suffit plus à administrer le site : chaque connexion demande aussi un code à 6 chiffres, généré par une application d’authentification (Google Authenticator, Microsoft Authenticator, Aegis, FreeOTP…).</p>
      ${s.enabled ? `
        <p style="font-weight:700;margin-bottom:.35rem">✅ La double authentification est active.</p>
        <p style="font-size:.85rem;color:${low ? 'var(--danger, #c0392b)' : 'var(--text-muted)'}">Codes de secours restants : <strong>${Number(s.recovery_left)}</strong>${low ? ' — pensez à en générer de nouveaux.' : ''}</p>`
      : `
        ${s.required ? '<div class="error-msg" style="margin-bottom:.9rem">La double authentification est obligatoire pour les administrateurs : configurez-la pour utiliser l’administration.</div>' : ''}
        <p style="font-weight:700;margin-bottom:.6rem">La double authentification n’est pas activée.</p>
        <button class="btn btn-primary btn-sm" onclick="adminSecSetup()">Configurer</button>`}
    </div>
    <div id="sec-flow"></div>
    ${s.enabled ? `
      <h3 style="font-size:1rem;font-weight:800;margin-bottom:.5rem">Nouveaux codes de secours</h3>
      <div class="card" style="padding:1rem;margin-bottom:1.25rem">
        <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:.7rem">Les anciens codes cessent aussitôt de fonctionner. Confirmez avec un code de votre application.</p>
        <input id="sec-renew-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="32" dir="ltr" placeholder="123 456" style="${SEC_FIELD}">
        <button class="btn btn-outline btn-sm" onclick="adminSecRenew()">Générer de nouveaux codes</button>
      </div>
      <h3 style="font-size:1rem;font-weight:800;margin-bottom:.5rem">Désactiver</h3>
      <div class="card" style="padding:1rem">
        <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:.7rem">${s.required ? 'Elle est obligatoire : vous devrez la configurer de nouveau à la prochaine utilisation de l’administration. ' : ''}Les autres sessions de ce compte seront fermées. Compte connecté avec Google : laissez le mot de passe vide.</p>
        <input id="sec-off-pass" type="password" autocomplete="current-password" placeholder="Mot de passe" style="${SEC_FIELD}">
        <input id="sec-off-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="32" dir="ltr" placeholder="Code de vérification" style="${SEC_FIELD}">
        <button class="btn btn-outline btn-sm" onclick="adminSecDisable()">Désactiver la double authentification</button>
      </div>` : ''}`;
  if (_secCodes.length) adminSecShowCodes();
}

async function adminSecSetup() {
  const box = document.getElementById('sec-flow');
  try {
    const r = await api('/auth/2fa/setup', 'POST');
    box.innerHTML = `
      <h3 style="font-size:1rem;font-weight:800;margin-bottom:.5rem">Configuration</h3>
      <div class="card" style="padding:1rem;margin-bottom:1.25rem">
        <ol style="font-size:.88rem;padding-inline-start:1.2rem;margin-bottom:.9rem;line-height:1.7">
          <li>Ouvrez votre application d’authentification et ajoutez un compte.</li>
          <li>Scannez le code ci-dessous, ou saisissez la clé à la main (type « basé sur le temps »).</li>
          <li>Saisissez le code à 6 chiffres affiché pour confirmer.</li>
        </ol>
        <img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.qr_svg)}" alt="Code QR de configuration" width="200" height="200" style="background:#fff;border-radius:8px;display:block;margin-bottom:.7rem">
        <p style="font-size:.85rem;margin-bottom:.9rem">Clé : <code dir="ltr" style="user-select:all;font-weight:700">${esc(r.secret)}</code></p>
        <input id="sec-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="32" dir="ltr" placeholder="123 456" style="${SEC_FIELD}">
        <button class="btn btn-primary btn-sm" onclick="adminSecEnable()">Activer</button>
      </div>`;
    document.getElementById('sec-code').focus();
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminSecEnable() {
  const code = document.getElementById('sec-code').value.trim();
  if (!code) { toast('❌ ' + T('mfa_need_code')); return; }
  try {
    const r = await api('/auth/2fa/enable', 'POST', { code });
    adoptSession(r);
    _secCodes = r.recovery_codes;
    toast('✅ Double authentification activée.');
    adminLoadSecurity();   // recharge l'état, puis affiche les codes
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminSecRenew() {
  const code = document.getElementById('sec-renew-code').value.trim();
  if (!code) { toast('❌ ' + T('mfa_need_code')); return; }
  try {
    const r = await api('/auth/2fa/recovery-codes', 'POST', { code });
    _secCodes = r.recovery_codes;
    adminSecShowCodes();
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminSecDisable() {
  const password = document.getElementById('sec-off-pass').value;
  const code = document.getElementById('sec-off-code').value.trim();
  if (!code) { toast('❌ ' + T('mfa_need_code')); return; }
  if (!confirm('Désactiver la double authentification ? Le compte ne sera plus protégé que par son mot de passe.')) return;
  try {
    adoptSession(await api('/auth/2fa/disable', 'POST', { password, code }));
    toast('Double authentification désactivée.');
    adminLoadSecurity();
  } catch (e) { toast('❌ ' + e.message); }
}

// Codes de secours : montrés une seule fois (le serveur n'en garde que l'empreinte)
function adminSecShowCodes() {
  const box = document.getElementById('sec-flow');
  if (!box) return;
  box.innerHTML = `
    <h3 style="font-size:1rem;font-weight:800;margin-bottom:.5rem">Codes de secours</h3>
    <div class="card" style="padding:1rem;margin-bottom:1.25rem">
      <div class="error-msg" style="margin-bottom:.9rem">Conservez ces codes en lieu sûr (gestionnaire de mots de passe, papier). Chacun ne sert qu’une fois et remplace l’application si vous perdez votre téléphone. <strong>Ils ne seront plus affichés.</strong></div>
      <div dir="ltr" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(9rem,1fr));gap:.4rem;font-family:monospace;font-size:1rem;font-weight:700;margin-bottom:.9rem">
        ${_secCodes.map(k => `<span>${esc(k)}</span>`).join('')}
      </div>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="adminSecCopyCodes()">Copier</button>
        <button class="btn btn-primary btn-sm" onclick="adminSecCodesDone()">J’ai conservé mes codes</button>
      </div>
    </div>`;
}

function adminSecCopyCodes() {
  navigator.clipboard?.writeText(_secCodes.join('\n')).then(() => toast('✅ Codes copiés.'), () => toast('❌ Copie impossible : recopiez-les à la main.'));
}

function adminSecCodesDone() {
  _secCodes = [];
  adminLoadSecurity();
}

// ── Listes d'administration paginées (25 par page ; recherche et export CSV portent sur toutes les pages) ──
const _adminQ = { users: '', properties: '', agencies: '' };   // recherche en cours par liste
const _adminPage = {};                                          // page affichée par liste (rechargement après une action)
let _adminSigStatus = '';                                       // filtre de la liste des signalements

// « ?a=1&b=x » à partir des seuls paramètres renseignés
function adminQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) q.set(k, v);
  const str = q.toString();
  return str ? '?' + str : '';
}

// Barre de pagination ; callFor(n) renvoie l'appel JavaScript qui charge la page n
function adminPager(r, callFor) {
  if (r.pages <= 1) return '';
  const btn = (label, page, off) =>
    `<button class="btn btn-outline btn-sm" ${off ? 'disabled' : ''} onclick="${callFor(page)}">${label}</button>`;
  return `<div style="display:flex;gap:.6rem;align-items:center;justify-content:center;margin-top:1rem;flex-wrap:wrap">
    ${btn('« 1', 1, r.page <= 1)}${btn('‹ Précédente', r.page - 1, r.page <= 1)}
    <span style="font-size:.85rem;color:var(--text-muted)">Page ${r.page} / ${r.pages}</span>
    ${btn('Suivante ›', r.page + 1, r.page >= r.pages)}${btn(r.pages + ' »', r.pages, r.page >= r.pages)}
  </div>`;
}

// Champ de recherche d'une liste ; valider recharge la première page
function adminSearchBox(list, fn) {
  return `<form onsubmit="_adminQ.${list}=this.q.value.trim();${fn}(1);return false" style="display:flex;gap:.35rem">
    <input name="q" value="${esc(_adminQ[list])}" placeholder="Rechercher…" maxlength="100"
      style="padding:.35rem .65rem;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;background:var(--bg);color:var(--text);min-width:0;width:11rem">
    <button class="btn btn-outline btn-sm" type="submit" title="Rechercher">🔍</button>
  </form>`;
}

// Toutes les lignes d'une liste (pages de 100), pour l'export CSV
async function adminFetchAll(path, params = {}) {
  const rows = [];
  let page = 1, pages = 1;
  do {
    const r = await api('/admin/' + path + adminQuery({ ...params, per_page: 100, page }));
    rows.push(...r.items);
    pages = r.pages;
  } while (++page <= pages);
  return rows;
}

async function adminExport(path, params, filename, toRow) {
  toast('⏳ Export en cours…');
  try { exportCSV((await adminFetchAll(path, params)).map(toRow), filename); }
  catch (e) { toast('❌ ' + e.message); }
}
const adminExportUsers = () => adminExport('users', { q: _adminQ.users }, 'utilisateurs.csv', u => u);
const adminExportProps = () => adminExport('properties',
  { q: _adminQ.properties, status: document.getElementById('admin-prop-status')?.value },
  'annonces.csv', p => ({ id: p.id, titre: p.title, wilaya: p.wilaya, prix: p.price, mode: p.mode, type: p.type_bien, statut: p.status, verifie: p.verified }));
const adminExportSignalements = () => adminExport('signalements', { status: _adminSigStatus }, 'signalements.csv', x => x);

const adminNoResult = '<p style="padding:1rem;color:var(--text-muted);text-align:center">Aucun résultat.</p>';

// ── Modération des annonces ──────────────────────────────────────────────────
const MOD_REASONS = [
  'Photos absentes ou de mauvaise qualité',
  'Description insuffisante ou trompeuse',
  'Prix incohérent avec le bien',
  'Coordonnées personnelles dans le texte ou les photos',
  'Annonce en double',
  'Contenu non conforme aux CGU',
];
// Traduction des motifs prédéfinis pour les propriétaires arabophones (même table que server/messages.js) ;
// une précision libre ajoutée après « — » reste telle que saisie.
const MOD_REASONS_AR = {
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
const modReason = r => (currentLang === 'ar' && r
  ? String(r).split(' — ').map((x, i) => (i === 0 && MOD_REASONS_AR[x]) || x).join(' — ') : r);
let _modStatus = 'pending';
let _modPage = 1;

function setModerationBadge(n) {
  const b = document.getElementById('mod-badge');
  if (!b) return;
  b.textContent = n > 99 ? '99+' : n;
  b.classList.toggle('hidden', !n);
}

async function refreshModerationBadge() {
  try { setModerationBadge((await api('/admin/moderation?per_page=1')).counts.pending); } catch { /* badge facultatif */ }
}

// Signaux de qualité (server/quality.js) montrés aux modérateurs, avec le détail en infobulle
const QUALITY_LABELS = { duplicate_own: 'Doublon (même annonceur)', duplicate_other: 'Texte identique à une autre annonce', price_low: 'Prix au m² très bas', price_high: 'Prix au m² très élevé' };
function qualityHint(flag, d) {
  if (flag === 'duplicate_other') return d.duplicate_other ? 'Même texte que l\'annonce #' + d.duplicate_other.id : '';
  if (flag === 'duplicate_own') return d.duplicate_own ? 'Très semblable à l\'annonce #' + d.duplicate_own.id + ' (« ' + d.duplicate_own.title + ' »)' : '';
  const x = d.price;
  return x ? formatPrice(x.ppm2) + ' DA/m² contre une médiane de ' + formatPrice(x.median) + ' (×' + x.ratio + ', ' + x.sample + ' annonces comparables, ' + (x.scope === 'pays' ? 'tout le pays' : 'même wilaya') + ')' : '';
}

async function adminLoadModeration(status = _modStatus, page = 1) {
  _modStatus = status;
  const c = document.getElementById('admin-content');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const list = await api('/admin/moderation' + adminQuery({ status, page }));
    const { items, counts, enabled } = list;
    _modPage = list.page;
    setModerationBadge(counts.pending);
    window._modPhotos = {};
    const card = p => {
      const photos = (Array.isArray(p.photos) && p.photos.length ? p.photos : [p.image]).filter(Boolean);
      window._modPhotos[p.id] = photos;
      const MODES_L = { vente:'Vente', location_longue:'Location', location_courte:'Saisonnière' };
      return `
      <div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:1rem;box-shadow:var(--shadow)">
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.4rem">
          <span class="card-mode mode-${p.mode}" style="font-size:.71rem;padding:.1rem .45rem">${MODES_L[p.mode] || esc(p.mode)}</span>
          <span style="font-size:.8rem;color:var(--text-muted)">#${p.id} · ${new Date(p.created_at).toLocaleString('fr-DZ')}</span>
        </div>
        <a href="#" onclick="showPage('detail',${p.id});return false" style="color:var(--primary-text);font-weight:800;font-size:1rem">${esc(p.title)}</a>
        <div style="font-size:.85rem;color:var(--text-muted);margin:.2rem 0 .5rem">📍 ${esc([p.commune, p.wilaya].filter(Boolean).join(', '))} · <strong style="color:var(--primary-text)">${formatPrice(p.price)} DZD</strong>${p.surface_m2 ? ' · ' + Number(p.surface_m2) + ' m²' : ''}${p.rooms ? ' · ' + p.rooms + ' p.' : ''}</div>
        <div style="display:flex;gap:.4rem;overflow-x:auto;margin-bottom:.6rem">
          ${photos.length ? photos.slice(0, 6).map((u, i) => `<img src="${esc(thumbUrl(u, 480))}" alt="" loading="lazy" style="height:72px;width:104px;object-fit:cover;border-radius:8px;cursor:pointer;flex-shrink:0;background:var(--border)" onclick="openLightbox(window._modPhotos[${p.id}], ${i})" onerror="this.style.visibility='hidden'">`).join('')
            : '<span style="font-size:.82rem;color:#dc2626">⚠ Aucune photo</span>'}
        </div>
        <div style="font-size:.85rem;line-height:1.55;margin-bottom:.6rem;white-space:pre-line">${esc((p.description || '').slice(0, 400)) || '<em style="color:var(--text-muted)">Aucune description</em>'}</div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.7rem;padding:.5rem .7rem;background:var(--bg);border-radius:8px">
          👤 <strong>${esc(p.owner_name || '—')}</strong> · ${esc(p.owner_email || '')} · ${esc(p.owner_phone || 'tél. —')}
          · ${p.owner_verified ? '✅ email vérifié' : '⚠ email non vérifié'} · ${p.owner_active} annonce${p.owner_active > 1 ? 's' : ''} active${p.owner_active > 1 ? 's' : ''}
          · inscrit le ${new Date(p.owner_since).toLocaleDateString('fr-DZ')}${p.agency_name ? ' · 🏢 ' + esc(p.agency_name) : ''}
        </div>
        ${(p.quality_flags || []).length ? `<div style="margin-bottom:.6rem;display:flex;gap:.35rem;flex-wrap:wrap">${p.quality_flags.map(f =>
          `<span style="background:#fef3c7;color:#92400e;border-radius:20px;padding:.15rem .6rem;font-size:.76rem;font-weight:700" title="${esc(qualityHint(f, p.quality_details || {}))}">⚠ ${esc(QUALITY_LABELS[f] || f)}</span>`).join('')}</div>` : ''}
        ${status === 'rejected' ? `<div style="font-size:.83rem;color:#dc2626;margin-bottom:.6rem">❌ Refusée : ${esc(p.moderation_reason || '')}</div>` : ''}
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
          <button class="btn btn-primary btn-sm" onclick="adminModerate(${p.id},'approve')">✅ Approuver</button>
          ${status === 'pending' ? `<button class="btn btn-outline btn-sm" style="border-color:#dc2626;color:#dc2626" onclick="document.getElementById('mod-refuse-${p.id}').classList.toggle('hidden')">❌ Refuser…</button>` : ''}
        </div>
        <div id="mod-refuse-${p.id}" class="hidden" style="margin-top:.7rem;display:flex;flex-direction:column;gap:.5rem">
          <select id="mod-reason-${p.id}" style="padding:.4rem .6rem;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:.85rem">
            ${MOD_REASONS.map(r => `<option>${esc(r)}</option>`).join('')}
          </select>
          <input id="mod-note-${p.id}" type="text" maxlength="300" placeholder="Précision pour le propriétaire (facultatif)" style="padding:.4rem .6rem;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:.85rem">
          <button class="btn btn-sm" style="background:#dc2626;color:#fff;align-self:flex-start" onclick="adminModerate(${p.id},'reject')">Confirmer le refus</button>
        </div>
      </div>`;
    };
    c.innerHTML = `
      <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap">
        <button class="btn btn-sm ${status === 'pending' ? 'btn-primary' : 'btn-outline'}" onclick="adminLoadModeration('pending')">⏳ En attente (${counts.pending})</button>
        <button class="btn btn-sm ${status === 'rejected' ? 'btn-primary' : 'btn-outline'}" onclick="adminLoadModeration('rejected')">❌ Refusées (${counts.rejected})</button>
        ${enabled ? '' : '<span style="font-size:.82rem;color:#92400e;background:#fef3c7;border-radius:8px;padding:.3rem .6rem">Modération désactivée (MODERATION=off) : les nouvelles annonces sont publiées directement.</span>'}
      </div>
      ${items.length ? items.map(card).join('')
        : `<div class="empty-state"><div class="icon">${status === 'pending' ? '🎉' : '📭'}</div><h3>${status === 'pending' ? 'Rien à valider' : 'Aucune annonce refusée'}</h3></div>`}
      ${adminPager(list, n => `adminLoadModeration('${status}',${n})`)}`;
  } catch (e) { c.innerHTML = `<p style="color:red;padding:1rem">${e.message}</p>`; }
}

async function adminModerate(id, decision) {
  let reason = '';
  if (decision === 'reject') {
    const preset = document.getElementById('mod-reason-' + id)?.value || '';
    const note = document.getElementById('mod-note-' + id)?.value.trim() || '';
    reason = [preset, note].filter(Boolean).join(' — ');
  }
  try {
    await api('/admin/properties/' + id + '/moderate', 'PUT', { decision, reason });
    toast(decision === 'approve' ? '✅ Annonce publiée.' : '❌ Annonce refusée, le propriétaire est prévenu.');
    adminLoadModeration(undefined, _modPage);
  } catch (e) { toast('❌ ' + e.message); }
}

// ── Vérification des annonceurs (administration) ─────────────────────────────
const VERIF_REASONS = [
  'Justificatif illisible ou incomplet',
  'Document expiré',
  'Le nom du document ne correspond pas au compte',
  'Type de document non conforme',
  'Registre de commerce sans activité immobilière',
  'Document non authentifiable',
];
const VERIF_DOC = { cni: "Carte d'identité", passeport: 'Passeport', permis: 'Permis de conduire', registre_commerce: 'Registre de commerce', agrement: 'Agrément' };
let _verStatus = 'pending', _verPage = 1;
window._verDocs = {};

function setVerifBadge(n) {
  const b = document.getElementById('verif-badge');
  if (!b) return;
  b.textContent = n > 99 ? '99+' : n;
  b.classList.toggle('hidden', !n);
}
async function refreshVerifBadge() {
  try { setVerifBadge((await api('/admin/verifications?per_page=1')).counts.pending); } catch { /* badge facultatif */ }
}

async function adminLoadVerifications(status = _verStatus, page = 1) {
  _verStatus = status;
  const c = document.getElementById('admin-content');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const list = await api('/admin/verifications' + adminQuery({ status, page }));
    _verPage = list.page;
    setVerifBadge(list.counts.pending);
    Object.values(window._verDocs).flat().forEach(u => URL.revokeObjectURL(u));
    window._verDocs = {};
    const card = v => `
      <div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:1rem;box-shadow:var(--shadow)">
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-bottom:.4rem">
          <span class="adv-badge adv-${v.kind}" style="margin:0;cursor:default">${v.kind === 'business' ? 'Professionnel' : 'Particulier'}</span>
          <strong>${esc(VERIF_DOC[v.doc_type] || v.doc_type)}</strong>${v.reference ? ' · n° <span dir="ltr">' + esc(v.reference) + '</span>' : ''}
          <span style="font-size:.8rem;color:var(--text-muted)">#${v.id} · ${new Date(v.created_at).toLocaleString('fr-DZ')}</span>
        </div>
        <div style="font-size:.82rem;color:var(--text-muted);margin-bottom:.6rem;padding:.5rem .7rem;background:var(--bg);border-radius:8px">
          👤 <strong>${esc(v.user_name)}</strong> · ${esc(v.user_email)} · ${esc(v.user_phone || 'tél. —')}
          · ${v.user_email_verified ? '✅ email vérifié' : '⚠ email non vérifié'}
          · inscrit le ${new Date(v.user_since).toLocaleDateString('fr-DZ')}${v.agency_name ? ' · 🏢 ' + esc(v.agency_name) : ''}
          ${v.user_verified_kind ? ' · déjà vérifié : ' + esc(v.user_verified_kind) : ''}
        </div>
        ${v.status === 'pending' ? `
          <div class="vf-docs" id="vf-docs-${v.id}">${Array.from({ length: v.files_count }, (_, i) => `<img alt="" id="vf-img-${v.id}-${i}" onclick="openLightbox(window._verDocs[${v.id}], ${i})">`).join('')}</div>
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="adminVerifDecide(${v.id},'approve')">✅ Approuver</button>
            <button class="btn btn-outline btn-sm" style="border-color:#dc2626;color:#dc2626" onclick="document.getElementById('vf-refuse-${v.id}').classList.toggle('hidden')">❌ Refuser…</button>
          </div>
          <div id="vf-refuse-${v.id}" class="hidden" style="margin-top:.7rem;display:flex;flex-direction:column;gap:.5rem">
            <select id="vf-reason-${v.id}" style="padding:.4rem .6rem;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:.85rem">
              ${VERIF_REASONS.map(r => `<option>${esc(r)}</option>`).join('')}
            </select>
            <input id="vf-note-${v.id}" type="text" maxlength="300" placeholder="Précision pour le demandeur (facultatif)" style="padding:.4rem .6rem;border:1.5px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:.85rem">
            <button class="btn btn-sm" style="background:#dc2626;color:#fff;align-self:flex-start" onclick="adminVerifDecide(${v.id},'reject')">Confirmer le refus</button>
          </div>`
        : `<div style="font-size:.85rem;color:${v.status === 'approved' ? '#166534' : '#b91c1c'}">${v.status === 'approved' ? '✅ Approuvée' : '❌ Refusée : ' + esc(v.reason || '')} · ${new Date(v.reviewed_at).toLocaleString('fr-DZ')} · documents supprimés</div>`}
      </div>`;
    const tab = (st, label, n) => `<button class="btn btn-sm ${status === st ? 'btn-primary' : 'btn-outline'}" onclick="adminLoadVerifications('${st}')">${label}${n === undefined ? '' : ' (' + n + ')'}</button>`;
    c.innerHTML = `
      <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap">
        ${tab('pending', '⏳ En attente', list.counts.pending)}${tab('approved', '✅ Approuvées')}${tab('rejected', '❌ Refusées')}
      </div>
      ${list.items.length ? list.items.map(card).join('')
        : `<div class="empty-state"><div class="icon">${status === 'pending' ? '🎉' : '📭'}</div><h3>${status === 'pending' ? 'Aucune vérification à traiter' : 'Aucune demande'}</h3></div>`}
      ${adminPager(list, n => `adminLoadVerifications('${status}',${n})`)}`;
    // Les justificatifs exigent le jeton : chargés par fetch puis affichés depuis des URL locales (blob:)
    for (const v of list.items.filter(x => x.status === 'pending')) {
      window._verDocs[v.id] = [];
      for (let i = 0; i < v.files_count; i++) {
        fetch(`${API}/admin/verifications/${v.id}/files/${i}`, { headers: { Authorization: 'Bearer ' + token } })
          .then(r => r.ok ? r.blob() : Promise.reject())
          .then(b => { const u = URL.createObjectURL(b); window._verDocs[v.id][i] = u; const el = document.getElementById(`vf-img-${v.id}-${i}`); if (el) el.src = u; })
          .catch(() => { const el = document.getElementById(`vf-img-${v.id}-${i}`); if (el) el.alt = 'Justificatif indisponible'; });
      }
    }
  } catch (e) { c.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; }
}

async function adminVerifDecide(id, decision) {
  let reason = '';
  if (decision === 'reject') {
    const preset = document.getElementById('vf-reason-' + id)?.value || '';
    const note = document.getElementById('vf-note-' + id)?.value.trim() || '';
    reason = [preset, note].filter(Boolean).join(' — ');
  }
  try {
    await api('/admin/verifications/' + id + '/decision', 'PUT', { decision, reason });
    toast(decision === 'approve' ? '✅ Compte vérifié, documents supprimés.' : '❌ Demande refusée, le demandeur est prévenu.');
    adminLoadVerifications(_verStatus, _verPage);
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminRevokeVerif(userId) {
  if (!confirm('Retirer la vérification de ce compte ? Son agence perdra aussi le statut vérifié.')) return;
  try {
    await api('/admin/verifications/revoke/' + userId, 'PUT');
    toast('Vérification retirée.');
    adminLoadUsers(_adminPage.users);
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminLoadResume() {
  const c = document.getElementById('admin-content');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const [s, d] = await Promise.all([api('/stats'), api('/stats/details')]);
    c.innerHTML = `
      <h3 style="margin:0 0 .75rem;font-size:1rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Vue d'ensemble</h3>
      <div class="dashboard-stats" style="margin-bottom:1.5rem">
        <div class="stat-card"><div class="val">${s.users}</div><div class="lbl">Utilisateurs</div></div>
        <div class="stat-card"><div class="val">${s.active}</div><div class="lbl">Annonces actives</div></div>
        <div class="stat-card" style="cursor:pointer;${s.pending_props ? 'border:2px solid #d97706' : ''}" onclick="adminTab('moderation')"><div class="val">${s.pending_props || 0}</div><div class="lbl">À modérer</div></div>
        <div class="stat-card"><div class="val">${(s.sold||0)+(s.rented||0)}</div><div class="lbl">Vendues / Louées</div></div>
        <div class="stat-card"><div class="val">${s.agencies}</div><div class="lbl">Agences</div></div>
        <div class="stat-card"><div class="val">${s.contacts}</div><div class="lbl">Demandes contact</div></div>
        <div class="stat-card"><div class="val">${s.pending_contacts}</div><div class="lbl">En attente</div></div>
      </div>
      <h3 style="margin:0 0 .75rem;font-size:1rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Activité — 7 derniers jours</h3>
      <div class="dashboard-stats" style="margin-bottom:1.5rem">
        <div class="stat-card"><div class="val">${d.new_users_7d}</div><div class="lbl">Nouveaux membres</div></div>
        <div class="stat-card"><div class="val">${Number(d.views_7d).toLocaleString('fr-DZ')}</div><div class="lbl">Vues d'annonces</div></div>
        <div class="stat-card"><div class="val">${d.contacts_7d}</div><div class="lbl">Nouvelles demandes</div></div>
        <div class="stat-card"><div class="val">${d.new_users_30d}</div><div class="lbl">Membres / 30j</div></div>
        <div class="stat-card"><div class="val">${Number(d.views_30d).toLocaleString('fr-DZ')}</div><div class="lbl">Vues / 30j</div></div>
        <div class="stat-card"><div class="val">${d.contacts_30d}</div><div class="lbl">Demandes / 30j</div></div>
      </div>
      <h3 style="margin:0 0 .75rem;font-size:1rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Plateforme</h3>
      <div class="dashboard-stats">
        <div class="stat-card"><div class="val">${d.verified_users}</div><div class="lbl">Profils vérifiés</div></div>
        <div class="stat-card"><div class="val">${d.banned_users}</div><div class="lbl">Bannis</div></div>
        <div class="stat-card"><div class="val">${d.featured_active}</div><div class="lbl">À la une actifs</div></div>
        <div class="stat-card" style="cursor:pointer;${d.signalements_pending ? 'border:2px solid #d97706' : ''}" onclick="adminTab('signalements')"><div class="val">${d.signalements_pending}</div><div class="lbl">Signalements</div></div>
        <div class="stat-card"><div class="val">${d.signalements_closed}</div><div class="lbl">Signalements traités</div></div>
        <div class="stat-card"><div class="val">${d.newsletter_subscribers}</div><div class="lbl">Abonnés newsletter</div></div>
      </div>`;
  } catch (e) { c.innerHTML = `<p style="color:red;padding:1rem">${e.message}</p>`; }
}

async function adminLoadUsers(page = 1) {
  const c = document.getElementById('admin-content');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const r = await api('/admin/users' + adminQuery({ q: _adminQ.users, page }));
    const users = r.items;
    _adminPage.users = r.page;
    c.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:var(--text-muted);font-size:.85rem">${r.total} utilisateur${r.total > 1 ? 's' : ''}</span>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${adminSearchBox('users', 'adminLoadUsers')}
          <button class="btn btn-outline btn-sm" onclick="adminExportUsers()">⬇ CSV</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr><th>ID</th><th>Nom</th><th>Email</th><th>Rôle</th><th>Vérifié</th><th>Inscrit</th><th>Actions</th></tr></thead>
          <tbody>${users.map(u => `
            <tr style="${u.banned ? 'opacity:.5' : ''}">
              <td style="color:var(--text-muted)">#${u.id}</td>
              <td style="font-weight:600">${esc(u.name)}</td>
              <td style="color:var(--text-muted)">${esc(u.email)}</td>
              <td>${u.is_admin ? '<span class="badge-admin">Admin</span>' : u.is_agent ? '<span class="badge-agent">Agent</span>' : '<span style="font-size:.8rem;color:var(--text-muted)">Particulier</span>'}</td>
              <td>${u.email_verified ? '✅' : '—'}${u.verified_kind ? ` <span class="adv-badge adv-${u.verified_kind}" style="margin:0;cursor:default">🛡️ ${u.verified_kind === 'business' ? 'Pro' : 'Identité'}</span>` : ''}</td>
              <td style="color:var(--text-muted);white-space:nowrap">${new Date(u.created_at).toLocaleDateString('fr-DZ')}</td>
              <td>
                ${u.verified_kind ? `<button class="btn btn-outline btn-sm" title="Retirer la vérification" onclick="adminRevokeVerif(${u.id})">🛡️✕</button> ` : ''}
                ${u.banned
                  ? `<button class="btn btn-outline btn-sm" style="border-color:#22c55e;color:#22c55e" onclick="adminBanUser(${u.id},false)">✔ Débannir</button>`
                  : `<button class="btn btn-outline btn-sm" style="border-color:#ef4444;color:#ef4444" onclick="adminBanUser(${u.id},true)">🚫 Bannir</button>`}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${users.length ? '' : adminNoResult}
      ${adminPager(r, n => `adminLoadUsers(${n})`)}`;
  } catch (e) { c.innerHTML = `<p style="color:red;padding:1rem">${e.message}</p>`; }
}

async function adminBanUser(id, ban) {
  try {
    await api('/admin/users/' + id + '/ban', 'PUT', { banned: ban });
    toast(ban ? '🚫 Utilisateur banni.' : '✔ Utilisateur débanni.');
    adminLoadUsers(_adminPage.users);
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminLoadProperties(page = 1) {
  const statusFilter = document.getElementById('admin-prop-status')?.value || '';
  const c = document.getElementById('admin-content');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const r = await api('/admin/properties' + adminQuery({ status: statusFilter, q: _adminQ.properties, page }));
    const props = r.items;
    _adminPage.properties = r.page;
    const STATUTS = { active:'Actif', sold:'Vendu', rented:'Loué', archived:'Archivé', pending:'En attente', rejected:'Refusé' };
    const COLORS  = { active:'#0C6E4F', sold:'#3b82f6', rented:'#f59e0b', archived:'#94a3b8', pending:'#d97706', rejected:'#dc2626' };
    c.innerHTML = `
      <div style="margin-bottom:1rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
        <select id="admin-prop-status" style="padding:.35rem .65rem;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;background:var(--bg);color:var(--text)" onchange="adminLoadProperties()">
          <option value="">Tous</option>
          <option value="active">Actif</option><option value="sold">Vendu</option>
          <option value="rented">Loué</option><option value="archived">Archivé</option>
          <option value="pending">En attente</option><option value="rejected">Refusé</option>
        </select>
        <span style="font-size:.85rem;color:var(--text-muted)">${r.total} annonce${r.total > 1 ? 's' : ''}</span>
        ${adminSearchBox('properties', 'adminLoadProperties')}
        <button class="btn btn-outline btn-sm" onclick="adminExportProps()">⬇ CSV</button>
      </div>
      <div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr><th>ID</th><th>Titre</th><th>Wilaya</th><th>Prix</th><th>Statut</th><th>Vérifié</th><th>Actions</th></tr></thead>
          <tbody>${props.map(p => `
            <tr>
              <td style="color:var(--text-muted)">#${p.id}</td>
              <td style="max-width:200px"><a href="#" onclick="showPage('detail',${p.id});return false" style="color:var(--primary-text);font-weight:600">${esc(p.title)}</a></td>
              <td>${esc(p.wilaya)}</td>
              <td style="font-weight:700;white-space:nowrap">${formatPrice(p.price)} DZD</td>
              <td><span style="background:${COLORS[p.status]}20;color:${COLORS[p.status]};padding:.15rem .55rem;border-radius:20px;font-size:.78rem;font-weight:700">${STATUTS[p.status]||p.status}</span></td>
              <td>${p.verified ? '✅' : '—'}</td>
              <td style="display:flex;gap:.3rem;flex-wrap:wrap;align-items:center">
                <select style="padding:.25rem .45rem;border:1.5px solid var(--border);border-radius:6px;font-size:.78rem;background:var(--bg);color:var(--text)" onchange="adminSetStatus(${p.id},this.value,this)">
                  <option value="">Changer…</option>
                  <option value="active">Actif</option><option value="sold">Vendu</option>
                  <option value="rented">Loué</option><option value="archived">Archivé</option>
                </select>
                <button class="btn btn-outline btn-sm promo-btn" style="padding:.25rem .45rem;font-size:.78rem;white-space:nowrap" data-id="${p.id}" onclick="adminFeature(this.dataset.id)">⭐ ${isFeatured(p) ? 'jusqu\'au ' + new Date(p.featured_until).toLocaleDateString('fr-DZ') : 'À la une'}</button>
                ${!p.verified ? `<button class="btn btn-outline btn-sm" style="padding:.25rem .45rem;font-size:.78rem;border-color:#0C6E4F;color:var(--primary-text);white-space:nowrap" onclick="adminVerifyProperty(${p.id})">✓ Vérifier</button>` : ''}
                <button class="btn btn-outline btn-sm" style="padding:.25rem .45rem;font-size:.78rem;border-color:#ef4444;color:#ef4444" data-title="${esc(p.title)}" onclick="adminDeleteProperty(${p.id}, this.dataset.title)">🗑</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${props.length ? '' : adminNoResult}
      ${adminPager(r, n => `adminLoadProperties(${n})`)}`;
    if (statusFilter) document.getElementById('admin-prop-status').value = statusFilter;
  } catch (e) { c.innerHTML = `<p style="color:red;padding:1rem">${e.message}</p>`; }
}

async function adminSetStatus(id, status, sel) {
  if (!status) return;
  try {
    await api('/admin/properties/' + id + '/status', 'PUT', { status });
    toast('✅ Statut mis à jour.');
    adminLoadProperties(_adminPage.properties);
  } catch (e) { toast('❌ ' + e.message); sel.value = ''; }
}

// Met une annonce à la une gratuitement (durée en jours, ajoutée à la période en cours) ou la retire (0)
async function adminFeature(id) {
  const v = prompt('Durée « À la une » en jours (1 à 365, ajoutée à la période en cours ; 0 pour retirer) :', '7');
  if (v === null) return;
  const days = Number(v.trim());
  if (v.trim() === '' || !Number.isInteger(days) || days < 0 || days > 365) { toast('❌ Durée invalide.'); return; }
  try {
    await api('/admin/properties/' + id + '/une', 'PUT', { days });
    toast(days ? '✅ Annonce mise à la une.' : '✅ Mise à la une retirée.');
    adminLoadProperties(_adminPage.properties);
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminVerifyProperty(id) {
  try {
    await api('/admin/properties/' + id + '/verify', 'PUT');
    toast('✅ Annonce vérifiée.');
    adminLoadProperties(_adminPage.properties);
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminDeleteProperty(id, title) {
  if (!confirm('Supprimer « ' + title + ' » ? Cette action est irréversible.')) return;
  try {
    await api('/admin/properties/' + id, 'DELETE');
    toast('🗑 Annonce supprimée.');
    adminLoadProperties(_adminPage.properties);
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminLoadAgencies(page = 1) {
  const c = document.getElementById('admin-content');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const r = await api('/admin/agencies' + adminQuery({ q: _adminQ.agencies, page }));
    const agencies = r.items;
    _adminPage.agencies = r.page;
    c.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;flex-wrap:wrap;gap:.5rem">
        <span style="color:var(--text-muted);font-size:.85rem">${r.total} agence${r.total > 1 ? 's' : ''}</span>
        ${adminSearchBox('agencies', 'adminLoadAgencies')}
      </div>
      <div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr><th>ID</th><th>Nom</th><th>Type</th><th>Wilaya</th><th>Téléphone</th><th>Vérifié</th><th>Actions</th></tr></thead>
          <tbody>${agencies.map(a => `
            <tr>
              <td style="color:var(--text-muted)">#${a.id}</td>
              <td><a href="#" onclick="showPage('agency-detail',${a.id});return false" style="color:var(--primary-text);font-weight:600">${esc(a.name)}</a></td>
              <td>${a.kind === 'promoteur' ? '🏗 Promoteur' : '🏢 Agence'}</td>
              <td>${esc(a.wilaya || '—')}</td>
              <td>${esc(a.phone || '—')}</td>
              <td>${a.verified ? '✅' : '—'}</td>
              <td>
                ${!a.verified
                  ? `<button class="btn btn-outline btn-sm" style="border-color:#0C6E4F;color:var(--primary-text)" onclick="adminVerifyAgency(${a.id})">✓ Vérifier</button>`
                  : '<span style="color:var(--text-muted);font-size:.8rem">Vérifié</span>'}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${agencies.length ? '' : adminNoResult}
      ${adminPager(r, n => `adminLoadAgencies(${n})`)}`;
  } catch (e) { c.innerHTML = `<p style="color:red;padding:1rem">${e.message}</p>`; }
}

async function adminVerifyAgency(id) {
  try {
    await api('/admin/agencies/' + id + '/verify', 'PUT');
    toast('✅ Agence vérifiée.');
    adminLoadAgencies(_adminPage.agencies);
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminLoadSignalements(page = 1) {
  const c = document.getElementById('admin-content');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const r = await api('/admin/signalements' + adminQuery({ status: _adminSigStatus, page }));
    const sigs = r.items;
    _adminPage.signalements = r.page;
    if (!sigs.length && !_adminSigStatus) {
      c.innerHTML = '<div class="empty-state"><div class="icon">✅</div><h3>Aucun signalement</h3><p>Tout est propre !</p></div>';
      return;
    }
    const MOTIFS = { arnaque:'Arnaque', indisponible:'Indisponible', faux:'Faux', photos:'Photos', doublon:'Doublon', interdit:'Interdit', autre:'Autre' };
    const PROP_ST = { active:'Publiée', pending:'En modération', rejected:'Refusée', sold:'Vendue', rented:'Louée', archived:'Archivée' };
    const ST_COLOR = { pending:'#f59e0b', resolved:'#22c55e', dismissed:'#94a3b8' };
    const ST_LBL   = { pending:'En attente', resolved:'Résolu', dismissed:'Ignoré' };
    c.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;flex-wrap:wrap;gap:.5rem">
        <span style="font-size:.85rem;color:var(--text-muted)">${r.total} signalement${r.total > 1 ? 's' : ''} · <strong style="color:#f59e0b">${r.pending} en attente</strong></span>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <select style="padding:.35rem .65rem;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;background:var(--bg);color:var(--text)" onchange="_adminSigStatus=this.value;adminLoadSignalements(1)">
            ${[['', 'Tous'], ['pending', 'En attente'], ['resolved', 'Résolus'], ['dismissed', 'Ignorés']]
              .map(([v, l]) => `<option value="${v}" ${v === _adminSigStatus ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <button class="btn btn-outline btn-sm" onclick="adminExportSignalements()">⬇ CSV</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr><th>ID</th><th>Annonce</th><th>Motif</th><th>Signalé par</th><th>Message</th><th>Statut</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody>${sigs.map(s => `
            <tr style="${s.status !== 'pending' ? 'opacity:.55' : ''}">
              <td style="color:var(--text-muted)">#${s.id}</td>
              <td><a href="#" onclick="showPage('detail',${s.property_id});return false" style="color:var(--primary-text)">${esc(s.property_title || '#' + s.property_id)}</a>
                <div style="font-size:.75rem;color:var(--text-muted)">${esc(PROP_ST[s.property_status] || s.property_status || '')}${s.property_pending > 1 ? ` · <strong style="color:#dc2626">${Number(s.property_pending)} signalements en attente</strong>` : ''}</div></td>
              <td><span style="background:#fef3c7;color:#92400e;padding:.15rem .45rem;border-radius:20px;font-size:.78rem;font-weight:700">${esc(MOTIFS[s.motif] || s.motif)}</span></td>
              <td>${esc(s.reporter_name || 'Anonyme')}</td>
              <td style="max-width:180px;color:var(--text-muted);font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.message || '')}">${esc(s.message || '—')}</td>
              <td><span style="background:${ST_COLOR[s.status] || '#94a3b8'}20;color:${ST_COLOR[s.status] || '#94a3b8'};padding:.15rem .45rem;border-radius:20px;font-size:.78rem;font-weight:700">${ST_LBL[s.status] || s.status}</span></td>
              <td style="color:var(--text-muted);white-space:nowrap">${new Date(s.created_at).toLocaleDateString('fr-DZ')}</td>
              <td style="display:flex;gap:.3rem">
                ${s.status === 'pending' ? `
                <button class="btn btn-outline btn-sm" style="border-color:#22c55e;color:#22c55e;padding:.25rem .45rem;font-size:.78rem;white-space:nowrap" onclick="adminResolveSignalement(${s.id},'resolved')">✔ Résoudre</button>
                <button class="btn btn-outline btn-sm" style="padding:.25rem .45rem;font-size:.78rem;white-space:nowrap" onclick="adminResolveSignalement(${s.id},'dismissed')">Ignorer</button>
                ${['active', 'pending'].includes(s.property_status) ? `<button class="btn btn-outline btn-sm" style="border-color:#dc2626;color:#dc2626;padding:.25rem .45rem;font-size:.78rem;white-space:nowrap" onclick="adminRejectFromSignalement(${s.id})">🚫 Retirer l'annonce</button>` : ''}` : '—'}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${sigs.length ? '' : adminNoResult}
      ${adminPager(r, n => `adminLoadSignalements(${n})`)}`;
  } catch (e) { c.innerHTML = `<p style="color:red;padding:1rem">${e.message}</p>`; }
}

// Signalement fondé : l'annonce est refusée (le propriétaire est prévenu) et les autres signalements en attente sont classés fondés
async function adminRejectFromSignalement(id) {
  const reason = prompt('Motif du retrait (communiqué au propriétaire) :', 'Signalement confirmé après vérification');
  if (reason === null) return;
  try {
    await api('/admin/signalements/' + id + '/resolve', 'PUT', { status: 'resolved', action: 'reject', reason: reason.trim() });
    toast('🚫 Annonce retirée.');
    adminLoadSignalements(_adminPage.signalements);
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminResolveSignalement(id, status) {
  try {
    await api('/admin/signalements/' + id + '/resolve', 'PUT', { status });
    toast(status === 'resolved' ? '✅ Signalement résolu.' : '👁 Signalement ignoré.');
    adminLoadSignalements(_adminPage.signalements);
  } catch (e) { toast('❌ ' + e.message); }
}

// ── Newsletter (administration) : rédaction, test, envois, abonnés ─────────────
// Les abonnés ne reçoivent un envoi qu'après avoir confirmé leur adresse ; chaque message porte son lien de désinscription.
const NL_FIELD = 'width:100%;padding:.55rem .75rem;border:1.5px solid var(--border);border-radius:8px;font-size:.9rem;margin-bottom:.6rem;background:var(--bg);color:var(--text)';

function nlDraft() {
  const v = id => document.getElementById('nl-' + id).value;
  return { subject_fr: v('subject_fr'), body_fr: v('body_fr'), subject_ar: v('subject_ar'), body_ar: v('body_ar') };
}

async function adminLoadNewsletter() {
  const c = document.getElementById('admin-content');
  c.innerHTML = `
    <h3 style="font-size:1rem;font-weight:800;margin-bottom:.5rem">Nouvel envoi</h3>
    <div class="card" style="padding:1rem;margin-bottom:1.75rem">
      <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:.9rem">Rédigez au moins une langue (sujet et texte). Chaque abonné confirmé reçoit sa langue, ou l’autre à défaut. Séparez les paragraphes par une ligne vide : le lien de désinscription est ajouté automatiquement.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem">
        <div>
          <label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:.25rem">Sujet (français)</label>
          <input id="nl-subject_fr" type="text" maxlength="150" style="${NL_FIELD}">
          <label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:.25rem">Texte (français)</label>
          <textarea id="nl-body_fr" rows="9" maxlength="10000" style="${NL_FIELD};resize:vertical"></textarea>
        </div>
        <div dir="rtl">
          <label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:.25rem">Sujet (arabe)</label>
          <input id="nl-subject_ar" type="text" maxlength="150" style="${NL_FIELD}">
          <label style="display:block;font-size:.82rem;font-weight:600;margin-bottom:.25rem">Texte (arabe)</label>
          <textarea id="nl-body_ar" rows="9" maxlength="10000" style="${NL_FIELD};resize:vertical"></textarea>
        </div>
      </div>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.4rem">
        <button class="btn btn-outline btn-sm" onclick="adminNlTest()">Envoyer un test à mon adresse</button>
        <button class="btn btn-primary btn-sm" onclick="adminNlSend()">Envoyer aux abonnés confirmés</button>
      </div>
    </div>
    <h3 style="font-size:1rem;font-weight:800;margin-bottom:.5rem">Envois</h3>
    <div id="nl-campaigns" style="margin-bottom:1.75rem"></div>
    <h3 style="font-size:1rem;font-weight:800;margin-bottom:.5rem">Abonnés</h3>
    <div id="nl-subs"></div>`;
  adminNlCampaigns(1);
  adminNlSubs(1);
}

async function adminNlTest() {
  try { await api('/admin/newsletter/test', 'POST', nlDraft()); toast('✅ Test envoyé à votre adresse.'); }
  catch (e) { toast('❌ ' + e.message); }
}

async function adminNlSend() {
  const draft = nlDraft();
  if (!confirm('Envoyer cette newsletter à tous les abonnés confirmés ? L’envoi ne peut pas être rappelé une fois parti.')) return;
  try {
    const r = await api('/admin/newsletter/campaigns', 'POST', draft);
    toast(`✅ Envoi en cours vers ${r.recipients} abonné${r.recipients > 1 ? 's' : ''}.`);
    ['subject_fr', 'body_fr', 'subject_ar', 'body_ar'].forEach(k => { document.getElementById('nl-' + k).value = ''; });
    adminNlCampaigns(1);
  } catch (e) { toast('❌ ' + e.message); }
}

async function adminNlCancel(btn) {
  if (!confirm('Annuler les envois qui ne sont pas encore partis ?')) return;
  try { await api('/admin/newsletter/campaigns/' + btn.dataset.id + '/cancel', 'POST'); adminNlCampaigns(_adminPage.nlCampaigns || 1); }
  catch (e) { toast('❌ ' + e.message); }
}

async function adminNlCampaigns(page = 1) {
  const box = document.getElementById('nl-campaigns');
  if (!box) return;
  _adminPage.nlCampaigns = page;
  try {
    const r = await api('/admin/newsletter/campaigns' + adminQuery({ page }));
    box.innerHTML = r.items.length ? `
      <div style="overflow-x:auto"><table class="admin-table">
        <thead><tr><th>Date</th><th>Sujet</th><th>Envoyés</th><th>Échecs</th><th>Restants</th><th></th></tr></thead>
        <tbody>${r.items.map(k => {
          const left = k.canceled_at ? 0 : k.total - k.sent - k.failed;
          return `<tr>
            <td style="white-space:nowrap;color:var(--text-muted)">${new Date(k.created_at).toLocaleDateString('fr-DZ')}</td>
            <td>${esc(k.subject_fr || k.subject_ar)}${k.canceled_at ? ' <em style="color:var(--text-muted)">(annulé)</em>' : ''}</td>
            <td>${k.sent} / ${k.total}</td><td>${k.failed}</td><td>${left}</td>
            <td>${left > 0 ? `<button class="btn btn-outline btn-sm" data-id="${Number(k.id)}" onclick="adminNlCancel(this)">Annuler</button>` : ''}</td>
          </tr>`; }).join('')}
        </tbody></table></div>
      ${adminPager(r, n => `adminNlCampaigns(${n})`)}`
      : '<p style="color:var(--text-muted);font-size:.9rem">Aucun envoi pour l’instant.</p>';
  } catch (e) { box.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; }
}

async function adminNlSubs(page = 1) {
  const box = document.getElementById('nl-subs');
  if (!box) return;
  try {
    const r = await api('/admin/newsletter' + adminQuery({ page }));
    const subs = r.items;
    box.innerHTML = `
      <p style="margin-bottom:.75rem;font-size:1rem;font-weight:800;color:var(--primary-text)">${r.confirmed} abonné${r.confirmed > 1 ? 's' : ''} confirmé${r.confirmed > 1 ? 's' : ''}
        <span style="font-weight:500;color:var(--text-muted);font-size:.85rem"> · ${r.total} adresse${r.total > 1 ? 's' : ''} au total</span></p>
      ${r.smtp ? '' : '<p style="color:var(--red);font-size:.85rem;margin-bottom:.75rem">⚠️ Envoi d’emails non configuré sur le serveur : ni confirmation ni envoi ne partent.</p>'}
      <div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr><th>Email</th><th>Langue</th><th>Inscrit le</th><th>Statut</th></tr></thead>
          <tbody>${subs.map(s => `
            <tr>
              <td>${esc(s.email)}</td>
              <td>${s.lang === 'ar' ? 'العربية' : 'Français'}</td>
              <td style="color:var(--text-muted);white-space:nowrap">${new Date(s.created_at).toLocaleDateString('fr-DZ')}</td>
              <td>${s.confirmed_at ? '✅ Confirmé' : '⏳ En attente'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${subs.length ? '' : adminNoResult}
      ${adminPager(r, n => `adminNlSubs(${n})`)}`;
  } catch (e) { box.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; }
}

// ── Journal d'audit admin ─────────────────────────
const _AUDIT_ACTIONS = {
  moderate_approve:'✅ Approuver annonce', moderate_reject:'❌ Refuser annonce',
  ban_user:'🚫 Bannir', unban_user:'✅ Débannir',
  feature_property:'⭐ Mettre à la une', unfeature_property:'✗ Retirer à la une',
  delete_property:'🗑️ Supprimer annonce', status_property:'🔄 Changer statut',
  resolve_report:'✅ Résoudre signalement', dismiss_report:'✗ Ignorer signalement',
  verify_user:'✅ Vérifier identité', reject_verification:'❌ Refuser vérification',
  revoke_verification:'🔄 Révoquer vérification',
};
let _evolDays = 30;
async function adminLoadEvolution(days) {
  if (days) _evolDays = days;
  const box = document.getElementById('admin-content');
  box.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const d = await api('/stats/evolution?days=' + _evolDays);
    const series = d.series || [];
    const keys = ['new_users','new_listings','views','contacts'];
    const colors = ['#6366f1','var(--primary-text)','#f59e0b','#ef4444'];
    const labels = [T('evol_users'), T('evol_listings'), T('evol_views'), T('evol_contacts')];

    function sparkline(key, color) {
      const W = 340, H = 80, pad = { t:8, b:16, l:32, r:8 };
      const vals = series.map(r => Number(r[key]) || 0);
      const maxV = Math.max(...vals, 1);
      const n = vals.length || 1;
      const px = i => pad.l + (i / Math.max(n-1,1)) * (W - pad.l - pad.r);
      const py = v => pad.t + (1 - v / maxV) * (H - pad.t - pad.b);
      const pts = vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
      const area = `M${px(0).toFixed(1)},${H-pad.b} ${vals.map((v,i) => `L${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')} L${px(n-1).toFixed(1)},${H-pad.b} Z`;
      const total = vals.reduce((a,b) => a+b, 0);
      const last  = vals[vals.length-1] || 0;
      return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block">
        <defs><linearGradient id="eg-${key}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity=".25"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="${area}" fill="url(#eg-${key})"/>
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
        <text x="${pad.l-2}" y="${H-4}" font-size="9" fill="var(--text-muted)">0</text>
        <text x="${pad.l-2}" y="${pad.t+4}" font-size="9" fill="var(--text-muted)">${maxV.toLocaleString()}</text>
      </svg>
      <div style="font-size:.75rem;color:var(--text-muted);margin-top:.1rem">Total : <b>${total.toLocaleString()}</b> · Hier : <b>${last.toLocaleString()}</b></div>`;
    }

    const btnRow = [30,60,90].map(n =>
      `<button class="btn btn-sm ${_evolDays===n?'btn-primary':'btn-outline'}" style="padding:.25rem .7rem" onclick="adminLoadEvolution(${n})">${n} ${T('evol_days')}</button>`
    ).join('');
    const cards = keys.map((k,i) =>
      `<div style="background:var(--bg-alt);border-radius:12px;padding:1rem">
        <div style="font-size:.8rem;font-weight:600;margin-bottom:.4rem;color:${colors[i]}">${esc(labels[i])}</div>
        ${sparkline(k, colors[i])}
      </div>`
    ).join('');

    box.innerHTML = `<div style="margin-bottom:1rem">
      <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:.75rem">${T('evol_title')} ${_evolDays} ${T('evol_days')}</h2>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem">${btnRow}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem">${cards}</div>
    </div>`;
  } catch (e) { box.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; }
}

async function adminLoadRecherches() {
  const box = document.getElementById('admin-content');
  box.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const r = await api('/stats/searches');
    if (!r.top.length && !r.daily.some(d => d.searches > 0)) {
      box.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text-muted)">${T('src_no_data')}</div>`; return;
    }
    // Courbe journalière
    const maxD = Math.max(1, ...r.daily.map(d => d.searches));
    const barW = Math.max(1, Math.floor(320 / r.daily.length));
    const bars = r.daily.map(d => {
      const h = Math.round((d.searches / maxD) * 80);
      return `<rect x="${r.daily.indexOf(d) * barW}" y="${80 - h}" width="${Math.max(1, barW - 1)}" height="${h}" fill="var(--primary)" opacity=".7" title="${esc(d.day)}: ${d.searches}"/>`;
    }).join('');
    const chartW = r.daily.length * barW;
    // Tableau top requêtes
    const rows = r.top.map(q => `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:.5rem .75rem;font-size:.88rem">${esc(q.query)}</td>
        <td style="padding:.5rem .75rem;text-align:right;font-size:.88rem;font-weight:700">${q.total}</td>
        <td style="padding:.5rem .75rem;text-align:right;font-size:.83rem;color:var(--text-muted)">${q.avg_results} ${T('src_avg')}</td>
      </tr>`).join('');
    box.innerHTML = `
      <div style="padding:1rem">
        <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:1.5rem">${T('src_title')}</h2>
        <div style="background:var(--white);border-radius:12px;padding:1.25rem;box-shadow:var(--shadow);margin-bottom:1.5rem">
          <h3 style="font-size:.95rem;font-weight:700;margin:0 0 1rem">${T('src_daily')}</h3>
          <svg viewBox="0 0 ${chartW} 90" preserveAspectRatio="none" style="width:100%;height:90px;display:block">${bars}</svg>
          <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--text-muted);margin-top:.25rem">
            <span>${esc(r.daily[0]?.day || '')}</span><span>${esc(r.daily[r.daily.length - 1]?.day || '')}</span>
          </div>
        </div>
        <div style="background:var(--white);border-radius:12px;box-shadow:var(--shadow);overflow:hidden">
          <div style="padding:.75rem 1rem;font-size:.95rem;font-weight:700;border-bottom:1px solid var(--border)">${T('src_top')}</div>
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:var(--bg)">
                <th style="padding:.5rem .75rem;text-align:start;font-size:.8rem;color:var(--text-muted);font-weight:600">Requête</th>
                <th style="padding:.5rem .75rem;text-align:end;font-size:.8rem;color:var(--text-muted);font-weight:600">${T('src_count')}</th>
                <th style="padding:.5rem .75rem;text-align:end;font-size:.8rem;color:var(--text-muted);font-weight:600">${T('src_avg')}</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  } catch (e) { box.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; }
}

async function adminLoadAudit(page = 1) {
  const box = document.getElementById('admin-content');
  box.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const r = await api('/admin/audit' + adminQuery({ page }));
    box.innerHTML = `
      <h3 style="margin:0 0 1rem">${esc(T('audit_title'))}</h3>
      <div style="overflow-x:auto">
        <table class="admin-table">
          <thead><tr>
            <th>${esc(T('audit_date'))}</th>
            <th>${esc(T('audit_admin'))}</th>
            <th>${esc(T('audit_action'))}</th>
            <th>${esc(T('audit_target'))}</th>
            <th>${esc(T('audit_details'))}</th>
          </tr></thead>
          <tbody>${(r.items || []).map(l => {
            const dets = l.details || {};
            const detStr = Object.entries(dets).filter(([,v]) => v !== null && v !== undefined && v !== '' && v !== false).map(([k,v]) => `${k}: ${esc(String(v))}`).join(', ');
            return `<tr>
              <td style="white-space:nowrap;font-size:.82rem">${esc(new Date(l.created_at).toLocaleString('fr-DZ'))}</td>
              <td>${esc(l.admin_name || '#' + Number(l.admin_id))}</td>
              <td>${esc(_AUDIT_ACTIONS[l.action] || l.action)}</td>
              <td style="font-size:.82rem">${esc(l.target_type)} #${Number(l.target_id || 0)}</td>
              <td style="font-size:.82rem;color:var(--text-muted)">${esc(detStr)}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
      ${r.items && !r.items.length ? `<p style="color:var(--text-muted);padding:1.5rem">Aucune action enregistrée.</p>` : ''}
      ${adminPager(r, n => `adminLoadAudit(${n})`)}`;
  } catch (e) { box.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; }
}

// ── Favoris ───────────────────────────────────────
async function toggleFav(propertyId, btn) {
  if (!token) { openModal('login'); return; }
  try {
    const { is_favorite } = await api('/favorites/check/' + propertyId);
    if (is_favorite) {
      await api('/favorites/' + propertyId, 'DELETE');
      btn.textContent = '🤍';
      toast(T('fav_removed'));
    } else {
      await api('/favorites', 'POST', { property_id: propertyId });
      btn.textContent = '❤️';
      toast(T('fav_added'));
    }
  } catch (e) { toast('❌ ' + e.message); }
}

// ── Page statistiques publiques ────────────────────
async function loadStatsPage() {
  const el = document.getElementById('stats-content');
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const s = await api('/stats/public');

    // Graphique wilayas (barres horizontales)
    const maxW = Math.max(...s.top_wilayas.map(w => w.count), 1);
    const wilayaBars = s.top_wilayas.map(w => `
      <div style="margin-bottom:.45rem">
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:.15rem">
          <span style="font-weight:600">${esc(wilayaName(w.wilaya))}</span>
          <span style="color:var(--text-muted)">${w.count} ${unit(w.count, 'st_ad')}</span>
        </div>
        <div style="background:var(--border);border-radius:20px;height:7px">
          <div style="width:${Math.round(w.count/maxW*100)}%;background:var(--primary);border-radius:20px;height:7px;transition:width .4s"></div>
        </div>
      </div>`).join('');

    // Répartition par type (barres horizontales)
    const TYPES_KEYS = { appartement:'s_appart', villa:'s_villa', maison:'s_maison',
      bureau:'s_bureau', local_commercial:'s_local', terrain:'s_terrain', ferme:'s_ferme', entrepot:'s_entrepot' };
    const maxT = Math.max(...s.top_types.map(t => t.count), 1);
    const typeBars = s.top_types.map(t => `
      <div style="margin-bottom:.45rem">
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:.15rem">
          <span style="font-weight:600">${TYPES_KEYS[t.type_bien] ? T(TYPES_KEYS[t.type_bien]) : esc(t.type_bien)}</span>
          <span style="color:var(--text-muted)">${t.count}</span>
        </div>
        <div style="background:var(--border);border-radius:20px;height:7px">
          <div style="width:${Math.round(t.count/maxT*100)}%;background:#3b82f6;border-radius:20px;height:7px"></div>
        </div>
      </div>`).join('');

    el.innerHTML = `
      <!-- KPIs -->
      <div class="dashboard-stats" style="margin-bottom:2rem">
        <div class="stat-card"><div class="val">${(s.active||0).toLocaleString('fr-DZ')}</div><div class="lbl">${T('st_active')}</div></div>
        <div class="stat-card"><div class="val">${(s.sold||0).toLocaleString('fr-DZ')}</div><div class="lbl">${T('st_sold')}</div></div>
        <div class="stat-card"><div class="val">${(s.rented||0).toLocaleString('fr-DZ')}</div><div class="lbl">${T('st_rented')}</div></div>
        <div class="stat-card"><div class="val">${(s.users||0).toLocaleString('fr-DZ')}</div><div class="lbl">${T('st_users')}</div></div>
        <div class="stat-card"><div class="val">${(s.agencies||0).toLocaleString('fr-DZ')}</div><div class="lbl">${T('st_agencies')}</div></div>
        <div class="stat-card"><div class="val">${Number(s.total_views||0).toLocaleString('fr-DZ')}</div><div class="lbl">${T('st_views')}</div></div>
      </div>

      <!-- Mode répartition -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:2rem">
        <div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:1.25rem;box-shadow:var(--shadow)">
          <div style="font-weight:700;font-size:.9rem;margin-bottom:.15rem">${T('st_by_mode')}</div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:1rem">${T('st_active_sub')}</div>
          <div style="display:flex;gap:.6rem;margin-bottom:.75rem;flex-wrap:wrap">
            <span style="background:#0C6E4F20;color:var(--primary-text);padding:.25rem .65rem;border-radius:20px;font-size:.82rem;font-weight:700">${T('s_vente')} : ${s.vente}</span>
            <span style="background:#3b82f620;color:#3b82f6;padding:.25rem .65rem;border-radius:20px;font-size:.82rem;font-weight:700">${T('st_mode_long')} : ${s.loc_longue}</span>
            <span style="background:#f59e0b20;color:#d97706;padding:.25rem .65rem;border-radius:20px;font-size:.82rem;font-weight:700">${T('st_mode_short')} : ${s.loc_courte}</span>
          </div>
        </div>
        <div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:1.25rem;box-shadow:var(--shadow)">
          <div style="font-weight:700;font-size:.9rem;margin-bottom:.15rem">${T('st_types')}</div>
          <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:1rem">${T('st_types_sub')}</div>
          ${typeBars}
        </div>
      </div>

      <!-- Top wilayas -->
      <div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:1.25rem;box-shadow:var(--shadow)">
        <div style="font-weight:700;font-size:.9rem;margin-bottom:.15rem">${T('st_wilayas')}</div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:1rem">${T('st_wilayas_sub')}</div>
        ${wilayaBars}
      </div>

      <p style="font-size:.75rem;color:var(--text-muted);text-align:center;margin-top:1.5rem">
        ${T('st_footer')} · DzImmo ${new Date().getFullYear()}
      </p>`;
  } catch (e) {
    el.innerHTML = `<p style="color:red;padding:2rem;text-align:center">${e.message}</p>`;
  }
}

// ── Dashboard ─────────────────────────────────────
function buildViewsChart(data) {
  const top = [...data].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8);
  if (!top.length || top.every(p => !p.views)) return '';
  const maxV = Math.max(...top.map(p => p.views || 0)) || 1;
  const W = 560, H = 160, BAR_W = Math.floor((W - 40) / top.length - 6), PAD = 20;
  const bars = top.map((p, i) => {
    const bh = Math.round(((p.views || 0) / maxV) * (H - 40));
    const x  = PAD + i * ((W - PAD * 2) / top.length);
    const y  = H - 20 - bh;
    const label = (p.title || '').slice(0, 10) + ((p.title || '').length > 10 ? '…' : '');
    return `
      <rect x="${x}" y="${y}" width="${BAR_W}" height="${bh}" rx="4" fill="#0C6E4F" opacity=".85"/>
      <text x="${x + BAR_W / 2}" y="${y - 4}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".8">${p.views || 0}</text>
      <text x="${x + BAR_W / 2}" y="${H - 4}" text-anchor="middle" font-size="9" fill="currentColor" opacity=".6">${esc(label)}</text>`;
  }).join('');
  return `
    <div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:1rem 1.25rem;margin-top:1.25rem;box-shadow:var(--shadow)">
      <div style="font-size:.88rem;font-weight:700;color:var(--text-muted);margin-bottom:.75rem">${T('dash_chart')}</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto;color:var(--text);overflow:visible">
        ${bars}
        <line x1="${PAD}" y1="${H - 20}" x2="${W - PAD}" y2="${H - 20}" stroke="var(--border)" stroke-width="1"/>
      </svg>
    </div>`;
}

let currentDashTab = 'mes-annonces';

async function loadDashboard() {
  if (!currentUser) { showPage('home'); openModal('login'); return; }
  try {
    const stats = await api('/stats/me');
    document.getElementById('dash-stats').innerHTML = `
      <div class="stat-card"><div class="val">${stats.properties}</div><div class="lbl">${T('dash_annonces')}</div></div>
      <div class="stat-card"><div class="val">${stats.active}</div><div class="lbl">${T('dash_actives')}</div></div>
      <div class="stat-card"><div class="val">${stats.contacts}</div><div class="lbl">${T('dash_demandes')}</div></div>
      <div class="stat-card"><div class="val">${stats.pending}</div><div class="lbl">${T('dash_attente')}</div></div>
      <div class="stat-card"><div class="val">${stats.total_views}</div><div class="lbl">${T('dash_vues')}</div></div>
      <div class="stat-card" title="${esc(T('dash_clicks_tip'))}"><div class="val">📞 ${stats.calls}</div><div class="lbl">${T('dash_calls')}</div></div>
      <div class="stat-card" title="${esc(T('dash_clicks_tip'))}"><div class="val">💬 ${stats.whatsapps}</div><div class="lbl">${T('dash_whatsapps')}</div></div>`;
  } catch {}
  dashTab(currentDashTab);
}

// Suppression d'une annonce refusée par son propriétaire (il peut en publier une corrigée)
async function ownerDelete(id) {
  if (!confirm(T('dash_delete_confirm'))) return;
  try {
    await api('/properties/' + id, 'DELETE');
    dashTab('mes-annonces');
  } catch (e) { toast(e.message || T('dash_error')); }
}

// « Toujours disponible » / renouvellement d'une annonce retirée faute de confirmation
async function ownerRenew(id) {
  try {
    await api('/properties/' + id + '/renew', 'POST');
    toast(T('dash_renewed'));
    dashTab('mes-annonces');
  } catch (e) { toast(e.message || T('dash_error')); }
}

async function ownerArchive(id) {
  if (!confirm(T('dash_archive_confirm'))) return;
  try {
    await api('/properties/' + id, 'PUT', { status: 'archived' });
    toast(T('dash_archived'));
    dashTab('mes-annonces');
  } catch (e) { toast(e.message || T('dash_error')); }
}

// ── Import CSV ───────────────────────────────────────────────────────────────
function triggerImportCSV() {
  let inp = document.getElementById('csv-import-input');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file'; inp.id = 'csv-import-input';
    inp.accept = '.csv,text/csv,text/plain'; inp.style.display = 'none';
    inp.addEventListener('change', () => importCSV(inp));
    document.body.appendChild(inp);
  }
  inp.value = ''; inp.click();
}

async function importCSV(input) {
  if (!input.files || !input.files.length) return;
  const c = document.getElementById('dash-tab-content');
  if (c) c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const fd = new FormData();
  fd.append('file', input.files[0]);
  try {
    const res = await fetch(API + '/import', { method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'X-Lang': currentLang }, body: fd });
    const d = await res.json();
    if (!res.ok) { toast('❌ ' + (d.error || T('dash_error'))); dashTab('mes-annonces'); return; }
    let msg = T('imp_result_ok').replace('{n}', d.created);
    if (d.errors.length) msg += ' ' + T('imp_result_err').replace('{e}', d.errors.length);
    toast('✅ ' + msg, d.errors.length ? 8000 : 4000);
    if (c && d.errors.length) {
      const rows = d.errors.slice(0, 10).map(e =>
        `<tr><td style="padding:.25rem .6rem;color:#b45309">Ligne ${e.line}</td><td style="padding:.25rem .6rem">${esc(e.error)}</td></tr>`).join('');
      c.innerHTML = `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:1rem;margin-bottom:1rem">
        <div style="font-weight:700;margin-bottom:.5rem">⚠️ ${esc(msg)}</div>
        <table style="font-size:.82rem;width:100%;border-collapse:collapse">${rows}</table>
        ${d.errors.length > 10 ? `<div style="font-size:.8rem;margin-top:.4rem;color:var(--text-muted)">… et ${d.errors.length - 10} autre(s)</div>` : ''}
      </div>`;
      setTimeout(() => dashTab('mes-annonces'), 8000);
    } else {
      dashTab('mes-annonces');
    }
  } catch (e) { toast('❌ ' + (e.message || T('dash_error'))); dashTab('mes-annonces'); }
}

// ── Vérification de l'annonceur ──────────────────────────────────────────────
// « professionnel » (agence vérifiée ou registre de commerce contrôlé) l'emporte sur « identité »
function advKind(p) {
  if (p.agency_verified || p.owner_verified_kind === 'business') return 'business';
  return p.owner_verified_kind === 'identity' ? 'identity' : null;
}
function advBadgeHTML(kind) {
  return kind ? `<span class="adv-badge adv-${kind}" title="${esc(T('adv_' + kind + '_tip'))}">🛡️ ${T('adv_' + kind)}</span>` : '';
}
function ownerTrustHTML(p) {
  const score = Number(p.owner_trust_score) || 0;
  if (score === 0) return '';
  const color = score >= 75 ? 'var(--primary-text)' : score >= 40 ? '#d97706' : 'var(--text-muted)';
  const label = score >= 75 ? T('trust_high') : score >= 40 ? T('trust_mid') : T('trust_low');
  const filled = Math.round(score / 20);
  const dots = Array.from({length: 5}, (_, i) =>
    `<span style="display:inline-block;width:10px;height:6px;border-radius:2px;background:${i < filled ? color : 'var(--border)'}"></span>`
  ).join('');
  const reactif = p.owner_responsive ? `<span class="responsive-badge" style="margin-left:.4rem">${T('responsive_badge')}</span>` : '';
  return `<div style="margin-top:.4rem;display:flex;align-items:center;gap:.35rem;flex-wrap:wrap">
    <span style="display:inline-flex;gap:2px">${dots}</span>
    <span style="font-size:.75rem;color:${color}">${esc(label)}</span>${reactif}
  </div>`;
}

const VF_DOCS = { identity: ['cni', 'passeport', 'permis'], business: ['registre_commerce', 'agrement'] };

// Onglet « Vérification » : état du compte, demande en cours, formulaire d'envoi
async function dashVerification(c) {
  let v;
  try { v = await api('/verification/me'); }
  catch (e) { c.innerHTML = `<p style="color:red;padding:1rem">${esc(e.message)}</p>`; return; }
  const date = d => new Date(d).toLocaleDateString('fr-DZ');
  const req = v.request;
  let status = '';
  if (v.verified_kind) {
    status = `<div class="adv-badge adv-${v.verified_kind}" style="font-size:.85rem;margin:0 0 .5rem">🛡️ ${T('adv_' + v.verified_kind)}</div>
      <p style="margin:.2rem 0">${T('vf_ok_' + v.verified_kind).replace('{date}', date(v.verified_at))}</p>
      ${v.verified_kind === 'identity' ? `<p class="vf-hint" style="font-size:.82rem;color:var(--text-muted)">${T('vf_no_ownership')}</p>` : ''}`;
  }
  if (req && req.status === 'pending') {
    status += `<p style="margin:.6rem 0;color:#92400e;background:#fef3c7;border-radius:8px;padding:.6rem .8rem">⏳ ${T('vf_pending').replace('{date}', date(req.created_at))}</p>
      <button class="btn btn-outline btn-sm" onclick="cancelVerification(${req.id})">${T('vf_cancel')}</button>`;
  } else if (req && req.status === 'rejected' && !v.verified_kind) {
    status += `<p style="margin:.6rem 0;color:#b91c1c;background:#fef2f2;border-radius:8px;padding:.6rem .8rem">❌ ${T('vf_rejected').replace('{reason}', esc(modReason(req.reason || '')))}</p>`;
  }
  // Formulaire : ni demande en cours, ni professionnel déjà vérifié ; une identité déjà vérifiée ne propose que « professionnel »
  const canSend = !(req && req.status === 'pending') && v.verified_kind !== 'business';
  const kinds = v.verified_kind === 'identity' ? ['business'] : ['identity', 'business'];
  const form = !canSend ? '' : `
    <form onsubmit="return submitVerification(event)" style="margin-top:${status ? '1rem' : '0'}">
      ${v.verified_kind === 'identity' ? `<p style="margin:0 0 .5rem">${T('vf_upgrade')}</p>` : ''}
      <label>${T('vf_kind')}</label>
      ${kinds.map((k, i) => `<label class="vf-radio"><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''} onchange="vfKindChanged(this.form)"> <span>${T('vf_kind_' + k)}</span></label>`).join('')}
      <label>${T('vf_doc')}</label>
      <select name="doc_type"></select>
      <div id="vf-ref-wrap" class="hidden">
        <label>${T('vf_ref')}</label>
        <input type="text" name="reference" maxlength="40" dir="ltr">
      </div>
      <label>${T('vf_files')}</label>
      <input type="file" name="files" accept="image/jpeg,image/png,image/webp" multiple>
      <div class="vf-hint">${T('vf_files_hint')}</div>
      <label class="vf-radio" style="margin-top:1rem"><input type="checkbox" name="consent" required> <span>${T('vf_consent')}</span></label>
      <button type="submit" class="btn btn-primary" style="margin-top:.8rem">${T('vf_send')}</button>
    </form>`;
  c.innerHTML = `<div class="vf-panel">
    <h3 style="margin:0 0 .4rem;font-size:1.05rem">🛡️ ${T('vf_title')}</h3>
    ${v.verified_kind ? '' : `<p style="margin:0 0 .6rem;color:var(--text-muted);font-size:.9rem">${T('vf_intro')}</p>`}
    ${status}${form}
  </div>`;
  const f = c.querySelector('form');
  if (f) vfKindChanged(f);
}

// Adapte la liste des documents et le champ « numéro » au type choisi (particulier / professionnel)
function vfKindChanged(f) {
  const kind = f.kind.value;
  f.doc_type.innerHTML = VF_DOCS[kind].map(d => `<option value="${d}">${T('vf_doc_' + d)}</option>`).join('');
  document.getElementById('vf-ref-wrap').classList.toggle('hidden', kind !== 'business');
  f.reference.required = kind === 'business';
}

async function submitVerification(e) {
  e.preventDefault();
  const f = e.target;
  const files = [...f.files.files];
  if (!files.length) { toast(T('vf_need_file')); return false; }
  const fd = new FormData();
  fd.append('kind', f.kind.value);
  fd.append('doc_type', f.doc_type.value);
  fd.append('reference', f.reference.value);
  fd.append('consent', f.consent.checked ? 'true' : 'false');
  files.slice(0, 2).forEach(x => fd.append('files', x));
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const r = await fetch(API + '/verification', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Lang': currentLang }, body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || T('err_server'));
    toast(T('vf_sent'));
    dashTab('verification');
  } catch (err) {
    toast('❌ ' + (err instanceof TypeError ? T('err_network') : err.message));
    btn.disabled = false;
  }
  return false;
}

async function cancelVerification(id) {
  if (!confirm(T('vf_cancel_confirm'))) return;
  try {
    await api('/verification/' + id, 'DELETE');
    toast(T('vf_canceled'));
    dashTab('verification');
  } catch (e) { toast('❌ ' + e.message); }
}

const DASH_PAGE = 100;      // annonces par page dans « Mes annonces » (maximum accepté par l'API)
let dashListings = [];

async function dashTab(tab, more = false) {
  currentDashTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b,i) => {
    b.classList.toggle('active', ['mes-annonces','mes-contacts','calendrier','favoris','alertes','profil','vitrine','verification'][i] === tab);
  });
  document.querySelector('#page-dashboard .tab-btn.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });   // onglet actif visible (mobile)
  const c = document.getElementById('dash-tab-content');
  if (!more) c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';   // « Afficher plus » : la liste reste en place

  if (tab === 'verification') { await dashVerification(c); return; }
  if (tab === 'vitrine')       { await dashVitrine(c); return; }
  if (tab === 'calendrier')    { await dashCalendrier(c); return; }

  if (tab === 'mes-annonces') {
    // Liste chargée par pages (DASH_PAGE annonces) : « Afficher plus » ajoute la page suivante
    if (!more) dashListings = [];
    const page = await api('/properties/user/' + currentUser.id + '?limit=' + DASH_PAGE + '&offset=' + dashListings.length);
    const data = dashListings = dashListings.concat(page);
    const hasMore = page.length === DASH_PAGE;
    if (!data.length) {
      c.innerHTML = '<div class="empty-state"><div class="icon">🏠</div><h3>' + T('dash_none') + '</h3><p>' + T('dash_first') + '</p>'
        + '<div style="display:flex;gap:.75rem;justify-content:center;margin-top:1rem;flex-wrap:wrap">'
        + '<button class="btn btn-primary" onclick="showPage(\'publier\')">' + T('btn_publier') + '</button>'
        + '<button class="btn btn-outline" onclick="triggerImportCSV()">' + T('imp_btn') + '</button>'
        + '</div></div>';
      return;
    }

    const promo = await promoPlans();
    const SCOLOR = { active:'#0C6E4F', sold:'#3b82f6', rented:'#f59e0b', archived:'#94a3b8', pending:'#d97706', rejected:'#dc2626', expired:'#b45309' };
    const SLBL   = Object.fromEntries(['active','sold','rented','archived','pending','rejected','expired'].map(k => [k, T('dash_st_' + k)]));
    // « Retirée » : archivée automatiquement faute de confirmation (l'annonceur peut la renouveler)
    const stOf = p => (p.status === 'archived' && p.expired_at) ? 'expired' : p.status;
    const day = d => new Date(d).toLocaleDateString('fr-DZ');
    const FLAGGED = ['price_low', 'price_high', 'duplicate_other'];

    c.innerHTML = `<div style="display:flex;justify-content:flex-end;gap:.6rem;margin-bottom:.75rem;flex-wrap:wrap">
      <a href="/api/import/template" style="font-size:.82rem;color:var(--primary-text);text-decoration:none;line-height:2">${T('imp_dl_tpl')}</a>
      <button class="btn btn-outline btn-sm" onclick="triggerImportCSV()">${T('imp_btn')}</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:.7rem">
      ${data.map(p => {
        const score      = completenessScore(p);
        const scoreColor = score >= 80 ? 'var(--primary)' : score >= 60 ? '#f59e0b' : '#dc2626';
        return `
        <div style="background:var(--white);border-radius:12px;border:1px solid var(--border);overflow:hidden;display:flex;box-shadow:var(--shadow)">
          <img src="${esc(thumbUrl(p.image, 480) || '')}" loading="lazy" style="width:96px;min-height:80px;object-fit:cover;flex-shrink:0;background:var(--border)" onerror="this.style.background='var(--border)'">
          <div style="flex:1;padding:.8rem 1rem;min-width:0">
            <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.3rem">
              <span class="card-mode mode-${p.mode}" style="font-size:.71rem;padding:.1rem .4rem">${MODES[p.mode]||p.mode}</span>
              <span style="background:${SCOLOR[stOf(p)]||'#94a3b8'}20;color:${SCOLOR[stOf(p)]||'#94a3b8'};padding:.1rem .42rem;border-radius:20px;font-size:.71rem;font-weight:700">${SLBL[stOf(p)]||stOf(p)}</span>
              ${p.verified?'<span style="background:#0C6E4F20;color:var(--primary-text);padding:.1rem .42rem;border-radius:20px;font-size:.71rem;font-weight:700">✓</span>':''}
            </div>
            <div style="font-weight:700;font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.title)}">${esc(p.title)}</div>
            <div style="display:flex;align-items:center;gap:.4rem;margin:.2rem 0 .1rem">
              <div style="flex:1;height:3px;background:var(--border);border-radius:2px;overflow:hidden"><div style="width:${score}%;height:100%;background:${scoreColor}"></div></div>
              <span style="font-size:.68rem;color:${scoreColor};font-weight:700;white-space:nowrap">${score} %</span>
            </div>
            <div style="font-size:.79rem;color:var(--text-muted)">📍 ${esc(wilayaName(p.wilaya))} · <strong style="color:var(--primary-text)">${priceText(p)}</strong></div>
            ${p.status === 'rejected' && p.moderation_reason ? `<div style="font-size:.79rem;color:#dc2626;margin-top:.25rem">${T('dash_reason')} ${esc(modReason(p.moderation_reason))}</div>` : ''}
            ${p.status === 'active' && p.last_confirmed_at ? `<div style="font-size:.76rem;margin-top:.3rem;color:${p.expires_at ? '#b45309' : 'var(--text-muted)'};font-weight:${p.expires_at ? 700 : 400}">${p.expires_at
              ? T('dash_expires').replace('{date}', day(p.expires_at)) : T('dash_confirmed').replace('{date}', day(p.last_confirmed_at))}</div>` : ''}
            ${isFeatured(p) ? `<div class="promo-until">${T('dash_featured_until').replace('{date}', day(p.featured_until))}</div>` : ''}
            ${stOf(p) === 'expired' ? `<div style="font-size:.78rem;color:#b45309;margin-top:.3rem">${T('dash_expired_note')}</div>` : ''}
            ${p.status === 'pending' && (p.quality_flags || []).some(f => FLAGGED.includes(f)) ? `<div style="font-size:.78rem;color:#b45309;margin-top:.3rem">⚠ ${T('q_pending_flag')}</div>` : ''}
            <div style="display:flex;gap:1.1rem;margin-top:.4rem;flex-wrap:wrap">
              <span style="font-size:.79rem;color:var(--text-muted)">👁 <strong>${p.views||0}</strong> ${unit(p.views||0, 'u_view')}</span>
              <span style="font-size:.79rem;color:var(--text-muted)">📩 <strong>${p.contact_count||0}</strong> ${unit(p.contact_count||0, 'u_req')}</span>
              <span style="font-size:.79rem;color:var(--text-muted)" title="${esc(T('dash_clicks_tip'))}">📞 <strong>${p.call_clicks||0}</strong> · 💬 <strong>${p.whatsapp_clicks||0}</strong></span>
              <button class="btn btn-outline btn-sm" style="font-size:.72rem;padding:.12rem .42rem;border-color:var(--text-muted);color:var(--text-muted)" onclick="showPropertyStats(${p.id},this)">${T('dash_stats_btn')}</button>
              <span style="font-size:.79rem;color:var(--text-muted)">${new Date(p.created_at).toLocaleDateString('fr-DZ')}</span>
            </div>
          </div>
          <div style="padding:.8rem .65rem;display:flex;flex-direction:column;gap:.35rem;justify-content:center;flex-shrink:0">
            <button class="btn btn-primary btn-sm" style="font-size:.77rem;padding:.3rem .6rem;white-space:nowrap" onclick="showPage('detail',${p.id})">${T('dash_view')}</button>
            <button class="btn btn-outline btn-sm" style="font-size:.77rem;padding:.3rem .6rem;white-space:nowrap" onclick="editProperty(${p.id})">${T('dash_edit')}</button>
            ${p.status === 'rejected' ? `<button class="btn btn-outline btn-sm" style="font-size:.77rem;padding:.3rem .6rem;white-space:nowrap;border-color:#dc2626;color:#dc2626" onclick="ownerDelete(${p.id})">${T('dash_delete')}</button>` : ''}
            ${p.status==='active'?`<button class="btn ${p.expires_at ? 'btn-primary' : 'btn-outline'} btn-sm" style="font-size:.77rem;padding:.3rem .6rem;white-space:nowrap" onclick="ownerRenew(${p.id})">${T('dash_still')}</button>`:''}
            ${stOf(p)==='expired'?`<button class="btn btn-primary btn-sm" style="font-size:.77rem;padding:.3rem .6rem;white-space:nowrap" onclick="ownerRenew(${p.id})">${T('dash_renew')}</button>`:''}
            ${p.status==='active' && promo.enabled && promo.plans.length ? `<button class="btn btn-outline btn-sm promo-btn" style="font-size:.77rem;padding:.3rem .6rem;white-space:nowrap" data-id="${p.id}" onclick="openPromote(this.dataset.id)">${T('dash_feature_btn')}</button>` : ''}
            ${p.status==='active'?`<button class="btn btn-outline btn-sm" style="font-size:.77rem;padding:.3rem .6rem;white-space:nowrap;border-color:#94a3b8;color:#64748b" onclick="ownerArchive(${p.id})">${T('dash_archive')}</button>`:''}
          </div>
        </div>`; }).join('')}
    </div>`
      + (hasMore ? `<div style="text-align:center;margin-top:1rem"><button class="btn btn-outline" onclick="dashTab('mes-annonces', true)">${T('dash_more')}</button></div>` : '')
      + buildViewsChart(data);
  }

  if (tab === 'mes-contacts') {
    const data = await api('/contacts/received');
    if (!data.length) { c.innerHTML = '<div class="empty-state"><div class="icon">📩</div><h3>' + T('dash_no_req') + '</h3></div>'; return; }
    c.innerHTML = data.map(d => `
      <div style="background:var(--white);border-radius:10px;padding:1rem;margin-bottom:.75rem;box-shadow:var(--shadow);display:flex;align-items:center;gap:1rem">
        <img src="${esc(thumbUrl(d.property_image, 480))}" loading="lazy" style="width:64px;height:64px;border-radius:8px;object-fit:cover;background:var(--border)" onerror="this.style.background='#e2e8f0'">
        <div style="flex:1">
          <div style="font-weight:700;font-size:.9rem">${esc(d.property_title)}</div>
          <div style="font-size:.83rem;color:var(--text-muted)">
            <strong>${esc(d.requester_name)}</strong> · ${T('dash_t_' + (['visite', 'offre'].includes(d.type) ? d.type : 'info'))} ·
            <span class="status-${d.status}">${['pending', 'confirmed', 'rejected', 'done'].includes(d.status) ? T('dash_c_' + d.status) : d.status}</span>
            ${d.type === 'visite' && d.visit_date ? ` · 📅 ${esc(String(d.visit_date).slice(0,10))}${d.visit_time ? ' ' + esc(d.visit_time) : ''}` : ''}
          </div>
          ${d.message ? `<div style="font-size:.83rem;color:var(--text-muted);margin-top:.25rem">"${esc(d.message.slice(0,80))}..."</div>` : ''}
        </div>
        ${d.status === 'pending' ? `
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-primary btn-sm" onclick="updateContact(${d.id},'confirmed')">✓</button>
          <button class="btn btn-danger btn-sm" onclick="updateContact(${d.id},'rejected')">✕</button>
        </div>` : ''}
      </div>`).join('');
  }

  if (tab === 'favoris') {
    const data = await api('/favorites');
    const shareBar = `<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;flex-wrap:wrap">
      <button class="btn btn-secondary btn-sm" onclick="shareFavorites()">${T('fav_share_btn')}</button>
      <button class="btn btn-danger btn-sm" onclick="revokeFavorites()" id="fav-revoke-btn" style="display:none">${T('fav_share_revoke')}</button>
      <span id="fav-share-url" style="font-size:.82rem;color:var(--primary-text);word-break:break-all"></span>
    </div>`;
    if (!data.length) { c.innerHTML = shareBar + '<div class="empty-state"><div class="icon">❤️</div><h3>' + T('dash_no_fav') + '</h3><p>' + T('dash_fav_hint') + '</p></div>'; return; }
    const favCards = data.map(p => `
      <div>
        ${cardHTML(p)}
        <div style="background:var(--white);border-radius:0 0 12px 12px;margin-top:-8px;padding:.6rem .75rem;box-shadow:var(--shadow)">
          ${p.note ? `<div style="font-size:.82rem;color:var(--text-secondary);white-space:pre-line;margin-bottom:.4rem">${esc(p.note)}</div>` : ''}
          <textarea rows="2" style="width:100%;resize:none;font-size:.82rem;border:1px solid var(--border);border-radius:6px;padding:.35rem .5rem;font-family:inherit;background:var(--bg)"
            placeholder="${esc(T('fav_note_ph'))}" data-pid="${Number(p.id)}">${esc(p.note || '')}</textarea>
          <div style="display:flex;gap:.4rem;margin-top:.3rem;justify-content:flex-end">
            <button class="btn btn-outline btn-sm" style="font-size:.77rem" data-pid="${Number(p.id)}" onclick="saveFavNote(this)">${T('fav_note_save')}</button>
          </div>
        </div>
      </div>`).join('');
    c.innerHTML = shareBar + `<div class="grid">${favCards}</div>`;
  }

  if (tab === 'alertes') {
    const data = await api('/alerts').catch(() => []);
    const rows = data.map(a => {
      const parts = [
        wilayaName(a.wilaya) || T('s_all_wilayas'),
        MODES[a.mode] || T('s_all_modes'),
        TYPES[a.type_bien] || T('s_all_types'),
        a.min_price ? `≥ ${Number(a.min_price).toLocaleString('fr-DZ')} ${T('u_dzd')}` : null,
        a.max_price ? `≤ ${Number(a.max_price).toLocaleString('fr-DZ')} ${T('u_dzd')}` : null,
        a.min_surface ? `≥ ${a.min_surface} ${T('u_m2')}` : null,
      ].filter(Boolean).join(' · ');
      return `
        <div style="background:var(--white);border-radius:10px;padding:1rem 1.25rem;margin-bottom:.6rem;box-shadow:var(--shadow);display:flex;align-items:center;gap:1rem">
          <div style="flex:1">
            <div style="font-size:.85rem;font-weight:600;color:var(--primary-text)">${T('alert_active')}</div>
            <div style="font-size:.83rem;color:var(--text-muted);margin-top:.2rem">${esc(parts)}</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="deleteAlert(${a.id})">${T('alert_del')}</button>
        </div>`;
    }).join('');
    c.innerHTML = `
      <div style="max-width:520px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
          <h3 style="font-size:1rem;font-weight:700;margin:0">${T('alert_title')}</h3>
          <button class="btn btn-primary btn-sm" onclick="showAlertForm()">${T('alert_new')}</button>
        </div>
        ${rows || `<div class="empty-state"><div class="icon">🔔</div><p>${T('alert_empty')}</p></div>`}
        <div id="alert-form" class="hidden" style="background:var(--white);border-radius:10px;padding:1.25rem;box-shadow:var(--shadow);margin-top:1rem">
          <h4 style="margin:0 0 1rem;font-size:.95rem;font-weight:700">${T('alert_new')}</h4>
          <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:.6rem">
            <div class="form-group"><label>${T('alert_wilaya')}</label><select id="al-wilaya" style="width:100%;padding:.45rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.88rem"><option value="">${T('s_all_wilayas')}</option></select></div>
            <div class="form-group"><label>${T('alert_mode')}</label>
              <select id="al-mode" style="width:100%;padding:.45rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.88rem">
                <option value="">${T('s_all_modes')}</option>
                <option value="vente">${T('s_vente')}</option>
                <option value="location_longue">${T('s_loc_longue')}</option>
                <option value="location_courte">${T('s_loc_courte')}</option>
              </select></div>
            <div class="form-group"><label>${T('alert_type')}</label>
              <select id="al-type" style="width:100%;padding:.45rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.88rem">
                <option value="">${T('s_all_types')}</option>
                <option value="appartement">${T('s_appart')}</option>
                <option value="villa">${T('s_villa')}</option>
                <option value="maison">${T('s_maison')}</option>
                <option value="bureau">${T('s_bureau')}</option>
                <option value="local_commercial">${T('s_local')}</option>
                <option value="terrain">${T('s_terrain')}</option>
                <option value="ferme">${T('s_ferme')}</option>
                <option value="entrepot">${T('s_entrepot')}</option>
              </select></div>
            <div class="form-group"><label>${T('alert_min_surf')}</label><input id="al-surf" type="number" min="0" placeholder="${T('ph_example').replace('{v}', '80')}" style="width:100%;padding:.45rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.88rem"></div>
            <div class="form-group"><label>${T('alert_min_price')}</label><input id="al-min-price" type="number" min="0" placeholder="${T('ph_example').replace('{v}', formatPrice(5000000))}" style="width:100%;padding:.45rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.88rem"></div>
            <div class="form-group"><label>${T('alert_max_price')}</label><input id="al-max-price" type="number" min="0" placeholder="${T('ph_example').replace('{v}', formatPrice(20000000))}" style="width:100%;padding:.45rem .7rem;border:1.5px solid var(--border);border-radius:8px;font-size:.88rem"></div>
          </div>
          <div style="display:flex;gap:.6rem;margin-top:.75rem">
            <button class="btn btn-primary btn-sm" onclick="saveAlert()">${T('alert_save')}</button>
            <button class="btn btn-outline btn-sm" onclick="document.getElementById('alert-form').classList.add('hidden')">${T('alert_cancel')}</button>
          </div>
        </div>
      </div>`;
    // Remplir le select wilaya
    const wilayaSelect = document.getElementById('al-wilaya');
    if (wilayaSelect) fillWilayaSelect(wilayaSelect);
  }

  if (tab === 'profil') {
    c.innerHTML = `
      <div style="max-width:480px">
        <div style="background:var(--white);border-radius:var(--radius);padding:1.5rem;box-shadow:var(--shadow)">
          <h3 style="font-size:1rem;font-weight:700;margin-bottom:1.25rem">${T('prof_title')}</h3>
          <div class="form-row"><label>${T('prof_name')}</label><input id="p-name" value="${esc(currentUser.name)}"></div>
          <div class="form-row"><label>${T('prof_email')}</label><input value="${esc(currentUser.email)}" disabled style="background:#f1f5f9"></div>
          <div class="form-row"><label>${T('prof_phone')}</label><input id="p-phone" type="tel" value="${esc(currentUser.phone || '')}"><div class="field-hint">${T('m_phone_hint')}</div></div>
          <div class="form-row"><label>${T('prof_bio')}</label><textarea id="p-bio" rows="3">${esc(currentUser.bio || '')}</textarea></div>
          <label class="profile-check"><input type="checkbox" id="p-notify-drop"${currentUser.notify_price_drop === false ? '' : ' checked'}> <span>${T('prof_notify_drop')}</span></label>
          <div class="field-hint">${T('prof_notify_drop_hint')}</div>
          <button id="push-btn" class="btn btn-outline btn-sm" style="margin-top:.5rem;width:100%" onclick="togglePush(this)">${esc(T('prof_push_enable'))}</button>
          <div class="field-hint">${T('prof_push_hint')}</div>
          <div style="display:flex;gap:.75rem;margin-top:1rem">
            <button class="btn btn-primary" style="flex:1" onclick="updateProfile()">${T('prof_save')}</button>
            <button class="btn btn-danger btn-sm" onclick="if(confirm(T('prof_logout_confirm'))) logout()">${T('prof_logout')}</button>
          </div>
          <button class="btn btn-outline btn-sm" style="margin-top:.75rem;width:100%" onclick="exportData()">⬇ ${T('prof_export')}</button>
        </div>
      </div>`;
    _initPushBtnState();
  }
}

function showAlertForm() {
  const f = document.getElementById('alert-form');
  if (f) f.classList.toggle('hidden');
}

async function createAlertFromFilters() {
  if (!currentUser) { openModal('login'); return; }
  const wilaya    = document.getElementById('f-wilaya')?.value || '';
  const mode      = document.getElementById('f-mode')?.value   || '';
  const type_bien = document.getElementById('f-type')?.value   || '';
  const min_price   = document.getElementById('f-min-price')?.value   || '';
  const max_price   = document.getElementById('f-max-price')?.value   || '';
  const min_surface = document.getElementById('f-min-surface')?.value || '';
  try {
    await api('/alerts', 'POST', { wilaya, mode, type_bien, min_price, max_price, min_surface });
    toast(T('alert_saved'));
  } catch (e) {
    toast('❌ ' + (e.message || T('alert_max')));
  }
}

async function saveAlert() {
  if (!currentUser) { openModal('login'); return; }
  const wilaya     = document.getElementById('al-wilaya')?.value    || '';
  const mode       = document.getElementById('al-mode')?.value      || '';
  const type_bien  = document.getElementById('al-type')?.value      || '';
  const min_price  = document.getElementById('al-min-price')?.value || '';
  const max_price  = document.getElementById('al-max-price')?.value || '';
  const min_surface= document.getElementById('al-surf')?.value      || '';
  try {
    await api('/alerts', 'POST', { wilaya, mode, type_bien, min_price, max_price, min_surface });
    toast(T('alert_saved'));
    dashTab('alertes');
  } catch (e) {
    toast('❌ ' + (e.message || T('alert_max')));
  }
}

async function shareFavorites() {
  try {
    const { url } = await api('/favorites/share', 'POST');
    const fullUrl = location.origin + url;
    const urlEl = document.getElementById('fav-share-url');
    const revokeEl = document.getElementById('fav-revoke-btn');
    if (urlEl) urlEl.textContent = fullUrl;
    if (revokeEl) revokeEl.style.display = '';
    try { await navigator.clipboard.writeText(fullUrl); toast('🔗 ' + T('fav_share_copied')); } catch { toast('🔗 ' + T('fav_share_copied')); }
  } catch (e) { toast('❌ ' + e.message); }
}
async function revokeFavorites() {
  try {
    await api('/favorites/share', 'DELETE');
    const urlEl = document.getElementById('fav-share-url');
    const revokeEl = document.getElementById('fav-revoke-btn');
    if (urlEl) urlEl.textContent = '';
    if (revokeEl) revokeEl.style.display = 'none';
    toast('✅ ' + T('fav_share_revoked'));
  } catch (e) { toast('❌ ' + e.message); }
}

async function saveFavNote(btn) {
  const pid = Number(btn.dataset.pid);
  const textarea = btn.closest('div').previousElementSibling;
  const note = textarea ? textarea.value.trim() : '';
  try {
    await api('/favorites/' + pid + '/note', 'PUT', { note: note || null });
    toast(T('fav_note_saved'));
  } catch (e) { toast('❌ ' + e.message); }
}

async function deleteAlert(id) {
  try {
    await api('/alerts/' + id, 'DELETE');
    dashTab('alertes');
  } catch (e) { toast('❌ ' + e.message); }
}

// Copie les wilayas de #f-wilaya dans un select donné (formulaire d'alertes).
// Nom distinct de populateWilayas() : le doublon écrasait la fonction d'init et faisait planter init().
function fillWilayaSelect(select) {
  const src = document.getElementById('f-wilaya');
  if (!src) return;
  Array.from(src.options).forEach(o => {
    if (o.value) select.add(new Option(o.text, o.value));
  });
}

async function updateContact(id, status) {
  try { await api('/contacts/' + id + '/status', 'PUT', { status }); dashTab('mes-contacts'); toast(T('dash_status_updated')); }
  catch (e) { toast('❌ ' + e.message); }
}

async function updateProfile() {
  const name  = document.getElementById('p-name')?.value;
  const phone = document.getElementById('p-phone')?.value;
  const bio   = document.getElementById('p-bio')?.value;
  const notify_price_drop = !!document.getElementById('p-notify-drop')?.checked;
  try {
    const updated = await api('/auth/profile', 'PUT', { name, phone, bio, notify_price_drop });
    currentUser = { ...currentUser, ...updated };
    document.getElementById('avatar-btn').textContent = (currentUser.name || '?')[0].toUpperCase();
    toast(T('prof_updated'));
  } catch (e) { toast('❌ ' + e.message); }
}

// ── Publication ───────────────────────────────────
function previewPhotos(input) {
  const previews = document.getElementById('photo-previews');
  Array.from(input.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      uploadedPhotos.push({ file, preview: e.target.result });
      renderPhotoPreviews();
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function renderPhotoPreviews() {
  const c = document.getElementById('photo-previews');
  c.innerHTML = uploadedPhotos.map((p, i) => `
    <div class="photo-preview">
      <img src="${esc(p.preview)}" alt="">
      <button class="photo-remove" onclick="removePhoto(${i})">×</button>
    </div>`).join('');
  updatePublishScore();
}

function removePhoto(i) {
  uploadedPhotos.splice(i, 1);
  renderPhotoPreviews();
}

document.querySelectorAll('.feature-toggle').forEach(btn => {
  btn.addEventListener('click', () => btn.classList.toggle('selected'));
});

// ── Score de complétude d'une annonce (0–100) ────────────────────────────────
// Fonctionne sur un objet annonce (tableau de bord) ou sur les données du formulaire (via formScoreData).
function completenessScore(d) {
  let s = 0;
  if (String(d.title       || '').length >= 20) s += 20;
  if (String(d.description || '').length >= 100) s += 20;
  const pc = d.photos_count != null ? d.photos_count : (Array.isArray(d.photos) ? d.photos.length : 0);
  if (pc >= 3)                                  s += 20;
  if (Number(d.price) > 0)                      s += 10;
  if (Number(d.surface_m2) > 0)                 s += 10;
  if (Number(d.rooms) > 0)                      s += 5;
  if (String(d.commune || '').trim())            s += 5;
  const fc = d.features_count != null ? d.features_count : (Array.isArray(d.features) ? d.features.length : 0);
  if (fc >= 3)                                  s += 5;
  if (d.video_url || d.tour_url)                s += 5;
  return s;
}

// Lit les valeurs actuelles du formulaire de publication pour le calcul du score.
function formScoreData() {
  const val = id => (document.getElementById(id)?.value || '');
  return {
    title:          val('pub-title'),
    description:    val('pub-desc'),
    photos_count:   uploadedPhotos.length,
    price:          val('pub-price'),
    surface_m2:     val('pub-surface'),
    rooms:          val('pub-rooms'),
    commune:        val('pub-commune'),
    features_count: document.querySelectorAll('.feature-toggle.selected').length,
    video_url:      val('pub-video'),
    tour_url:       val('pub-tour'),
  };
}

// Met à jour la jauge dans le formulaire de publication.
function updatePublishScore() {
  const bar = document.getElementById('pub-score-bar');
  const pct = document.getElementById('pub-score-pct');
  if (!bar || !pct) return;
  const s = completenessScore(formScoreData());
  bar.style.width      = s + '%';
  const color = s >= 80 ? 'var(--primary)' : s >= 60 ? '#f59e0b' : '#dc2626';
  bar.style.background = color;
  pct.style.color      = s >= 80 ? 'var(--primary-text)' : s >= 60 ? '#d97706' : '#dc2626';
  pct.textContent      = s + ' %';
}

// Branche les écouteurs de la jauge sur tous les champs du formulaire.
function initPublishScore() {
  PUB_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePublishScore);
  });
  document.querySelectorAll('.feature-toggle').forEach(b =>
    b.addEventListener('click', () => setTimeout(updatePublishScore, 0)));
  updatePublishScore();
}

// ── Estimation automatique de prix ────────────────────────────────────────────────────────────────────────────────────────
// Affiche une fourchette de prix indicative sous le champ prix du formulaire de publication,
// d'après les annonces actives similaires (même mode + type + wilaya).
let _estimateTimer = null;
function initEstimate() {
  const priceEl = document.getElementById('pub-price');
  if (!priceEl) return;
  let hint = document.getElementById('pub-estimate');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'pub-estimate';
    hint.className = 'pub-estimate-hint';
    priceEl.insertAdjacentElement('afterend', hint);
  }
  const trigger = ['pub-mode', 'pub-type', 'pub-wilaya', 'pub-surface'].map(id => document.getElementById(id)).filter(Boolean);
  const refresh = () => {
    clearTimeout(_estimateTimer);
    _estimateTimer = setTimeout(async () => {
      const mode    = (document.getElementById('pub-mode')?.value    || '').trim();
      const type    = (document.getElementById('pub-type')?.value    || '').trim();
      const wilaya  = (document.getElementById('pub-wilaya')?.value  || '').trim();
      const surface = (document.getElementById('pub-surface')?.value || '').trim();
      if (!mode || !type || !wilaya) { hint.textContent = ''; return; }
      hint.innerHTML = T('pub_estimate_loading');
      const q = `mode=${encodeURIComponent(mode)}&type_bien=${encodeURIComponent(type)}&wilaya=${encodeURIComponent(wilaya)}` +
                (surface ? `&surface_m2=${encodeURIComponent(surface)}` : '');
      const d = await api('GET', `/api/properties/estimate?${q}`).catch(() => null);
      if (!d || !d.count) { hint.textContent = T('pub_estimate_none'); return; }
      const fmt = n => Number(n).toLocaleString('fr-DZ');
      hint.innerHTML = T('pub_estimate_hint').replace('{low}', fmt(d.low)).replace('{high}', fmt(d.high)).replace('{median}', fmt(d.median)) +
        (d.per_m2 ? ' · ' + T('pub_estimate_per_m2').replace('{per_m2}', fmt(d.per_m2)) : '');
    }, 600);
  };
  trigger.forEach(el => el.addEventListener('change', refresh));
  refresh();
}

// ── Modification d'une annonce : le formulaire de publication sert aussi d'écran « Modifier » ─────────────────────────────
// Le mode, le type de bien et la wilaya restent figés (le serveur ne les change pas : ils fondent le contrôle de qualité et la recherche).
const PUB_LOCKED = ['pub-mode', 'pub-type', 'pub-wilaya'];
const PUB_FIELDS = ['pub-title', 'pub-price', 'pub-surface', 'pub-rooms', 'pub-baths', 'pub-floor', 'pub-commune', 'pub-address', 'pub-desc', 'pub-video', 'pub-tour'];

// Titre, bouton et note du formulaire selon le mode ; la clé i18n change aussi, pour que le changement de langue garde le bon texte
function syncPublishMode() {
  const edit = !!publishEditId;
  const set = (id, key) => { const el = document.getElementById(id); if (el) { el.setAttribute('data-i18n', key); el.textContent = T(key); } };
  set('pub-heading-text', edit ? 'pub_edit_heading' : 'pub_heading');
  set('pub-submit-btn', edit ? 'pub_edit_submit' : 'pub_submit');
  document.getElementById('pub-edit-note')?.classList.toggle('hidden', !edit);
  PUB_LOCKED.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = edit; });
  if (edit) document.getElementById('pub-as-wrap')?.classList.add('hidden');   // la vitrine d'une annonce ne se change pas ici
}

// Formulaire vidé (sortie du mode édition) : plus aucune donnée de l'annonce modifiée ne reste à l'écran
function resetPublishForm() {
  PUB_FIELDS.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.querySelectorAll('.feature-toggle.selected').forEach(b => b.classList.remove('selected'));
  uploadedPhotos = [];
  renderPhotoPreviews();
  ['pub-error', 'pub-success'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  syncPublishMode();
}

// Valeur numérique d'une annonce pour un champ de formulaire (« » si absente)
const fieldNum = v => (v === null || v === undefined || v === '' ? '' : String(Number(v)));

// Remplit le formulaire avec une annonce du tableau de bord (la liste renvoie déjà toutes les colonnes : aucune requête de plus, aucune vue comptée)
function fillPublishForm(p) {
  const put = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  put('pub-title', p.title || ''); put('pub-mode', p.mode || ''); put('pub-type', p.type_bien || ''); put('pub-wilaya', p.wilaya || '');
  put('pub-price', fieldNum(p.price)); put('pub-surface', fieldNum(p.surface_m2)); put('pub-rooms', fieldNum(p.rooms));
  put('pub-baths', fieldNum(p.baths)); put('pub-floor', fieldNum(p.floor));
  put('pub-commune', p.commune || ''); put('pub-address', p.address || ''); put('pub-desc', p.description || '');
  put('pub-video', p.video_url || ''); put('pub-tour', p.tour_url || '');
  const feats = Array.isArray(p.features) ? p.features : [];
  document.querySelectorAll('.feature-toggle').forEach(b => b.classList.toggle('selected', feats.includes(b.dataset.v)));
  const urls = Array.isArray(p.photos) && p.photos.length ? p.photos : (p.image ? [p.image] : []);
  uploadedPhotos = urls.map(url => ({ url, preview: thumbUrl(url, 480) || url }));
  renderPhotoPreviews();
  ['pub-error', 'pub-success'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
}

// Bouton « Modifier » d'une carte du tableau de bord : seul l'identifiant passe par l'attribut, l'annonce vient de la liste déjà chargée
function editProperty(id) {
  const p = dashListings.find(x => x.id === id);
  if (!p) return;
  publishEditId = p.id;
  showPage('publier');
  fillPublishForm(p);
}

// « Annuler » : retour au tableau de bord si l'on modifiait, à l'accueil sinon
function cancelPublish() { showPage(publishEditId ? 'dashboard' : 'home'); }

async function submitProperty() {
  const editing = publishEditId;
  const val     = id => document.getElementById(id).value;
  const title   = val('pub-title');
  const mode    = val('pub-mode');
  const type    = val('pub-type');
  const price   = val('pub-price');
  const wilaya  = val('pub-wilaya');

  const errEl = document.getElementById('pub-error');
  const sucEl = document.getElementById('pub-success');
  errEl.classList.add('hidden');
  sucEl.classList.add('hidden');

  if (!title || !price || !wilaya) {
    errEl.textContent = 'Veuillez remplir tous les champs obligatoires.';
    errEl.classList.remove('hidden'); return;
  }
  if (!uploadedPhotos.length) {
    errEl.textContent = T('pub_photos_req');
    errEl.classList.remove('hidden'); return;
  }

  const features = Array.from(document.querySelectorAll('.feature-toggle.selected')).map(b => b.dataset.v);

  // Photos : celles déjà en ligne gardent leur adresse (dans l'ordre choisi), les nouvelles sont envoyées
  let photoUrls = [];
  for (const p of uploadedPhotos) {
    if (p.url) { photoUrls.push(p.url); continue; }
    try {
      const fd = new FormData();
      fd.append('file', p.file);
      const r  = await fetch(API + '/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Lang': currentLang }, body: fd });
      const d  = await r.json();
      if (d.url) photoUrls.push(d.url);
    } catch {}
  }

  try {
    const fields = {
      title, price: Number(price),
      commune:     val('pub-commune') || null,
      address:     val('pub-address') || null,
      description: val('pub-desc') || '',
      surface_m2:  Number(val('pub-surface')) || null,
      rooms:       Number(val('pub-rooms')) || null,
      baths:       Number(val('pub-baths')) || null,
      floor:       val('pub-floor') === '' ? null : Number(val('pub-floor')),
      features, photos: photoUrls,
      image: photoUrls[0] || '',
      video_url:   val('pub-video').trim() || null,
      tour_url:    val('pub-tour').trim() || null,
    };
    if (editing) {
      const r = await api('/properties/' + editing, 'PUT', fields);
      const pending = r.status === 'pending';
      sucEl.textContent = (pending ? '⏳ ' : '✅ ') + T(pending ? 'pub_edit_pending' : 'pub_edit_saved');
      const QWE = { duplicate_own: 'q_dup_own', duplicate_other: 'q_dup_other', price_low: 'q_price_low', price_high: 'q_price_high', content_bypass: 'q_content_bypass' };
      const warnsE = (r.warnings || []).map(w => T(QWE[w.code] || 'q_price_low').replace('{title}', w.title || ''));
      if (warnsE.length) sucEl.innerHTML = esc(sucEl.textContent) + '<ul class="q-list">' + warnsE.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
      sucEl.classList.remove('hidden');
      // Les photos envoyées sont désormais en ligne : un second clic ne les renvoie pas
      uploadedPhotos = photoUrls.map(url => ({ url, preview: thumbUrl(url, 480) || url }));
      renderPhotoPreviews();
      setTimeout(() => { if (publishEditId === editing) showPage('dashboard'); }, warnsE.length ? 9000 : 1500);
      return;
    }
    const body = { ...fields, mode, type_bien: type, wilaya,
      ...publishAffiliation(),   // agency_id / project_id : annonce publiée au nom de sa vitrine (pro.js)
    };
    const r = await api('/properties', 'POST', body);
    // Modération : une annonce « pending » n'est pas encore publique, on renvoie vers le tableau de bord
    const pending = r.status === 'pending';
    sucEl.textContent = pending ? '⏳ ' + T('mod_pending_ok') : '✅ Annonce publiée avec succès !';
    // Avertissements de qualité (prix inhabituel, doublon, texte copié) : lus avant la redirection
    const QW = { duplicate_own: 'q_dup_own', duplicate_other: 'q_dup_other', price_low: 'q_price_low', price_high: 'q_price_high', content_bypass: 'q_content_bypass' };
    const warns = (r.warnings || []).map(w => T(QW[w.code] || 'q_price_low').replace('{title}', w.title || ''));
    if (r.held) warns.push(T('q_held'));
    if (warns.length) sucEl.innerHTML = esc(sucEl.textContent) + '<ul class="q-list">' + warns.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
    sucEl.classList.remove('hidden');
    uploadedPhotos = [];
    document.getElementById('pub-video').value = document.getElementById('pub-tour').value = '';
    renderPhotoPreviews();
    setTimeout(() => pending ? showPage('dashboard') : showPage('detail', r.id), warns.length ? 9000 : pending ? 3500 : 1500);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

// ── Messagerie ────────────────────────────────────
let currentChatProperty = null;
let currentChatUser = null;

async function loadMessages() {
  if (!token) { showPage('home'); openModal('login'); return; }
  const list = document.getElementById('conv-list');
  try {
    const data = await api('/messages');
    if (!data.length) {
      list.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:.88rem">' + T('msg_none') + '</div>';
      return;
    }
    list.innerHTML = data.map(c => `
      <div class="conv-item" onclick="loadThread(${c.property_id}, ${c.other_id})">
        <img class="conv-thumb" src="${esc(thumbUrl(c.property_img, 480) || '')}" alt="" loading="lazy" onerror="this.style.background='#e2e8f0';this.src=''">
        <div class="conv-info">
          <div class="conv-name">${esc(c.other_name)}${c.unread > 0 ? ` <span class="badge">${c.unread}</span>` : ''}</div>
          <div class="conv-title">${esc(c.property_title)}</div>
          <div class="conv-last">${esc(c.last_msg || '')}</div>
        </div>
      </div>`).join('');
  } catch (e) { list.innerHTML = `<p style="padding:1rem;color:red;font-size:.85rem">${e.message}</p>`; }
}

async function loadThread(propertyId, otherId) {
  currentChatProperty = propertyId;
  currentChatUser = otherId;
  const panel = document.getElementById('chat-panel');
  panel.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const d = await api(`/messages/${propertyId}/${otherId}`);
    panel.innerHTML = `
      <div class="chat-header">${esc(d.other?.name || '')} · <span style="font-size:.85rem;color:var(--text-muted)">${esc(d.property?.title || '')}</span></div>
      <div class="chat-messages" id="chat-msgs">
        ${d.thread.map(m => `
          <div>
            <div class="msg-bubble ${m.from_id === currentUser.id ? 'mine' : 'other'}">${esc(m.body)}</div>
            <div class="msg-time" style="text-align:${m.from_id === currentUser.id ? 'right' : 'left'}">${new Date(m.created_at).toLocaleTimeString('fr-DZ',{hour:'2-digit',minute:'2-digit'})}</div>
          </div>`).join('')}
      </div>
      <div class="chat-input">
        <textarea id="chat-input-text" placeholder="Votre message…" rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage();}"></textarea>
        <button class="btn btn-primary" onclick="sendMessage()" style="padding:.6rem 1rem">Envoyer</button>
      </div>`;
    const msgs = document.getElementById('chat-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  } catch (e) { panel.innerHTML = `<div style="padding:2rem;color:red">${e.message}</div>`; }
}

async function sendMessage() {
  const input = document.getElementById('chat-input-text');
  const body  = input?.value?.trim();
  if (!body || !currentChatProperty || !currentChatUser) return;
  try {
    await api('/messages', 'POST', { to_id: currentChatUser, property_id: currentChatProperty, body });
    input.value = '';
    loadThread(currentChatProperty, currentChatUser);
  } catch (e) { toast('❌ ' + e.message); }
}

// ── Notifications push (Web Push API / VAPID) ──────────────────────────────
let _pushSub = null;

async function registerPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const r = await fetch('/api/push/key');
    const { key } = await r.json();
    if (!key) return;                          // push désactivé côté serveur
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (Notification.permission === 'denied') return;
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;
      }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    }
    _pushSub = sub;
    await api('/push/subscribe', 'POST', {
      endpoint: sub.endpoint,
      p256dh:   btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))),
      auth:     btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')))),
    });
  } catch {}
}

async function unregisterPush() {
  try {
    const sub = _pushSub || (await (await navigator.serviceWorker?.ready)?.pushManager?.getSubscription());
    if (sub && token) {
      await api('/push/subscribe', 'DELETE', { endpoint: sub.endpoint }).catch(() => {});
    }
    _pushSub = null;
  } catch {}
}

async function togglePush(btn) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast(T('prof_push_na')); return;
  }
  if (_pushSub) {
    await unregisterPush();
    if (btn) btn.textContent = T('prof_push_enable');
  } else {
    await registerPush();
    if (_pushSub && btn) btn.textContent = T('prof_push_disable');
  }
}

async function _initPushBtnState() {
  const btn = document.getElementById('push-btn');
  if (!btn) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    btn.textContent = T('prof_push_na'); btn.disabled = true; return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { _pushSub = sub; btn.textContent = T('prof_push_disable'); }
  } catch {}
}

// ── Export RGPD (loi 18-07 / droit d'accès) ────────────────────────────────
async function exportData() {
  try {
    const r = await fetch(`${API}/auth/export`, { headers: { Authorization: `Bearer ${token}`, 'X-Lang': currentLang } });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || T('err_server')); }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dzimmo-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (e) { toast('❌ ' + e.message); }
}

// ── Simulateur de crédit immobilier ────────────────────────────────────────
function calcCreditAnnonce(propertyId) {
  const amount  = Number(document.getElementById('cc-amount-'  + propertyId)?.value) || 0;
  const apport  = Number(document.getElementById('cc-apport-'  + propertyId)?.value) || 0;
  const years   = Number(document.getElementById('cc-years-'   + propertyId)?.value) || 20;
  const rate    = Number(document.getElementById('cc-rate-'    + propertyId)?.value) || 5;
  const res     = document.getElementById('cc-result-' + propertyId);
  if (!res) return;
  const loan = amount - apport;
  if (loan <= 0 || years <= 0 || rate <= 0) { res.innerHTML = ''; return; }
  const r = rate / 100 / 12;
  const n = years * 12;
  const monthly = loan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  const totalInterest = monthly * n - loan;
  const fmt = v => Math.round(v).toLocaleString('fr-DZ') + ' DZD';
  res.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;margin-top:.75rem">
      <div style="background:var(--bg);border-radius:8px;padding:.75rem;text-align:center">
        <div style="font-size:.78rem;color:var(--text-muted)">${T('calc_monthly')}</div>
        <div style="font-size:1.2rem;font-weight:800;color:var(--primary-text)">${fmt(monthly)}</div>
      </div>
      <div style="background:var(--bg);border-radius:8px;padding:.75rem;text-align:center">
        <div style="font-size:.78rem;color:var(--text-muted)">${T('calc_loan')}</div>
        <div style="font-size:1.1rem;font-weight:700">${fmt(loan)}</div>
      </div>
      <div style="background:var(--bg);border-radius:8px;padding:.75rem;text-align:center">
        <div style="font-size:.78rem;color:var(--text-muted)">${T('calc_total_interest')}</div>
        <div style="font-size:1.1rem;font-weight:700;color:#ef4444">${fmt(totalInterest)}</div>
      </div>
      <div style="background:var(--bg);border-radius:8px;padding:.75rem;text-align:center">
        <div style="font-size:.78rem;color:var(--text-muted)">${T('calc_total')}</div>
        <div style="font-size:1.1rem;font-weight:700">${fmt(monthly * n)}</div>
      </div>
    </div>
    <div style="font-size:.75rem;color:var(--text-muted);margin-top:.5rem">${T('calc_disclaimer')}</div>`;
}

function loadCalcCredit(propertyId, price) {
  const container = document.getElementById('detail-content');
  if (!container) return;
  const section = document.createElement('div');
  section.style.cssText = 'margin-top:1.5rem';
  const apport = Math.round((price || 0) * 0.2);
  section.innerHTML = `
    <div style="background:var(--white);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;box-shadow:var(--shadow)">
      <h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem">${T('calc_title')}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem">
        <div class="form-row" style="margin:0"><label style="font-size:.82rem">${T('calc_amount')}</label>
          <input id="cc-amount-${propertyId}" type="number" value="${price || ''}" min="0" oninput="calcCreditAnnonce(${propertyId})"></div>
        <div class="form-row" style="margin:0"><label style="font-size:.82rem">${T('calc_apport')}</label>
          <input id="cc-apport-${propertyId}" type="number" value="${apport}" min="0" oninput="calcCreditAnnonce(${propertyId})"></div>
        <div class="form-row" style="margin:0"><label style="font-size:.82rem">${T('calc_duration')}</label>
          <input id="cc-years-${propertyId}" type="number" value="20" min="1" max="30" oninput="calcCreditAnnonce(${propertyId})"></div>
        <div class="form-row" style="margin:0"><label style="font-size:.82rem">${T('calc_rate')}</label>
          <input id="cc-rate-${propertyId}" type="number" value="5" min="0.1" max="50" step="0.1" oninput="calcCreditAnnonce(${propertyId})"></div>
      </div>
      <div id="cc-result-${propertyId}"></div>
    </div>`;
  container.appendChild(section);
  calcCreditAnnonce(propertyId);
}

// ── Outil d'estimation de prix ──────────────────────────────────────────────
function openEstimationModal() {
  const ws = document.getElementById('est-wilaya');
  if (ws && !ws.options.length) fillWilayaSelect(ws);
  document.getElementById('est-result').innerHTML = '';
  openModal('estimation');
}

async function submitEstimation() {
  const type_bien = document.getElementById('est-type')?.value || '';
  const wilaya    = document.getElementById('est-wilaya')?.value || '';
  const mode      = document.getElementById('est-mode')?.value || 'vente';
  const surface   = document.getElementById('est-surface')?.value || '';
  if (!wilaya || !surface || Number(surface) <= 0) return;
  const res = document.getElementById('est-result');
  res.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const p = new URLSearchParams({ mode, wilaya });
    if (type_bien) p.set('type_bien', type_bien);
    if (surface)   p.set('surface', surface);
    const d = await api('/properties/estimation?' + p);
    if (!d.count || d.count < 2) {
      res.innerHTML = `<div class="empty-state" style="margin:1rem 0"><p>${T('est_no_data')}</p></div>`;
      return;
    }
    const surf = Number(surface);
    const fmt  = v => v ? Math.round(v * surf).toLocaleString('fr-DZ') + ' DZD' : '—';
    const fmPm2= v => v ? Math.round(v).toLocaleString('fr-DZ') + ' DZD/m²' : '—';
    res.innerHTML = `
      <div style="margin-top:1rem">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.6rem;margin-bottom:.75rem">
          <div style="background:var(--bg);border-radius:8px;padding:.75rem;text-align:center">
            <div style="font-size:.75rem;color:var(--text-muted)">${T('est_low')}</div>
            <div style="font-size:1rem;font-weight:700;color:var(--primary-text)">${fmt(d.p25_pm2)}</div>
            <div style="font-size:.7rem;color:var(--text-muted)">${fmPm2(d.p25_pm2)}</div>
          </div>
          <div style="background:var(--bg);border-radius:8px;padding:.75rem;text-align:center;border:2px solid var(--primary)">
            <div style="font-size:.75rem;color:var(--text-muted)">${T('est_mid')}</div>
            <div style="font-size:1.1rem;font-weight:800;color:var(--primary-text)">${fmt(d.avg_pm2)}</div>
            <div style="font-size:.7rem;color:var(--text-muted)">${fmPm2(d.avg_pm2)}</div>
          </div>
          <div style="background:var(--bg);border-radius:8px;padding:.75rem;text-align:center">
            <div style="font-size:.75rem;color:var(--text-muted)">${T('est_high')}</div>
            <div style="font-size:1rem;font-weight:700;color:var(--primary-text)">${fmt(d.p75_pm2)}</div>
            <div style="font-size:.7rem;color:var(--text-muted)">${fmPm2(d.p75_pm2)}</div>
          </div>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">
          ${T('est_count').replace('{n}', d.count)} · ${T(d.scope === 'wilaya' ? 'est_scope_wilaya' : 'est_scope_national')}
        </div>
      </div>`;
  } catch (e) {
    res.innerHTML = '';
    toast('❌ ' + e.message);
  }
}

// ── Calendrier des visites ──────────────────────────────────────────────────
async function dashCalendrier(c) {
  try {
    const [mine, received] = await Promise.all([
      api('/contacts/mine'),
      api('/contacts/received'),
    ]);
    const visits = [...mine, ...received]
      .filter(v => v.type === 'visite' && v.status === 'confirmed' && v.visit_date)
      .sort((a, b) => a.visit_date.localeCompare(b.visit_date));

    const today = new Date(); today.setHours(0,0,0,0);
    const upcoming = visits.filter(v => new Date(v.visit_date) >= today);

    if (!upcoming.length) {
      c.innerHTML = `<div class="empty-state"><div class="icon">📅</div><p>${T('cal_none')}</p></div>`;
      return;
    }

    // Calendrier HTML — mois courant + suivant
    const months = {};
    upcoming.forEach(v => {
      const d = new Date(v.visit_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!months[key]) months[key] = [];
      months[key].push(v);
    });

    const dayNames = currentLang === 'ar'
      ? ['أحد','اثن','ثلا','أرب','خمي','جمع','سبت']
      : ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

    let html = `<h3 style="font-size:1rem;font-weight:700;margin-bottom:1rem">${T('cal_title')}</h3>`;
    for (const [key, kvs] of Object.entries(months)) {
      const [yr, mo] = key.split('-').map(Number);
      const firstDay = new Date(yr, mo - 1, 1);
      const daysInMonth = new Date(yr, mo, 0).getDate();
      const startDow = (firstDay.getDay() + 6) % 7; // lundi=0
      const visitDays = {};
      kvs.forEach(v => {
        const day = Number(v.visit_date.slice(8, 10));
        if (!visitDays[day]) visitDays[day] = [];
        visitDays[day].push(v);
      });
      const monthName = firstDay.toLocaleDateString(currentLang === 'ar' ? 'ar-DZ' : 'fr-DZ', { month: 'long', year: 'numeric' });
      html += `<div style="background:var(--white);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;box-shadow:var(--shadow);margin-bottom:1rem">
        <div style="font-weight:700;margin-bottom:.75rem;text-align:center">${esc(monthName)}</div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">
          ${dayNames.map(d => `<div style="font-size:.72rem;font-weight:600;color:var(--text-muted);padding:.25rem">${d}</div>`).join('')}
          ${Array(startDow).fill('<div></div>').join('')}
          ${Array.from({length: daysInMonth}, (_, i) => {
            const day = i + 1;
            const isToday = new Date(yr, mo-1, day).toDateString() === new Date().toDateString();
            const hasVisit = visitDays[day];
            const style = `border-radius:50%;width:2rem;height:2rem;line-height:2rem;margin:auto;font-size:.85rem;cursor:${hasVisit?'pointer':'default'};`
              + (isToday ? 'background:var(--primary);color:#fff;font-weight:700;' : '')
              + (hasVisit && !isToday ? 'background:rgba(12,110,79,.15);color:var(--primary-text);font-weight:700;' : '');
            const title = hasVisit
              ? hasVisit.map(v => `${esc(v.property_title || '')}${v.visit_time ? ' ' + v.visit_time : ''}`).join('\n')
              : '';
            return `<div title="${esc(title)}" style="${style}">${day}</div>`;
          }).join('')}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:.5rem;margin-bottom:.5rem">
        ${kvs.map(v => `
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.75rem;display:flex;gap:.75rem;align-items:center">
            <div style="font-size:1.5rem">📅</div>
            <div>
              <div style="font-weight:600">${esc(v.property_title || '')}</div>
              <div style="font-size:.85rem;color:var(--text-muted)">
                ${esc(v.visit_date)}${v.visit_time ? ' · ' + esc(v.visit_time) : ''}
                · <span style="color:var(--primary-text)">${T('dash_c_' + v.status)}</span>
              </div>
            </div>
          </div>`).join('')}
      </div>`;
    }
    c.innerHTML = html;
  } catch (e) { c.innerHTML = `<p style="color:red;padding:1rem">${e.message}</p>`; }
}

// ── Notifications in-app ───────────────────────────
const NOTIF_KEY = () => 'dzimmo_notifs_' + (currentUser?.id || '0');
let _notifs = [];
let _notifOpen = false;

function loadNotifsFromStorage() {
  try { _notifs = JSON.parse(localStorage.getItem(NOTIF_KEY()) || '[]'); } catch { _notifs = []; }
}

function saveNotifs() {
  try { localStorage.setItem(NOTIF_KEY(), JSON.stringify(_notifs.slice(0, 30))); } catch {}
}

function pushNotif(n) {
  _notifs.unshift({ ...n, id: Date.now(), read: false });
  saveNotifs();
  updateNotifBadge();
  if (_notifOpen) renderNotifList();
}

function updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const count = _notifs.filter(n => !n.read).length;
  if (count > 0) { badge.textContent = count > 9 ? '9+' : count; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

function renderNotifList() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (!_notifs.length) { list.innerHTML = '<div class="notif-empty">' + T('notif_empty') + '</div>'; return; }
  const ICONS = { new_contact:'📩', contact_status:'✅', message:'💬', moderation_pending:'🛡️', moderation_decision:'📋', price_drop:'📉' };
  list.innerHTML = _notifs.slice(0, 20).map(n => `
    <div class="notif-item${n.read ? '' : ' unread'}" onclick="clickNotif(${n.id}, ${n.link_id || 0})">
      <div class="notif-icon">${ICONS[n.notif_type] || '🔔'}</div>
      <div class="notif-body">
        <div class="notif-title">${esc(n.title || '')}</div>
        <div class="notif-sub">${esc(n.body || '')}</div>
        <div class="notif-time">${n.time ? new Date(n.time).toLocaleString('fr-DZ', {hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'}) : ''}</div>
      </div>
    </div>`).join('');
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  _notifOpen = !_notifOpen;
  panel.classList.toggle('hidden', !_notifOpen);
  if (_notifOpen) renderNotifList();
}

function clickNotif(id, linkId) {
  const n = _notifs.find(x => x.id === id);
  if (n) n.read = true;
  saveNotifs();
  updateNotifBadge();
  renderNotifList();
  if (linkId) showPage('detail', linkId);
  else if (document.getElementById('notif-panel')) {
    document.getElementById('notif-panel').classList.add('hidden');
    _notifOpen = false;
  }
}

function markAllNotifsRead() {
  _notifs.forEach(n => n.read = true);
  saveNotifs();
  updateNotifBadge();
  renderNotifList();
}

// Fermer le panel si clic à l'extérieur
document.addEventListener('click', e => {
  const wrap = document.querySelector('.notif-wrap');
  if (wrap && !wrap.contains(e.target) && _notifOpen) {
    document.getElementById('notif-panel').classList.add('hidden');
    _notifOpen = false;
  }
});

// ── WebSocket ──────────────────────────────────────
function setupWs() {
  if (!token) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  wsConn = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
  wsConn.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.type === 'message') {
      loadUnreadCount();
      if (currentPage === 'messages') loadMessages();
    }
    if (d.type === 'notif') {
      pushNotif(d);
      toast('🔔 ' + (d.title || 'Nouvelle notification'));
    }
  };
  wsConn.onclose = () => { setTimeout(() => token && setupWs(), 3000); };
}

async function loadUnreadCount() {
  try {
    const { count } = await api('/messages/unread-count');
    const el = document.getElementById('msg-count');
    if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  } catch {}
}

// ── Modals ─────────────────────────────────────────
// ── Mise à la une d'une annonce ───────────────────────────────────────────────────
// Les formules et les prix viennent du serveur (jours et montants forcés en nombres). Paiement simulé (développement) : le navigateur
// confirme lui-même ; en production, le serveur renverra une adresse de paiement https (SATIM) vers laquelle on redirige.
let _promoId = 0;

async function openPromote(id) {
  const promo = await promoPlans();
  if (!promo.enabled || !promo.plans.length) { toast('❌ ' + T('pr_closed')); return; }
  _promoId = Number(id) || 0;
  document.getElementById('promote-plans').innerHTML = promo.plans.map((pl, i) => {
    const days = Number(pl.days), price = Number(pl.price);
    return `<label class="promo-plan"><input type="radio" name="promo-days" value="${days}"${i === 0 ? ' checked' : ''}>
      <span>${days} ${unit(days, 'u_day')}</span><strong>${formatPrice(price)} ${T('u_dzd')}</strong></label>`;
  }).join('');
  document.getElementById('promote-test').classList.toggle('hidden', !promo.simulated);
  const msg = document.getElementById('promote-msg'); msg.className = 'hidden'; msg.textContent = '';
  document.getElementById('promote-pay').disabled = false;
  openModal('promote');
}

async function submitPromote() {
  const msg = document.getElementById('promote-msg');
  const days = Number(document.querySelector('input[name="promo-days"]:checked')?.value);
  if (!days) { msg.className = 'error-msg'; msg.textContent = T('pr_choose'); return; }
  const btn = document.getElementById('promote-pay');
  btn.disabled = true;   // un seul envoi : pas de double commande sur un double clic
  try {
    const order = await api('/promotions', 'POST', { property_id: _promoId, days });
    if (order.simulated) {
      const done = await api('/promotions/' + order.id + '/simulate', 'POST');
      closeModal('promote');
      toast('✅ ' + T('pr_done').replace('{date}', new Date(done.featured_until).toLocaleDateString('fr-DZ')), 4500);
      if (currentPage === 'dashboard') dashTab('mes-annonces');
    } else if (isHttps(order.redirect)) {
      location.href = order.redirect;
    } else throw new Error(T('pr_closed'));
  } catch (e) { msg.className = 'error-msg'; msg.textContent = e.message; btn.disabled = false; }
}

// ── Signalement d'une annonce ─────────────────────────────────────────────────────
// Connexion requise. Le serveur borne les dépôts (un par membre et par annonce, 10 par jour) et retire seul l'annonce
// à partir de REPORT_AUTO_HIDE membres fiables : ici on ne fait que recueillir le motif.
const REPORT_MOTIFS = ['arnaque', 'indisponible', 'faux', 'photos', 'doublon', 'interdit', 'autre'];
let _reportId = 0;

function openReport(id) {
  if (!currentUser) { toast(T('rp_login')); openModal('login'); return; }
  _reportId = Number(id) || 0;
  document.getElementById('report-motif').innerHTML = `<option value="">${T('rp_choose')}</option>` +
    REPORT_MOTIFS.map(m => `<option value="${m}">${T('rp_m_' + m)}</option>`).join('');
  document.getElementById('report-message').value = '';
  const msg = document.getElementById('report-msg'); msg.className = 'hidden'; msg.textContent = '';
  openModal('report');
}

async function submitReport() {
  const motif = document.getElementById('report-motif').value;
  const msg = document.getElementById('report-msg');
  if (!motif) { msg.className = 'error-msg'; msg.textContent = T('rp_need_motif'); return; }
  try {
    await api('/properties/' + _reportId + '/signaler', 'POST', { motif, message: document.getElementById('report-message').value.trim() });
    closeModal('report');
    toast('✅ ' + T('rp_thanks'), 4500);
  } catch (e) { msg.className = 'error-msg'; msg.textContent = e.message; }
}

function openModal(name) {
  document.getElementById('modal-' + name)?.classList.remove('hidden');
  if (name === 'login' && _mfaToken === null) resetMfaStep();   // la fenêtre s'ouvre toujours sur l'étape 1 (sauf retour de Google avec un défi en cours)
  if (name === 'login' || name === 'register') renderGoogleButtons();   // largeur mesurable seulement une fois la fenêtre affichée
}
function closeModal(name) {
  document.getElementById('modal-' + name)?.classList.add('hidden');
  if (name === 'login') resetMfaStep();   // le jeton de défi ne survit pas à la fermeture de la fenêtre
}
function switchModal(from, to) {
  closeModal(from); openModal(to);
}

// Fermer modal en cliquant sur l'overlay
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.add('hidden'); });
});

// ── Utilitaires ────────────────────────────────────
function formatPrice(n) {
  return Number(n).toLocaleString('fr-DZ');
}
// Miniatures (server/thumbs.js) : /uploads/x.webp → /uploads/thumbs/480/x.webp, créées à la première demande ; toute autre adresse est laissée telle quelle
const UPLOAD_IMG = /^\/uploads\/([\w.-]+\.webp)$/i;
function thumbUrl(url, w = 480) {
  const m = UPLOAD_IMG.exec(url || '');
  return m ? `/uploads/thumbs/${w}/${m[1]}` : url;
}
// Attributs src / srcset / sizes (déjà échappés) d'une photo affichée à `sizes` : le navigateur choisit la plus petite variante suffisante,
// l'original (1920 px) reste la plus grande. Une adresse qui n'est pas un envoi du site n'a qu'un src.
function imgAttrs(url, sizes, widths = [480, 960]) {
  const m = UPLOAD_IMG.exec(url || '');
  if (!m) return `src="${esc(url || '')}"`;
  const set = widths.map(w => `/uploads/thumbs/${w}/${m[1]} ${w}w`).concat(`${url} 1920w`).join(', ');
  return `src="${esc(thumbUrl(url, widths[widths.length - 1]))}" srcset="${esc(set)}" sizes="${esc(sizes)}" decoding="async"`;
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}
function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg; el.classList.remove('hidden');
}

// ── Démarrage ──────────────────────────────────────
applyLang(currentLang, false);
init();

// ── Carte interactive ─────────────────────────────
let mapInstance = null;
let mapCluster  = null;
let _mapMode    = null;   // null (tous les biens) | 'radius' | 'draw'
let _mapReq     = 0;      // numéro de la dernière demande : une réponse plus lente qu'une demande plus récente est ignorée

// Leaflet (2 scripts + 3 feuilles de style, ~150 Ko) n'est chargé qu'à la première ouverture de la carte, plus sur chaque page
let _leafletLoading = null;
function loadLeaflet() {
  if (window.L && window.L.markerClusterGroup) return Promise.resolve();
  if (_leafletLoading) return _leafletLoading;
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
  const css = href => new Promise((ok, ko) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CDN + href; l.onload = ok; l.onerror = ko; document.head.appendChild(l);
  });
  const js = src => new Promise((ok, ko) => {
    const s = document.createElement('script'); s.src = CDN + src; s.onload = ok; s.onerror = ko; document.head.appendChild(s);
  });
  _leafletLoading = Promise.all([
    css('leaflet/1.9.4/leaflet.min.css'), css('leaflet.markercluster/1.5.3/MarkerCluster.min.css'), css('leaflet.markercluster/1.5.3/MarkerCluster.Default.min.css'),
    js('leaflet/1.9.4/leaflet.min.js').then(() => js('leaflet.markercluster/1.5.3/leaflet.markercluster.min.js')),   // le plugin a besoin de L
  ]).catch(e => { _leafletLoading = null; throw e; });   // échec réseau : la prochaine ouverture de la carte réessaie
  return _leafletLoading;
}

async function initMap() {
  // Peupler la liste des wilayas si vide
  const sel = document.getElementById('map-wilaya');
  if (sel.options.length <= 1) {
    WILAYAS.forEach(w => {
      const o = document.createElement('option');
      o.value = w; o.textContent = w; sel.appendChild(o);
    });
  }

  if (!mapInstance) {
    try { await loadLeaflet(); } catch { toast(T('err_network')); return; }
    if (mapInstance) return;   // ouverture répétée pendant le chargement : la première a déjà créé la carte
    mapInstance = L.map('map-container', {
      center: [28.0, 2.5],
      zoom: 5,
      zoomControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(mapInstance);
    mapCluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 60 });
    mapInstance.addLayer(mapCluster);
  }

  setTimeout(() => { mapInstance.invalidateSize(); loadMapMarkers(); }, 120);
}

// Filtres de la barre de la carte
function mapFilterValues() {
  return {
    wilaya:    document.getElementById('map-wilaya').value,
    mode:      document.getElementById('map-mode').value,
    type_bien: document.getElementById('map-type').value,
  };
}

// Un marqueur et sa fenêtre : même dessin pour la vue générale, le rayon et la zone dessinée (jamais de donnée dans onclick : data-id)
function mapMarker(p, showDistance) {
  const isVente = p.mode === 'vente';
  const color   = isVente ? '#0C6E4F' : '#f59e0b';
  const icon = L.divIcon({
    className: 'map-marker-icon',
    html: `<div style="background:${color};color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.35);border:2px solid #fff">${isVente ? '🏷' : '🔑'}</div>`,
    iconSize:   [34, 34],
    iconAnchor: [17, 17],
    popupAnchor:[0, -20],
  });
  const img  = p.image || 'https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=400&q=70';
  const dist = showDistance && p.distance_km != null ? `<div style="font-size:.78rem;color:#64748b;margin-bottom:4px">📏 ${esc(p.distance_km)} km</div>` : '';
  const popup = `
    <div style="width:220px">
      <img src="${esc(thumbUrl(img, 480))}" onerror="this.src='https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=400&q=70'"
           style="width:100%;height:115px;object-fit:cover;border-radius:7px;display:block;margin-bottom:8px">
      <div style="font-weight:700;font-size:.88rem;margin-bottom:3px;line-height:1.3">${esc(p.title)}</div>
      <div style="font-size:.78rem;color:#64748b;margin-bottom:5px">📍 ${esc(p.commune || wilayaName(p.wilaya))}, ${esc(wilayaName(p.wilaya))}</div>
      ${dist}
      <div style="font-size:.95rem;font-weight:700;color:${color};margin-bottom:8px">${priceText(p)}</div>
      <button data-id="${Number(p.id)}" onclick="showPage('detail',Number(this.dataset.id))"
              style="background:${color};color:#fff;border:none;border-radius:7px;padding:6px 0;font-size:.82rem;font-weight:600;cursor:pointer;width:100%;font-family:inherit">
        ${T('map_view')}
      </button>
    </div>`;
  return L.marker([p.lat, p.lng], { icon }).bindPopup(popup, { maxWidth: 250 });
}

function showMapMarkers(list, showDistance) {
  mapCluster.clearLayers();
  mapCluster.addLayers(list.filter(p => p.lat && p.lng).map(p => mapMarker(p, showDistance)));
}

// « n biens affichés » : la réponse d'une zone ou d'un rayon est bornée à 100, le serveur dit quand il y en avait davantage
function mapResultText(key, resp, extra = {}) {
  let text = T(key).replace('{n}', resp.data.length);
  for (const [k, v] of Object.entries(extra)) text = text.replace(`{${k}}`, v);
  return resp.truncated ? `${text} · ${T('map_truncated').replace('{n}', resp.data.length)}` : text;
}

async function loadMapMarkers() {
  if (!mapInstance) return;
  // Un rayon ou une zone actifs se rafraîchissent avec les filtres au lieu d'être effacés
  if (_mapMode === 'radius' && _mapZoneCenter) return loadNearbyMarkers();
  if (_mapMode === 'draw' && _mapPolygon)      return loadZoneMarkers();

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(mapFilterValues())) if (v) params.set(k, v);
  params.set('limit', '500');

  const countEl = document.getElementById('map-count');
  countEl.textContent = T('loading');
  const req = ++_mapReq;
  try {
    const resp       = await api('/properties?' + params);
    if (req !== _mapReq) return;   // une demande plus récente est partie entre-temps
    const props      = resp.data;
    const withCoords = props.filter(p => p.lat && p.lng);
    const sans       = props.length - withCoords.length;
    countEl.textContent = `${resp.total} ${unit(resp.total, 'st_ad')}` +
      (sans ? ` · ${sans} ${T('map_no_pos')}` : '');

    mapCluster.clearLayers();
    if (!withCoords.length) return;
    showMapMarkers(withCoords, false);

    // Adapter la vue aux marqueurs, sauf pendant qu'on trace une zone
    if (!_mapMode) mapInstance.fitBounds(L.latLngBounds(withCoords.map(p => [p.lat, p.lng])).pad(params.get('wilaya') ? 0.15 : 0.08));
  } catch (e) {
    if (req !== _mapReq) return;
    countEl.textContent = T('map_error');
    console.error('[carte]', e.message);
  }
}

// ── PWA : bouton d'installation ──────────────────────────────────────────────
let _pwaPrompt = null;

function installPWA() {
  if (!_pwaPrompt) return;
  _pwaPrompt.prompt();
  _pwaPrompt.userChoice.then(c => {
    _pwaPrompt = null;
    if (c.outcome === 'accepted') document.getElementById('pwa-install-btn')?.classList.add('hidden');
  });
}

// ── Carte : rayon, « autour de moi » et zone dessinée ────────────────────────
// Trois façons de restreindre la carte (une seule à la fois, _mapMode) : 'radius' (clic = centre, curseur = rayon, ou position du visiteur),
// 'draw' (clics = sommets d'un polygone). Ni la position ni la zone ne sont conservées : rien n'est stocké, ni côté serveur ni dans le navigateur.
let _mapZoneCircle = null, _mapZoneCenter = null, _mapMeMarker = null, _mapFromMe = false;
let _mapPolyPts = [], _mapDrawGroup = null, _mapPolygon = null;
const MAP_MAX_POINTS = 60;   // limite du serveur (server/geo.js)

// Coordonnée arrondie : 5 décimales (~1 m) pour un point posé à la main, 3 (~110 m) pour la position du visiteur
function mapCoord(v, decimals = 5) { const k = 10 ** decimals; return Math.round(v * k) / k; }

function setMapBtn(id, on, keyOff, keyOn) {
  const b = document.getElementById(id);
  if (!b) return;
  const key = on ? keyOn : keyOff;
  b.setAttribute('data-i18n', key); b.textContent = T(key);
  b.style.borderColor = on ? '#dc2626' : ''; b.style.color = on ? '#dc2626' : '';
}

// Retire du plan tout ce qui appartient à un rayon ou à une zone
function clearMapOverlays() {
  resetMapDraw();
  if (mapInstance) {
    if (_mapZoneCircle) mapInstance.removeLayer(_mapZoneCircle);
    if (_mapMeMarker)   mapInstance.removeLayer(_mapMeMarker);
  }
  _mapZoneCircle = _mapMeMarker = _mapZoneCenter = null;
  _mapFromMe = false;
}

function setMapMode(mode, reload = true) {
  if (mode === _mapMode) return;
  clearMapOverlays();
  if (mapInstance) { mapInstance.off('click', onMapZoneClick); mapInstance.off('click', onMapDrawClick); }
  _mapMode = mode;
  if (mapInstance && mode === 'radius') mapInstance.on('click', onMapZoneClick);
  if (mapInstance && mode === 'draw')   mapInstance.on('click', onMapDrawClick);
  document.getElementById('map-container').style.cursor = mode ? 'crosshair' : '';
  setMapBtn('map-zone-btn', mode === 'radius', 'map_zone_mode', 'map_zone_exit');
  setMapBtn('map-draw-btn', mode === 'draw', 'map_draw_mode', 'map_draw_exit');
  document.getElementById('map-zone-controls')?.classList.toggle('hidden', mode !== 'radius');
  document.getElementById('map-draw-controls')?.classList.toggle('hidden', mode !== 'draw');
  const hint = document.getElementById('map-zone-hint');
  if (hint) {
    hint.classList.toggle('hidden', !mode);
    const key = mode === 'draw' ? 'map_draw_hint' : 'map_zone_hint';
    hint.setAttribute('data-i18n', key); hint.textContent = T(key);
  }
  if (reload) loadMapMarkers();
}

function toggleMapZone() { setMapMode(_mapMode === 'radius' ? null : 'radius'); }
function toggleMapDraw() { setMapMode(_mapMode === 'draw' ? null : 'draw'); }

// ── Rayon autour d'un point (clic ou position du visiteur) ──
async function onMapZoneClick(e) {
  const ll = e.latlng.wrap();
  _mapFromMe = false;
  _mapZoneCenter = L.latLng(mapCoord(ll.lat), mapCoord(ll.lng));
  await loadNearbyMarkers();
}

function onRadiusChange(val) {
  document.getElementById('map-zone-radius-val').textContent = val;
  if (_mapZoneCenter) loadNearbyMarkers();
}

// « Autour de moi » : la position n'est demandée qu'au clic, arrondie à ~110 m avant tout envoi, jamais conservée
function mapAroundMe() {
  if (!mapInstance) return;
  if (!navigator.geolocation) { toast(T('map_me_denied')); return; }
  const btn = document.getElementById('map-me-btn');
  btn.disabled = true; btn.textContent = T('map_me_locating');
  const done = () => { btn.disabled = false; btn.textContent = T('map_me_btn'); };
  navigator.geolocation.getCurrentPosition(pos => {
    done();
    setMapMode('radius', false);
    _mapFromMe = true;
    _mapZoneCenter = L.latLng(mapCoord(pos.coords.latitude, 3), mapCoord(pos.coords.longitude, 3));
    loadNearbyMarkers();
  }, () => { done(); toast(T('map_me_denied')); }, { timeout: 10000, maximumAge: 60000 });
}

async function loadNearbyMarkers() {
  if (!mapInstance || !_mapZoneCenter) return;
  const radius = parseInt(document.getElementById('map-zone-radius').value) || 5;
  const { lat, lng } = _mapZoneCenter;
  const params = new URLSearchParams({ lat, lng, radius });
  for (const [k, v] of Object.entries(mapFilterValues())) if (v) params.set(k, v);
  const countEl = document.getElementById('map-count');
  countEl.textContent = T('loading');
  const req = ++_mapReq;
  try {
    const resp = await api('/properties/nearby?' + params);
    if (req !== _mapReq || !_mapZoneCenter) return;
    if (_mapZoneCircle) mapInstance.removeLayer(_mapZoneCircle);
    if (_mapMeMarker)   mapInstance.removeLayer(_mapMeMarker);
    _mapZoneCircle = L.circle([lat, lng], { radius: radius * 1000, color: '#0C6E4F', fillColor: '#0C6E4F', fillOpacity: 0.08, weight: 2, interactive: false }).addTo(mapInstance);
    _mapMeMarker = _mapFromMe
      ? L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1, interactive: false }).bindTooltip(T('map_me_here')).addTo(mapInstance)
      : null;
    mapInstance.setView([lat, lng], Math.max(10, Math.round(14 - Math.log2(radius))));
    countEl.textContent = mapResultText('map_zone_results', resp, { r: radius });
    showMapMarkers(resp.data, true);
  } catch (err) {
    if (req !== _mapReq) return;
    countEl.textContent = T('map_error');
    console.error('[carte zone]', err.message);
  }
}

// ── Zone dessinée (polygone) ──
function resetMapDraw() {
  if (_mapPolygon && mapInstance) mapInstance.removeLayer(_mapPolygon);
  if (_mapDrawGroup) _mapDrawGroup.clearLayers();
  _mapPolygon = null; _mapPolyPts = [];
}

function redrawMapDraw() {
  if (!mapInstance) return;
  if (!_mapDrawGroup) _mapDrawGroup = L.layerGroup().addTo(mapInstance);
  _mapDrawGroup.clearLayers();
  if (_mapPolyPts.length > 1) L.polyline(_mapPolyPts, { color: '#0C6E4F', weight: 2, dashArray: '6 6', interactive: false }).addTo(_mapDrawGroup);
  _mapPolyPts.forEach((pt, i) => {
    const first = i === 0 && _mapPolyPts.length >= 3;   // le premier point ferme la zone
    const v = L.circleMarker(pt, { radius: first ? 9 : 5, color: '#0C6E4F', weight: 2, fillColor: first ? '#fff' : '#0C6E4F', fillOpacity: 1,
                                   interactive: first, bubblingMouseEvents: false }).addTo(_mapDrawGroup);
    if (first) v.on('click', finishMapDraw);
  });
}

function onMapDrawClick(e) {
  if (_mapPolygon) resetMapDraw();   // un nouveau clic après « Terminer » recommence le tracé
  if (_mapPolyPts.length >= MAP_MAX_POINTS) { toast(T('map_draw_max')); return; }
  const ll = e.latlng.wrap();
  _mapPolyPts.push([mapCoord(ll.lat), mapCoord(ll.lng)]);
  redrawMapDraw();
}

function undoMapDraw() {
  if (_mapPolygon) { mapInstance.removeLayer(_mapPolygon); _mapPolygon = null; }
  _mapPolyPts.pop();
  redrawMapDraw();
}

function clearMapDraw() {
  resetMapDraw();
  loadMapMarkers();
}

function finishMapDraw() {
  if (!mapInstance || _mapPolygon) return;
  if (_mapPolyPts.length < 3) { toast(T('map_draw_min')); return; }
  if (_mapDrawGroup) _mapDrawGroup.clearLayers();
  _mapPolygon = L.polygon(_mapPolyPts, { color: '#0C6E4F', fillColor: '#0C6E4F', fillOpacity: 0.1, weight: 2, interactive: false }).addTo(mapInstance);
  loadZoneMarkers(true);
}

async function loadZoneMarkers(fit = false) {
  if (!mapInstance || !_mapPolygon) return;
  const body = { polygon: _mapPolyPts };
  for (const [k, v] of Object.entries(mapFilterValues())) if (v) body[k] = v;
  const countEl = document.getElementById('map-count');
  countEl.textContent = T('loading');
  const req = ++_mapReq;
  try {
    const resp = await api('/properties/zone', 'POST', body);   // POST : la zone ne doit pas se retrouver dans les adresses
    if (req !== _mapReq || !_mapPolygon) return;
    countEl.textContent = mapResultText('map_zone_results_poly', resp);
    showMapMarkers(resp.data, false);
    if (fit) mapInstance.fitBounds(_mapPolygon.getBounds().pad(0.1));
  } catch (err) {
    if (req !== _mapReq) return;
    if (err.status === 400) { toast(err.message); resetMapDraw(); }   // zone refusée (sans surface…) : on la retrace
    countEl.textContent = T('map_error');
    console.error('[carte zone]', err.message);
  }
}

// ── Stats journalières d'une annonce (tableau de bord annonceur) ──────────────
const STAT_COLORS = { views: '#0C6E4F', favorites: '#e11d48', clicks: '#f59e0b' };
const ADVICE_ICON = { warn: '⚠️', tip: '💡', good: '✅' };

// HTML du panneau : totaux, courbes (vues, favoris, clics par jour) et conseils. Fonction pure (données du serveur → chaîne) : tout passe par esc().
function statsPanelHTML(stats) {
  const days = stats.days || [];
  const t = stats.totals || {};
  const pick = (rows, key) => { const m = {}; (rows || []).forEach(r => { m[r.day] = (m[r.day] || 0) + Number(r[key]); }); return days.map(d => m[d] || 0); };
  const series = { views: pick(stats.views, 'views'), favorites: pick(stats.favorites, 'n'), clicks: pick(stats.clicks, 'n') };
  const maxV = Math.max(1, ...series.views, ...series.favorites, ...series.clicks);

  const W = 520, H = 110, pad = { t: 10, b: 18, l: 28, r: 8 };
  const last = Math.max(days.length - 1, 1);
  const pw = (W - pad.l - pad.r) / last;
  const px = i => pad.l + i * pw;
  const py = v => pad.t + (1 - v / maxV) * (H - pad.t - pad.b);
  const line = arr => arr.map((v, i) => (i ? 'L' : 'M') + px(i).toFixed(1) + ',' + py(v).toFixed(1)).join(' ');
  const dots = (arr, color) => arr.map((v, i) => v > 0 ? `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="2.5" fill="${color}"/>` : '').join('');
  const locale = currentLang === 'ar' ? 'ar-DZ' : 'fr-DZ';
  const labels = [0, Math.floor(last / 2), last].filter(i => days[i]).map(i => {
    const lbl = new Date(days[i] + 'T12:00:00').toLocaleDateString(locale, { day: '2-digit', month: 'short' });
    const anchor = i === 0 ? 'start' : i === last ? 'end' : 'middle';
    return `<text x="${px(i).toFixed(1)}" y="${H - 3}" text-anchor="${anchor}" font-size="8" fill="currentColor" opacity=".6">${esc(lbl)}</text>`;
  }).join('');

  const box = (label, value, color, sub) => `<div style="flex:1;min-width:84px;border:1px solid var(--border);border-radius:8px;padding:.35rem .5rem">
      <div style="font-size:.72rem;color:${color};font-weight:700">${esc(label)}</div>
      <div style="font-size:1.05rem;font-weight:800">${Number(value) || 0}</div>${sub ? `<div style="font-size:.68rem;color:var(--text-muted)">${esc(sub)}</div>` : ''}</div>`;
  const totals = `<div style="display:flex;gap:.45rem;flex-wrap:wrap;margin-bottom:.6rem">
      ${box(T('st_views'), t.views_30d, STAT_COLORS.views)}
      ${box(T('st_favs'), t.favorites_30d, STAT_COLORS.favorites, T('st_favs_total').replace('{n}', Number(t.favorites_total) || 0))}
      ${box('📞 ' + T('st_calls'), t.calls_30d, STAT_COLORS.clicks)}
      ${box('💬 ' + T('st_wa'), t.whatsapps_30d, STAT_COLORS.clicks)}
      ${box('📩 ' + T('st_contacts'), t.contacts_30d, 'var(--text-muted)')}
      <div style="flex:1;min-width:84px;border:1px solid var(--border);border-radius:8px;padding:.35rem .5rem"><div style="font-size:.72rem;color:var(--text-muted);font-weight:700">${esc('📊 ' + T('st_conversion'))}</div><div style="font-size:1.05rem;font-weight:800">${esc((Number(t.conversion_rate) || 0).toFixed(1) + ' %')}</div></div>
    </div>`;

  const empty = !series.views.some(Boolean) && !series.favorites.some(Boolean) && !series.clicks.some(Boolean);
  const chart = empty
    ? `<div style="font-size:.82rem;color:var(--text-muted);text-align:center;padding:.4rem">${esc(T('st_no_data'))}</div>`
    : `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;color:var(--text);overflow:visible" direction="ltr">
        <line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="var(--border)" stroke-width="1"/>
        ${['views', 'favorites', 'clicks'].map(k => `<path d="${line(series[k])}" fill="none" stroke="${STAT_COLORS[k]}" stroke-width="1.5" stroke-linejoin="round"/>`).join('')}
        ${['views', 'favorites', 'clicks'].map(k => dots(series[k], STAT_COLORS[k])).join('')}
        ${labels}
      </svg>`;

  // Un conseil inconnu du site est ignoré (jamais de clé brute affichée) ; les paramètres sont des nombres
  const items = (stats.advice || []).filter(a => TRANSLATIONS.fr['adv_' + a.code]).map(a => {
    let text = T('adv_' + a.code);
    for (const [k, v] of Object.entries(a.params || {})) text = text.split('{' + k + '}').join(String(Number(v) || 0));
    return `<li style="display:flex;gap:.45rem;font-size:.82rem;line-height:1.45;margin:.25rem 0"><span aria-hidden="true">${ADVICE_ICON[a.level] || '💡'}</span><span>${esc(text)}</span></li>`;
  }).join('');
  const advice = items ? `<div style="margin-top:.7rem;padding-top:.6rem;border-top:1px solid var(--border)" title="${esc(T('st_advice_tip'))}">
      <div style="font-size:.8rem;font-weight:700;color:var(--text-muted)">${esc(T('st_advice'))}</div><ul style="list-style:none;padding:0;margin:.2rem 0 0">${items}</ul></div>` : '';

  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;gap:.5rem;flex-wrap:wrap">
      <span style="font-size:.83rem;font-weight:700;color:var(--text-muted)">${esc(T('dash_stats_title'))}</span>
      <span style="display:flex;align-items:center;gap:.5rem">
        <span style="font-size:.78rem;color:var(--text-muted)"><span style="color:${STAT_COLORS.views}">— ${esc(T('st_views'))}</span> &nbsp; <span style="color:${STAT_COLORS.favorites}">— ${esc(T('st_favs'))}</span> &nbsp; <span style="color:${STAT_COLORS.clicks}">— ${esc(T('st_clicks'))}</span></span>
        <button class="btn btn-outline btn-sm" style="font-size:.72rem;padding:.12rem .42rem;border-color:var(--text-muted);color:var(--text-muted)" data-statsid="${Number(stats._propId||0)}" onclick="downloadStatsCsv(Number(this.dataset.statsid))">${esc(T('st_export_csv'))}</button>
      </span>
    </div>${totals}${chart}${advice}`;
}

async function showPropertyStats(id, triggerBtn) {
  // Basculer : un deuxième clic ferme le panneau
  const existing = document.getElementById('stats-panel-' + id);
  if (existing) { existing.remove(); if (triggerBtn) triggerBtn.style.opacity = ''; return; }
  if (triggerBtn) triggerBtn.style.opacity = '.5';

  // Trouver la carte de l'annonce pour y insérer le panneau en-dessous
  const card = triggerBtn?.closest('[style*="background:var(--white)"]');
  if (!card) return;

  const panel = document.createElement('div');
  panel.id = 'stats-panel-' + id;
  panel.style.cssText = 'background:var(--white);border:1px solid var(--border);border-radius:10px;padding:1rem 1.25rem;margin-top:.5rem;box-shadow:var(--shadow)';
  panel.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  card.parentElement.insertBefore(panel, card.nextSibling);

  try {
    const statsData = await api('/properties/' + id + '/stats');
    statsData._propId = id;
    _statsCache[id] = statsData;
    panel.innerHTML = statsPanelHTML(statsData);
  } catch {
    panel.innerHTML = `<div style="font-size:.83rem;color:#dc2626;padding:.5rem">${T('dash_error')}</div>`;
    if (triggerBtn) triggerBtn.style.opacity = '';
  }
}

function downloadStatsCsv(id) {
  const stats = _statsCache[id];
  if (!stats) return;
  const { days, views = [], favorites = [], clicks = [] } = stats;
  const viewAt  = d => views.filter(v => v.day === d).reduce((s, v) => s + Number(v.views || 0), 0);
  const favAt   = d => favorites.filter(f => f.day === d).reduce((s, f) => s + Number(f.n || 0), 0);
  const callAt  = d => clicks.filter(c => c.channel === 'call' && c.day === d).reduce((s, c) => s + Number(c.n || 0), 0);
  const waAt    = d => clicks.filter(c => c.channel === 'whatsapp' && c.day === d).reduce((s, c) => s + Number(c.n || 0), 0);
  const rows = (days || []).map(d => ({ date: d, vues: viewAt(d), favoris: favAt(d), appels: callAt(d), whatsapp: waAt(d) }));
  exportCSV(rows, `dzimmo-stats-${new Date().toISOString().slice(0, 10)}.csv`);
}
