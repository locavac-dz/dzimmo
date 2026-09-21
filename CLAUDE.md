# DzImmo — Plateforme d'annonces immobilières (Algérie)

Fork de LocaVac. Package npm `dzimmo`. Domaine cible : dzimmo.dz.

## Stack

- Node.js 20 + Express 5 — point d'entrée `server/index.js`. Les erreurs des routes `async` vont seules au gestionnaire d'erreurs
  (plus de `express-async-errors`). Motifs de route : ni expression régulière ni `?` (`/:a?`), écrire les chemins un par un
  (voir `server/seo.js`) ; `req.body` vaut toujours au moins `{}` (middleware dans `server/app.js`, test `tests/api/express5.test.js`).
- PostgreSQL 17 (port **5433** en local)
- Auth JWT (`jsonwebtoken` + `bcryptjs`)
- Frontend HTML/CSS/JS vanilla en SPA, servi depuis `public/`
- Upload `multer`, email `nodemailer`, tâches planifiées `node-cron`, temps réel `ws`
- Production : pm2 cluster (`ecosystem.config.js`) + Nginx + Let's Encrypt

## Commandes

```bash
npm run dev      # nodemon
npm start        # node server/index.js
npm run make-admin -- <email>   # promeut un compte existant administrateur (--retirer pour l'inverse, --reset-2fa si son téléphone est perdu)
npm test         # tests automatiques (node --test)
```

Les tests d'API tournent sur un **schéma PostgreSQL jetable** (créé puis supprimé par `tests/helpers/server.js`) :
les données de développement ne sont jamais touchées. Base utilisée : `TEST_DATABASE_URL`, sinon `DATABASE_URL`.
`server/app.js` définit l'application Express (sans démarrage, importée par les tests) ; `server/index.js` la lance.

Le compte et les annonces de démonstration (`seed()` dans `server/db.js`) ne sont créés qu'en dehors de
`NODE_ENV=production`. En production, le premier admin s'obtient en s'inscrivant puis avec `make-admin`.

Windows : `demarrer.bat`

## Accès aux données

- Les collections de `server/db.js` (`db.users`, `db.properties`…) prennent une condition **objet** :
  `db.users.findOne({ email })`, `db.properties.find({ status: ['active', 'sold'] }, { orderBy: 'id DESC', limit: 12 })`,
  `db.messages.count({ to_id, read: false })`. Un tableau devient `= ANY(...)`, `null` devient `IS NULL`.
  Les prédicats JavaScript (`p => p.id === 3`) sont refusés : ils chargeaient toute la table en mémoire.
- `update` et `delete` exigent une condition (pas de modification globale par accident).
- Identifiants issus d'une URL : `db.<table>.findById(req.params.id)` ou `db.toId(...)` (un id absurde donne « introuvable », pas une erreur SQL).
- Listes avec données liées (demandes, messages, favoris, avis, stats) : **une requête SQL avec JOIN / agrégat**
  (`db.pool.query`), jamais une boucle de requêtes par ligne.
- Toute colonne filtrée ou jointe régulièrement reçoit un index dans une migration (`server/migrations/`).

## Structure

- `server/` — API Express
- `public/` — front SPA : `index.html` (structure seule, ~75 Ko), `app.css`, `app.js` (script principal), `pro.js` (vitrine),
  `contrats.js` ; `public/uploads/` (photos et miniatures) est ignoré par Git
- `backups/` — sauvegardes locales, hors Git
- `dzimmo.json` — configuration locale, hors Git
- `DEPLOIEMENT.md` — mise en production (PostgreSQL, pm2, Nginx, sauvegardes)
- `.github/workflows/ci.yml` — tests à chaque poussée (PostgreSQL 17 en service)

## Production

- pm2 tourne en mode cluster : rien ne doit dépendre de la mémoire d'un seul processus. Les tâches planifiées
  (`server/cron.js`) ne démarrent que dans l'instance 0 (`NODE_APP_INSTANCE`) ; les notifications temps réel
  (`server/ws.js`) passent d'un worker à l'autre par PostgreSQL `LISTEN / NOTIFY`.
- **Compteurs partagés** (`server/rate-store.js`, table `rate_limits`) : tout limiteur `express-rate-limit` se crée avec
  `...shared('préfixe')` (test `tests/api/rate-store.test.js`), et le dédoublonnage des clics y passe aussi. La clé stockée est un
  HMAC, jamais l'adresse IP ; les lignes ne vivent que le temps de leur fenêtre (purge horaire). Base injoignable : la requête passe.
