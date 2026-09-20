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
- `public/` — front SPA ; `public/uploads/` est ignoré par Git
- `backups/` — sauvegardes locales, hors Git
- `dzimmo.json` — configuration locale, hors Git
- `DEPLOIEMENT.md` — mise en production (PostgreSQL, pm2, Nginx, sauvegardes)
- `.github/workflows/ci.yml` — tests à chaque poussée (PostgreSQL 17 en service)

## Production

- pm2 tourne en mode cluster : rien ne doit dépendre de la mémoire d'un seul processus. Les tâches planifiées
  (`server/cron.js`) ne démarrent que dans l'instance 0 (`NODE_APP_INSTANCE`) ; les notifications temps réel
  (`server/ws.js`) passent d'un worker à l'autre par PostgreSQL `LISTEN / NOTIFY`.
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
  middlewares `auth` et `admin`, la fiche non publique et le WebSocket relisent le compte en base ; le rôle admin vient de la base, pas du jeton.
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
  ni identifiant de visiteur** (le dédoublonnage de 10 min est en mémoire) ; visibles de l'annonceur seul ; `POST /:id/click` répond
  toujours 204 (ne révèle rien sur l'annonce).

## Consignes

- Ne jamais committer `.env`, `.env.production` ni `dzimmo.json`.
- Toute variable de configuration nouvelle doit être ajoutée à `.env.example`.
- Tout nouveau message d'erreur de l'API (`res.status(…).json({ error: '…' })`) doit être ajouté à `server/i18n.js`
  avec sa traduction arabe : le site envoie sa langue dans l'en-tête `X-Lang`, le serveur traduit à l'envoi.
  Un test (`tests/unit/i18n-errors.test.js`) échoue si un message n'a pas de traduction.
- Emails (`server/mailer.js`, gabarits `build*`) et notifications temps réel (`server/messages.js`) sont rédigés en
  français **et** en arabe, dans la langue du destinataire (`users.lang`, dernière langue choisie sur le site).
  Tout nouvel email ou nouvelle notification doit recevoir `lang` et exister dans les deux langues.
- Répondre et commenter le code en français.
