# DzImmo — Plateforme d'annonces immobilières (Algérie)

Fork de LocaVac. Package npm `dzimmo`. Domaine cible : dzimmo.dz.

## Stack

- Node.js 20 + Express 4 — point d'entrée `server/index.js`
- PostgreSQL 17 (port **5433** en local)
- Auth JWT (`jsonwebtoken` + `bcryptjs`)
- Frontend HTML/CSS/JS vanilla en SPA, servi depuis `public/`
- Upload `multer`, email `nodemailer`, tâches planifiées `node-cron`, temps réel `ws`
- Production : pm2 cluster (`ecosystem.config.js`) + Nginx + Let's Encrypt

## Commandes

```bash
npm run dev      # nodemon
npm start        # node server/index.js
npm run make-admin -- <email>   # promeut un compte existant administrateur (--retirer pour l'inverse)
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
  Tout nouvel email ou nouvelle notification doit recevoir `lang` et exister dans les deux langues.
- Toute image saisie par un utilisateur (annonce, logo, programme…) est validée par `server/images.js` : fichier envoyé sur ce site
  (`/uploads/…`) ou, pour les annonces de démonstration, adresse https de la liste blanche `REMOTE_HOSTS`. Ajouter un domaine
  est une décision de sécurité (à répercuter dans la migration `011_clean_listing_images.sql`, test `listing-images.test.js`).
  L'avatar d'un compte suit la même logique : fichier `/uploads/…` seulement, ou photo Google servie par `lh*.googleusercontent.com`
  (`isGoogleAvatar`, règle identique dans la migration `015_clean_avatars.sql`).
- Répondre et commenter le code en français.