- **Démarrage** (`server/migrate.js`) : schéma et migrations s'exécutent sous un verrou consultatif PostgreSQL (un seul worker à la
  fois), chaque migration dans **une** transaction sur **une** connexion : pas de `BEGIN`/`COMMIT` ni de `CONCURRENTLY` dans un
  fichier de migration. Tout rattrapage de données au démarrage se lance dans l'instance 0 seulement, comme les tâches planifiées.
- `server/config-check.js` contrôle la configuration au démarrage (production) : un réglage dont l'absence est
  dangereux y reçoit une règle, en plus de figurer dans `.env.example`.
- **Supervision** (`server/monitor.js`, table `alert_throttle`, migration 019) : `alert(kind, err, name)` envoie un email (FR/AR, `buildAlert`) à `ALERT_EMAIL`,
  sinon `CONTACT_EMAIL`, sinon aux admins ; **une alerte par nature de panne et par heure**, réservée par un INSERT … ON CONFLICT atomique (commun aux workers).
  Le message est expurgé (`sanitize` : ni email, ni numéro, ni URL). Sans SMTP, rien n'est écrit ni envoyé : une alerte ne doit jamais aggraver la panne.
  Toute tâche de `server/cron.js` passe par `guard(nom, fn, famille)` (journal + alerte sans lever d'exception) ; le gestionnaire d'erreurs d'Express alerte
  sur les 5xx ; `installProcessHandlers()` (`server/index.js`) alerte puis sort en code 1 sur `uncaughtException` (pm2 relance) et continue sur `unhandledRejection`.
  Nouveau cron = enveloppé dans `guard`. Nouvelle nature d'alerte = entrée dans `ALERT_KINDS` (`server/mailer.js`, FR et AR).
- **Sauvegardes** (`server/backup.js`, `server/backup-cli.js`) : actives en production (`BACKUP_ENABLED=false` les coupe), `pg_dump -Fc` chaque nuit (02:30) dans
  `BACKUP_DIR` (hors Git, jamais sous `public/`, refusé par `config-check`), rotation `BACKUP_KEEP` (14) qui ne touche que les fichiers `dzimmo-AAAA-MM-JJ-HHMM.dump`,
  écriture en `.partial` puis renommage, `rate_limits` exclue. **Test de restauration** hebdomadaire (dim. 05:30) : base jetable `dzimmo_verif_*` + `pg_restore`
  (droit CREATEDB, ou `BACKUP_VERIFY_URL`), repli « catalogue » (relecture complète de l'archive) sans ce droit ; contrôle de fraîcheur à 06:30 (36 h). Les outils sont
  trouvés par `PG_BIN_DIR` ou le PATH ; le mot de passe passe par `PG*`, jamais en argument. `npm run backup` / `npm run backup:verify`. Les justificatifs de vérification
  ne sont jamais sauvegardés (voir Règles métier) ; la copie hors serveur et celle de `uploads/` restent à la charge de l'exploitant (DEPLOIEMENT.md § 7).
- Un chemin inconnu renvoie une vraie 404 (`public/404.html`, bilingue), l'API inconnue un JSON 404 : pas de repli
  de la SPA en 200. Toute nouvelle page servie par le site doit avoir sa route explicite (`server/seo.js` ou `app.js`).

## Règles métier

- Modes d'annonce : **Vente**, **Location longue durée**, **Location courte durée**
- Types de biens : Appartement, Villa, Maison, Bureau, Local commercial, Terrain, Ferme, Entrepôt
- Un bien peut être publié par un **particulier** ou une **agence**
- Les demandes de contact (visite, renseignement, offre) remplacent les réservations
- Avis sur les biens uniquement par des utilisateurs ayant soumis une demande de contact confirmée
- **Vérification des annonceurs** (`server/verification.js`) : un utilisateur envoie une pièce d'identité (particulier)
  ou un registre de commerce / agrément (professionnel) ; un admin l'examine (Administration → Vérifications).
  Approuvé : `users.verified_kind` (`identity` | `business`) donne le badge public ; `business` vérifie aussi l'agence du
  compte, qui publie alors sans modération. Le badge ne prouve **pas** la propriété d'un bien (l'infobulle le dit).
  Les justificatifs sont des données sensibles (loi 18-07) : dossier privé `VERIFICATION_DIR` (jamais sous `public/`),
  images ré-encodées sans métadonnées, consultables des seuls admins via l'API, **supprimés dès la décision** — ne jamais
  les garder, les journaliser ni les inclure dans une sauvegarde ; on ne conserve que le résultat.
- **Connexion avec Google** (facultative, `GOOGLE_CLIENT_ID`) : `POST /api/auth/google` vérifie le jeton d'identité (`server/google-auth.js`,
  RS256 imposé, audience, émetteur, `email_verified === true`). Rattachement : identifiant Google connu → ce compte ; adresse déjà
  inscrite → rattachement (si elle n'avait jamais été confirmée, mot de passe remplacé et sessions révoquées : c'est peut-être une
  pré-inscription par un tiers) ; sinon nouveau compte. La CSP et le COOP ne s'ouvrent à Google que si la variable est définie.
