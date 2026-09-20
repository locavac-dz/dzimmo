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
- Interface bilingue FR / AR — toute nouvelle chaîne dans les deux langues
- Montants en **DZD**
- Conformité RGPD + loi algérienne 18-07

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
