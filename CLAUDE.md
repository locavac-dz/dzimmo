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

## Structure

- `server/` — API Express
- `public/` — front SPA ; `public/uploads/` est ignoré par Git
- `backups/` — sauvegardes locales, hors Git
- `dzimmo.json` — configuration locale, hors Git

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