- **Sessions révocables** (`server/sessions.js`) : `users.sessions_valid_after` refuse les jetons émis avant cette date. Toute action qui
  change qui contrôle un compte (réinitialisation du mot de passe, reprise d'un compte) doit appeler `revokeSessions(userId)`. Les
  middlewares `auth`, `admin` et `optionalAuth` ainsi que le WebSocket relisent le compte en base ; le rôle admin (`req.user.is_admin`) vient de
  la base, pas du jeton. Avec `optionalAuth`, un compte suspendu, supprimé ou révoqué redevient un visiteur anonyme (jamais d'erreur).
- **Double authentification des administrateurs** (TOTP RFC 6238, `server/totp.js`, `server/two-factor.js`, `server/routes/two-factor.js`,
  `server/tokens.js`, migration 020) : avec le 2FA activé, `/login` et `/google` ne renvoient ni jeton ni fiche mais `{ mfa_required, mfa_token }`
  (jeton de défi de 5 min, clé propre, n'ouvre aucune route) ; `POST /api/auth/2fa/login` l'échange contre un jeton de session portant `mfa: true`.
  Un jeton **sans** `mfa` ne peut pas administrer (`adminBlock` : 401, ou 403 `mfa_setup_required` quand le 2FA est exigé et pas encore configuré,
  seules les routes `/api/auth/2fa` restent ouvertes pour le configurer) ; `is_admin` retombe à `false` dans `auth` / `optionalAuth` dans ce cas.
  `ADMIN_2FA_REQUIRED` : défaut vrai en production. Le secret est chiffré (AES-256-GCM, clé dérivée de `JWT_SECRET` par HMAC) ; **changer `JWT_SECRET`
  le rend illisible** (→ `make-admin --reset-2fa`). Essais réservés atomiquement en SQL (5 essais puis verrou 15 min, même en requêtes simultanées),
  anti-rejeu par `totp_last_step`, 10 codes de secours à usage unique (empreintes HMAC, affichés une seule fois). Activer, désactiver et renouveler
  les codes préviennent par email (FR/AR, `buildSecurityNotice`) ; activer et désactiver appellent `revokeSessions` puis renvoient un nouveau jeton.
  Réservé aux administrateurs (rôle relu en base). Front : seconde étape `#login-step2` de la fenêtre de connexion, onglet Administration → Sécurité
  (`adminLoadSecurity`, clé et codes échappés par `esc()`, QR en `data:` image). Ne jamais journaliser un code, un secret ou un jeton de défi.
- Interface bilingue FR / AR — toute nouvelle chaîne dans les deux langues
- Montants en **DZD**
- Conformité RGPD + loi algérienne 18-07

## Confiance et qualité des annonces

- **Reconfirmation** (`server/expiry.js`, tâche cron 03:30) : après `LISTING_CONFIRM_DAYS` (30) jours sans confirmation, rappel
  (email + notification) avec un lien à jeton ; après `LISTING_EXPIRE_GRACE_DAYS` (14) jours de plus, l'annonce est archivée avec
  `expired_at` (≠ archivage volontaire, qui n'est pas renouvelable). Une confirmation = création, modification par le propriétaire,
  « toujours disponible », renouvellement, approbation par un modérateur. Le jeton (`POST /:id/confirm`) est un HMAC de l'id et de
  `last_confirmed_at` : à usage unique, sans connexion. Toute requête d'expiration se réécrit en SQL (réservation atomique, pas d'état en mémoire).
- **Qualité** (`server/quality.js`, table `listing_quality`) : doublon du même annonceur (avertissement), texte identique à l'annonce
  d'un autre membre et prix au m² très éloigné de la médiane (signaux **bloquants** : l'annonce passe en modération même pour un compte
  de confiance). Ne jamais exposer l'id d'une annonce d'un autre membre à un annonceur (`warningsFor`). Les empreintes des annonces
  existantes sont calculées au démarrage (`backfill`).
- **Clics Appeler / WhatsApp** (`server/clicks.js`, table `contact_clicks`) : compteurs par annonce, jour et canal, **sans adresse IP
  ni identifiant de visiteur** (le dédoublonnage de 10 min garde un HMAC éphémère dans `rate_limits`, commun aux workers) ; visibles de l'annonceur seul ; `POST /:id/click` répond
  toujours 204 (ne révèle rien sur l'annonce).
- **Signalements** (`server/reports.js`, table `signalements`, migration 018) : bouton « Signaler cette annonce » de la fiche (connexion requise, modale
  `modal-report`), `POST /api/properties/:id/signaler` (motifs `MOTIFS`, jamais son propre bien, 10 dépôts par membre et par 24 h). Un membre ne
  signale qu'une fois une annonce en attente (index unique partiel : dépôt répété = succès sans doublon). **Retrait automatique** : à
  `REPORT_AUTO_HIDE` (3) membres **fiables** (email confirmé, non suspendu, compte de plus de 24 h) l'annonce passe de `active` à `pending`
  (UPDATE atomique en SQL, motif `HIDE_REASON`), le propriétaire et les admins sont prévenus (email + notification, FR/AR) ; seuls comptent les signalements
  postérieurs à la dernière décision de modération, et les annonces des admins, annonceurs vérifiés et agences vérifiées ne sont jamais retirées
  seules (les admins sont seulement prévenus). `0` désactive le retrait. Côté admin (Signalements) : « Ignorer » / « Résoudre » / « Retirer l'annonce »
  (`PUT /api/admin/signalements/:id/resolve` avec `action: 'reject'`) ; toute décision de modération (`moderation.decide`) classe les signalements en attente
  de l'annonce (fondés si refusée, ignorés si approuvée).

## Vidéo et visite virtuelle

- **Liens seulement, aucun fichier** (`server/videos.js`, colonnes `properties.video_url` / `tour_url`, migration 022) : `video_url` = YouTube ou Vimeo, `tour_url` = Matterport ou Kuula.
  Pas d'envoi de vidéo par choix (transcodage, bande passante, stockage) ; l'ajouter demanderait un vrai pipeline, pas un `multer` de plus.
- **Même principe que `server/images.js`** : l'adresse saisie n'est jamais gardée telle quelle. `videos.parse(kind, valeur)` exige https, refuse identifiants, port et
  caractères piégés, reconnaît le fournisseur par son domaine **exact**, en extrait l'identifiant et reconstruit l'adresse **canonique** (stockée) et l'adresse
  d'incrustation (`embed`, jamais stockée : `youtube-nocookie.com`, `player.vimeo.com`…). La contrainte CHECK de la migration 022 reprend `videos.CANONICAL` :
  les garder identiques (un nouveau fournisseur = `parseVideo`/`parseTour`, `CANONICAL`, la migration, `VIDEO_FRAMES` de `server/app.js`, `MEDIA_NAMES` du front, les tests).
- `videos.invalid()` est appelée par `POST` et `PUT /api/properties` (messages traduits dans `server/i18n.js`) ; `videos.clean()` donne la valeur à écrire.
  `video_url` et `tour_url` sont des `CONTENT_FIELDS` : les changer sur une annonce validée la remet en modération (un lien identique sous une autre forme, non).
- La fiche (`GET /api/properties/:id`) renvoie `video` / `tour` = `{ provider, url, embed }` reconstruits depuis la valeur stockée ; les listes ne portent que `video_url` / `tour_url` (pastille de la carte).
- **CSP** : `frame-src` n'autorise que ces quatre lecteurs (plus Google si `GOOGLE_CLIENT_ID`) ; `object-src` reste `'none'`.
- **Vie privée** : la fiche affiche une façade (`.media-facade`), sans image ni requête vers un tiers. Le lecteur n'est créé qu'au clic (`loadMedia`), dans un iframe `sandbox`
  (ni navigation du haut, ni formulaires) ; aucune miniature YouTube (elle contacterait Google à l'affichage de la page). Le front n'utilise que `m.embed` / `m.url` du serveur, en https.
- Front : champs `#pub-video` / `#pub-tour` du formulaire de publication (pas d'écran de modification d'annonce dans l'interface : le `PUT` de l'API les accepte), section de fiche `mediaHTML`,
  pastille `.media-badge` des cartes. Tests : `tests/unit/videos.test.js`, `tests/unit/media-front.test.js`, `tests/api/video-visite.test.js`.

## Statistiques et conseils de l'annonceur

- **`GET /api/properties/:id/stats`** (propriétaire ou admin) : `days` (les 30 dates, la dernière = aujourd'hui côté base, aucun calcul de date dans le
  navigateur), `views` / `favorites` / `clicks` (jours non nuls seulement, `clicks` garde le canal `call` | `whatsapp`), `totals` (`views_30d`, `views_7d`,
  `favorites_30d`, `favorites_total`, `calls_30d`, `whatsapps_30d`, `contacts_30d`) et `advice`. Les favoris ne sont **que comptés** par jour depuis
  `favorites.created_at` (index `idx_favorites_property`, migration 023) : la réponse ne contient jamais un membre. Un favori retiré disparaît du compte.
- **Conseils** (`server/advice.js`) : fonction **pure** qui renvoie des codes `{ code, level: warn | tip | good, params }` (nombres seulement) ; 4 au plus, dans l'ordre
  de `CODES` (prix élevé, photos, téléphone, vues sans réaction, baisse des vues, faible visibilité, description, position, vidéo, équipements) ; annonces `active`
  seulement ; `all_good` s'il n'y a rien à reprocher et déjà des vues. Le prix vient du signal `price_high` de `listing_quality` (jamais une autre annonce). Le texte est
  au front, clés `adv_<code>` FR **et** AR (test `stats-front.test.js` : un code du serveur sans traduction fait échouer). **Nouveau conseil = entrée dans `CODES`,
  sa règle dans `advise`, ses deux textes, ses tests.**
- **Front** : `statsPanelHTML(stats)` (public/app.js) est pure (données → chaîne, tout par `esc()`, paramètres forcés en nombres, code inconnu ignoré) ; `showPropertyStats`
  l'affiche sous la carte de l'annonce (bouton 📈 30j du tableau de bord) : totaux, trois courbes (vues, favoris, clics) et conseils.

## Vitrine des agences et des promoteurs

- **Profil** (`server/agency.js`, table `agencies`) : `kind` (`agence` | `promoteur`), logo, couverture, slogan, services, zones, horaires,
  réseaux. Tout passe par `cleanProfile` : les images ne viennent que de `/uploads/…` (notre envoi), les liens sont limités à http(s),
  les réseaux sociaux à leur domaine. Ne jamais accepter une adresse arbitraire pour un `src` ou un `href`. `verified` ne se règle que
  par la vérification `business` (jamais par le corps de la requête) ; la note d'une vitrine est la moyenne des avis de ses annonces.
- **Annuaire** (`GET /api/agencies`, paginé `{ items, total, page, pages, per_page, kinds }`) : vérifiés d'abord, puis les plus actifs.
  Un propriétaire suspendu disparaît de l'annuaire et de sa fiche. La fiche n'expose jamais l'identifiant du compte (`is_mine` suffit).
- **Rattachement des annonces** : `agency_id` et `project_id` d'une annonce doivent être ceux de son auteur (`affiliation()` dans
  `server/routes/properties.js`), sinon on publierait sous le nom, le logo et le numéro d'une autre agence. Les annonces d'une vitrine se
  lisent par `GET /api/properties?agency_id=` / `?project_id=`.
- **Programmes neufs** (`server/projects.js`, table `projects`) : réservés aux promoteurs **vérifiés** (le registre de commerce contrôlé
  tient lieu de modération) ; prix « à partir de », lots disponibles et vendus se calculent depuis les annonces rattachées, jamais saisis.
  Vérification retirée ou compte suspendu : le programme disparaît du site sans être supprimé (le propriétaire le voit toujours).
- **Pages** : `/agences`, `/promoteurs`, `/programmes`, `/agence/12-nom`, `/promoteur/7-nom`, `/programme/5-nom` sont servies par `server/seo.js`
  (métadonnées, JSON-LD, redirection canonique, vraie 404, sitemap) ; toute nouvelle page a sa route explicite. Le front est dans
  `public/pro.js`, chargé **avant** le script principal (un lien direct appelle `showPage` dès `init`).
- **Front** : toute donnée affichée passe par `esc()` ; aucune donnée de la page dans un attribut `onclick` (utiliser `data-*` et `this.dataset`,
  test `tests/unit/pro-front.test.js`). Les onglets du tableau de bord sont repérés par position : ajouter un bouton = ajouter sa clé dans `dashTab`.

## SEO bilingue

- **Deux adresses par page** : la version arabe est le chemin français précédé de `/ar` (`/ar`, `/ar/vente/villas/oran`, `/ar/annonce/12-villa-…`, `/ar/agences`…) ;
  les slugs restent latins. `server/seo.js` sert les deux (`bothLangs(routes)` : **toute nouvelle page servie déclare sa route par `bothLangs`**, sinon
  sa version arabe tombe en 404), rend `<html lang dir>`, `og:locale` (`fr_DZ` / `ar_DZ`), `Content-Language`, le titre, la description, le JSON-LD
  (`inLanguage`) et la liste crawlable dans la langue de l'adresse. Les textes des deux langues sont dans `server/seo-text.js` (`textOf(lang)`) ;
  types, modes, « à » et « tous » doivent rester identiques à `TRANSLATIONS` de `public/app.js` (test `tests/unit/seo-i18n.test.js`).
- **hreflang** (`fr`, `ar`, `x-default` = français) et un `canonical` par langue, **seulement sur les pages indexables** ; page de recherche vide,
  annonce non active et 404 : `noindex`, sans hreflang. Les redirections 301 canoniques (casse, ordre, slash final, slug erroné) existent aussi en `/ar`.
- **Sitemap** : `/sitemap.xml` est un **index** (`sitemap-pages.xml` + `sitemap-annonces-N.xml`, tranches de 20 000 annonces, tranche inexistante = 404) ;
  chaque page y figure deux fois (français, arabe) avec ses `xhtml:link`. Les tests lisent le tout par `fullSitemap(s)` (`tests/helpers/sitemap.js`).
- **Front** : l'adresse `/ar…` impose l'arabe (sinon `dz_lang`) ; `routePath()` donne le chemin sans `/ar` (à utiliser à la place de `location.pathname`
  pour router), `langPath(p)` ajoute le préfixe selon la langue affichée (tout lien ou `replaceState` de page passe par lui), et `applyLang` appelle
  `syncLangUrl()` pour que l'adresse suive la langue choisie (sauf `/newsletter/…`, dont les liens gardent la leur).

## Vitesse des pages

- **Rien de lourd dans `index.html`** : le CSS et le JS vivent dans `app.css` / `app.js`, appelés avec une adresse versionnée
  (`/app.js?v=<empreinte>`, ajoutée par `server/seo.js`) donc mis en cache **un an, immuables** ; la page, elle, se revalide par ETag (304).
  Un test refuse une `index.html` de plus de 120 Ko. Les tests du front lisent la page recomposée avec `readFront()`
  (`tests/helpers/front.js`), pas `index.html` seul. Ne pas mettre de `<style>` ni de `<script>` en ligne.
- **Cache HTTP** (`staticCache` dans `server/app.js`) : `/uploads` immuable (noms uniques), images du site un jour, le reste `no-cache`.
  Un nouveau type de fichier statique doit y trouver sa place.
- **Photos** : afficher une photo en petit avec `imgAttrs(url, sizes)` (carte, fiche, vitrine) ou `thumbUrl(url, 480)` (vignette), jamais
  l'original de 1920 px. `server/thumbs.js` génère `/uploads/thumbs/480|960/<nom>.webp` à la première demande (largeurs de liste blanche,
  stockage borné) ; ce dossier est un cache régénérable, à exclure des sauvegardes.
- **Leaflet** (150 Ko) n'est chargé qu'à la première ouverture de la carte (`loadLeaflet`) : ne pas le remettre dans la page.

## Recherche tolérante

- **Toute recherche libre passe par `server/search.js`** (annonces, agences, programmes) : chaque mot de la requête, normalisé (accents,
  casse, ponctuation, arabe : tachkil, tatwil, alif à hamza, ى/ي, ة/ه, chiffres indo-arabes), doit figurer dans le **texte de recherche**
  de l'objet (tables `property_search`, `agency_search`, `project_search`, tenues à jour par des **déclencheurs SQL** : toute écriture,
  API, SQL ou seed, est prise en compte). Ne pas réécrire d'`ILIKE` sur les colonnes brutes ; utiliser `search.condition(...)`.
- Le texte indexé contient aussi le nom arabe de la wilaya et les mots arabes du type de bien, du mode et du type de professionnel
  (table `search_lexicon`, alignée sur `LEXICON` au démarrage par `search.sync`, avec verrou pour pm2 cluster) : « الجزائر » trouve Alger.
  Une nouvelle wilaya, un nouveau type de bien ou de mode doit être ajouté à `LEXICON` (test de complétude).
- **`dz_norm()` (SQL, migration 012) et `normalize()` (JS) doivent rester identiques** : `tests/api/search.test.js` les compare sur tous les
  caractères des blocs latin et arabe. La migration est générée : modifier la normalisation exige une nouvelle migration.
- Aucune extension PostgreSQL (`unaccent`, `pg_trgm`) : droits particuliers et invisibles des schémas de test. Recherche par sous-chaîne
  (pas de tolérance aux fautes de frappe) ; si le volume l'exige, un index `pg_trgm` sur `*_search.text` est la suite naturelle.

## Recherche sur la carte

- **Trois vues, une seule à la fois** (`_mapMode` dans `public/app.js`) : tous les biens (filtres wilaya / mode / type), **rayon** autour d'un point (clic sur la carte, curseur de rayon,
  ou bouton « Autour de moi »), **zone dessinée** (clics = sommets d'un polygone, « Terminer » ou clic sur le premier point, « Annuler le dernier point », « Effacer »).
  Les filtres de la barre rafraîchissent le rayon ou la zone actifs (`loadMapMarkers` aiguille) ; une réponse plus lente qu'une demande plus récente est ignorée (`_mapReq`).
  Les trois vues dessinent leurs marqueurs avec `mapMarker` / `showMapMarkers` (bouton de la fenêtre : `data-id`, jamais de donnée dans `onclick`).
- **Serveur** (`server/geo.js`, routes dans `server/routes/properties.js`) : pas de PostGIS. Un rectangle englobant sur `(lat, lng)` (index partiel `idx_properties_geo`, migration 021)
  écarte l'essentiel, puis la distance (grand cercle) ou la parité des croisements d'arêtes (point dans polygone, y compris concave) tranche, **en SQL** avec `LIMIT`.
  `GET /api/properties/nearby?lat&lng&radius[&mode&type_bien&wilaya]` (rayon 0,1–100 km) et `POST /api/properties/zone { polygon: [[lat, lng], …], mode?, type_bien?, wilaya? }`
  (3 à 60 sommets, zone sans surface refusée : 400 « Zone invalide. »). **Au plus 100 biens**, `truncated: true` quand il y en avait davantage (le front l'annonce).
  Seules les annonces `active` avec position sont renvoyées ; jamais d'email du propriétaire. Limiteur partagé `geo` (60 / min, `server/app.js`).
- **Vie privée** : la zone dessinée part en **POST** (ni dans l'adresse, ni dans les journaux du serveur) ; la position du visiteur n'est demandée qu'au clic sur « Autour de moi »,
  **arrondie à 3 décimales (~110 m)** avant envoi (`mapCoord`) ; ni la position ni la zone ne sont stockées, journalisées ou mises en `localStorage`.
- Tests : `tests/api/carte-zone.test.js` (polygone convexe et concave, filtres, limite, erreurs et traduction), `tests/unit/carte-front.test.js` (traductions FR / AR, POST, arrondi, échappement).

## Consignes

- Ne jamais committer `.env`, `.env.production` ni `dzimmo.json`.
- Toute variable de configuration nouvelle doit être ajoutée à `.env.example`.
- Aucun lien vers le site en dur : `siteUrl()` (`server/mailer.js`) ou `APP_URL`. Aucune adresse email ni numéro de téléphone dans les journaux.
- Une liste renvoyée par l'API est toujours bornée (`LIMIT`) : `GET /api/properties/user/:id` accepte `?limit=` (100 au plus) et `?offset=`,
  le total est dans l'en-tête `X-Total-Count`.
- Tout nouveau message d'erreur de l'API (`res.status(…).json({ error: '…' })`) doit être ajouté à `server/i18n.js`
  avec sa traduction arabe : le site envoie sa langue dans l'en-tête `X-Lang`, le serveur traduit à l'envoi.
  Un test (`tests/unit/i18n-errors.test.js`) échoue si un message n'a pas de traduction.
- Emails (`server/mailer.js`, gabarits `build*`) et notifications temps réel (`server/messages.js`) sont rédigés en
  français **et** en arabe, dans la langue du destinataire (`users.lang`, dernière langue choisie sur le site).
  Tout nouvel email ou nouvelle notification doit recevoir `lang` et exister dans les deux langues, et tout gabarit `build*`
  a son jeu de données dans `tests/unit/emails-notifs.test.js`. `sendMail` renvoie `true` / `false` : une route dont l'email
  **est** le résultat (page Contact) répond 503 en cas d'échec, jamais un faux « envoyé ».
- **Page Contact** (`POST /api/contact`, `server/routes/contact.js`) — à ne pas confondre avec `/api/contacts` (demandes sur une annonce) :
  le message part à `CONTACT_EMAIL`, sinon aux administrateurs (dans leur langue), avec l'adresse du visiteur en `Reply-To` seulement ;
  il n'est ni stocké ni journalisé. Le limiteur `contact` est partagé entre les workers.
- **Newsletter** (`server/newsletter.js`, `server/routes/newsletter.js`, migration 017) : inscription à **double confirmation**. `POST /api/newsletter/subscribe`
  n'ajoute que des lignes sans `confirmed_at` et envoie un email (FR ou AR selon `X-Lang`) ; seul le clic sur le bouton de la page
  `/newsletter/confirmation` (`POST /confirm`) donne le consentement. Les jetons sont des HMAC de l'id et de l'usage (`confirm` ≠ `unsubscribe`),
  jamais renvoyés par l'API ; l'inscription répond toujours `{ ok: true }` (elle ne révèle pas si l'adresse existe) et 503 sans SMTP.
  Les inscrits jamais confirmés sont purgés après 7 jours (cron 03:45), **anciens inscrits sans consentement compris**.
  Les envois par les administrateurs (Administration → Newsletter) créent une campagne (`newsletter_campaigns`, texte FR + AR) et une ligne
  par abonné confirmé (`newsletter_deliveries`) ; le cron de chaque minute vide la file par lots (`FOR UPDATE SKIP LOCKED`, 5 essais, reprise à 10 min),
  chacun dans la langue de l'abonné. Chaque envoi porte un lien de désinscription à jeton et les en-têtes `List-Unsubscribe` / `List-Unsubscribe-Post` (RFC 8058) ;
  la page `/newsletter/desinscription` désinscrit par un bouton (jamais à l'ouverture du lien, pour les antivirus qui suivent les liens).
  Pages en `noindex`, `no-referrer` et `Disallow` dans robots.txt. Le limiteur `newsletter` ne couvre que l'inscription. **Le SMTP est indispensable** : sans lui, ni
  inscription ni envoi. Ne jamais envoyer à une adresse non confirmée.
- Envoi d'images (`server/routes/upload.js`) : un fichier illisible est une erreur du client (400), et l'envoi multiple est tout ou rien
  (les fichiers déjà écrits sont retirés).
- Toute image saisie par un utilisateur (annonce, logo, programme…) est validée par `server/images.js` : fichier envoyé sur ce site
  (`/uploads/…`) ou, pour les annonces de démonstration, adresse https de la liste blanche `REMOTE_HOSTS`. Ajouter un domaine
  est une décision de sécurité (à répercuter dans la migration `011_clean_listing_images.sql`, test `listing-images.test.js`).
  L'avatar d'un compte suit la même logique : fichier `/uploads/…` seulement, ou photo Google servie par `lh*.googleusercontent.com`
  (`isGoogleAvatar`, règle identique dans la migration `015_clean_avatars.sql`).
- Répondre et commenter le code en français.
