# Mise en production de DzImmo

Serveur Linux (Debian / Ubuntu) avec Node.js 20, PostgreSQL 17, Nginx, pm2 et Certbot.
Le serveur **refuse de démarrer** en production si `JWT_SECRET` est absent, trop court ou copié de `.env.example`,
ou si `APP_URL` est absente ou locale (`server/config-check.js`). Les réglages dégradés (SMTP, `TRUST_PROXY`, CORS…)
sont signalés par des avertissements dans les logs au démarrage.

## 1. Base de données

```bash
sudo -u postgres psql -c "CREATE ROLE dzimmo LOGIN PASSWORD '<mot de passe>';"
sudo -u postgres psql -c "CREATE DATABASE dzimmo OWNER dzimmo ENCODING 'UTF8';"
```

Le schéma et les migrations (`server/schema.sql`, `server/migrations/`) s'appliquent seuls au démarrage.
Le compte et les annonces de démonstration ne sont **jamais** créés en production.

## 2. Application

```bash
git clone <dépôt> /srv/dzimmo && cd /srv/dzimmo
npm ci --omit=dev
cp .env.example .env    # puis remplir chaque valeur
```

Valeurs à renseigner dans `.env` :

| Variable | Valeur en production |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DATABASE_URL` | `postgresql://dzimmo:<mot de passe>@localhost:5432/dzimmo` |
| `APP_URL` | `https://dzimmo.dz` (liens des emails, sitemap, URL canoniques) |
| `CORS_ORIGINS` | `https://dzimmo.dz` |
| `TRUST_PROXY` | `1` (Nginx devant l'application : sinon tous les visiteurs partagent la même limite de débit) |
| `EMAIL_*` | compte SMTP : sans lui, aucun email de confirmation, de mot de passe oublié ni d'alerte, et la newsletter (inscription et envois) est inopérante |
| `VERIFICATION_DIR` | dossier **privé** des justificatifs de vérification (défaut : `private/verification` dans le projet) |

Le dossier des justificatifs ne doit jamais être servi par Nginx ni placé sous `public/`. L'utilisateur qui lance
l'application doit pouvoir y écrire (`chmod 700`). Les fichiers y sont supprimés dès que l'administrateur décide : il
n'y a rien à sauvegarder, et il ne faut pas l'inclure dans les sauvegardes du § 7.

### Connexion avec Google (facultative)

Sans cette étape le site fonctionne avec email et mot de passe, sans bouton Google et sans aucun accès à Google.

1. Console Google Cloud (console.cloud.google.com) → créer un projet → **API et services → Écran de consentement OAuth** :
   type *Externe*, nom « DzImmo », email d'assistance, domaine autorisé `dzimmo.dz`, champs `openid`, `email`, `profile`
   (aucune validation Google n'est demandée pour ces champs), puis **Publier l'application** (sinon seuls les comptes de test peuvent se connecter).
2. **Identifiants → Créer des identifiants → ID client OAuth**, type *Application Web*. Origines JavaScript autorisées :
   `https://dzimmo.dz` (et `http://localhost:3001` pour essayer en local). **Aucun URI de redirection** n'est nécessaire.
3. Copier l'ID client (`…apps.googleusercontent.com`) dans `.env` : `GOOGLE_CLIENT_ID=…`, puis `pm2 reload dzimmo`.
   Il n'y a **pas de « secret client »** à stocker : le serveur vérifie la signature du jeton avec les clés publiques de Google.
4. Vérifier : la fenêtre « Connexion » affiche le bouton Google ; au démarrage, aucun avertissement `GOOGLE_CLIENT_ID` dans `pm2 logs`.

## 3. pm2

```bash
pm2 start ecosystem.config.js --env production
pm2 save && pm2 startup     # démarrage automatique au redémarrage du serveur
```

Le mode cluster (`instances: 'max'`) est pris en charge : les tâches planifiées ne tournent que dans le premier
worker, et les notifications temps réel passent d'un worker à l'autre par PostgreSQL (`LISTEN / NOTIFY`).

## 4. Nginx et HTTPS

**Tout** le trafic doit être relayé vers Node (pas de `try_files` ni de service direct des fichiers) : les pages
`/annonce/…`, `/vente/…`, `sitemap.xml` et les vraies pages 404 sont produites par l'application.

```nginx
server {
    listen 80;
    server_name dzimmo.dz www.dzimmo.dz;
    return 301 https://dzimmo.dz$request_uri;
}

server {
    listen 443 ssl http2;
    server_name dzimmo.dz;
    # Les lignes ssl_certificate / ssl_certificate_key sont ajoutées par Certbot

    client_max_body_size 12m;          # photos : 10 Mo maximum chacune

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {                     # notifications temps réel
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_read_timeout 3600s;
    }
}
```

```bash
sudo certbot --nginx -d dzimmo.dz -d www.dzimmo.dz
```

## 5. Premier compte administrateur

S'inscrire sur le site avec l'adresse voulue, puis :

```bash
npm run make-admin -- adresse@exemple.dz
```

### Double authentification des administrateurs

En production, la double authentification (TOTP) est **obligatoire** pour les administrateurs (`ADMIN_2FA_REQUIRED`, vrai par défaut
quand `NODE_ENV=production`). À la première connexion, l'administrateur arrive sur Administration → Sécurité : il scanne le code QR
avec une application d'authentification (Google Authenticator, Aegis, FreeOTP…), saisit un code, puis note ses **10 codes de secours**
(affichés une seule fois). Tant que ce n'est pas fait, le reste de l'administration est refusé.

- **Administrateur déjà en place avant cette mise à jour** : il devra configurer son 2FA à sa prochaine connexion.
- **Téléphone perdu et plus de codes de secours** : un autre administrateur ne peut pas le faire à sa place, c'est une opération sur le serveur :

  ```bash
  npm run make-admin -- adresse@exemple.dz --reset-2fa
  ```

  Elle efface la configuration et ferme toutes les sessions du compte ; l'administrateur se reconnecte avec son mot de passe et reconfigure.
- **`JWT_SECRET`** : le secret TOTP est chiffré avec une clé dérivée de `JWT_SECRET`. Changer `JWT_SECRET` (rotation) rend les secrets
  illisibles : chaque administrateur doit alors passer par `--reset-2fa`. À prévoir avant toute rotation.
- `ADMIN_2FA_REQUIRED=false` rend le 2FA facultatif (il reste proposé) ; le contrôle de configuration au démarrage le signale par un avertissement.
- Un compte qui a activé le 2FA ne peut pas administrer avec une session ouverte sans code : activer ou désactiver le 2FA ferme les autres sessions.

## 6. Vérifications après déploiement

```bash
curl -s https://dzimmo.dz/api/health              # {"ok":true,…}
curl -s https://dzimmo.dz/robots.txt              # Sitemap: https://dzimmo.dz/sitemap.xml
curl -s -o /dev/null -w "%{http_code}\n" https://dzimmo.dz/page-inexistante   # 404
pm2 logs dzimmo --lines 30                        # aucun « ❌ Configuration », avertissements lus
```

Vérifier aussi qu'un email de confirmation arrive (inscription d'un compte de test) et que la connexion WebSocket
(`wss://dzimmo.dz/ws`) s'établit : une notification apparaît quand un message est reçu.

## 7. Supervision et sauvegardes

### Alertes par email (`server/monitor.js`)

Un email part au responsable quand : une erreur 500 survient, le processus plante (`uncaughtException`, pm2 le relance),
une tâche planifiée échoue ou la sauvegarde nocturne échoue / n'existe plus. Une seule alerte par nature de panne et par heure
(table `alert_throttle`, commune aux workers), message en français ou en arabe, **sans adresse email, numéro ni URL de connexion**.

- Destinataire : `ALERT_EMAIL`, sinon `CONTACT_EMAIL`, sinon les administrateurs (dans leur langue).
- **Le SMTP est indispensable** (`EMAIL_HOST`, `EMAIL_USER`…) : sans lui, aucune alerte n'est envoyée (un avertissement
  s'affiche au démarrage). Tester : arrêter PostgreSQL une minute, l'alerte « erreur 500 » doit arriver.
- Une alerte par email ne remplace pas une supervision externe de disponibilité (UptimeRobot, Better Stack…) sur `https://dzimmo.dz/api/health` :
  si le serveur entier est éteint, personne ne peut envoyer d'email.

### Sauvegarde automatique de la base (`server/backup.js`)

Active par défaut en production (`BACKUP_ENABLED=false` pour la couper), lancée par le cron de l'instance 0 :

| Heure | Tâche |
|---|---|
| chaque nuit à 02:30 | `pg_dump -Fc` dans `BACKUP_DIR` (défaut `backups/`, hors Git, jamais sous `public/`), rotation : `BACKUP_KEEP` fichiers (14) |
| dimanche à 05:30 | **test de restauration** de la dernière sauvegarde dans une base jetable (`dzimmo_verif_*`, supprimée ensuite) |
| chaque jour à 06:30 | alerte si la dernière sauvegarde a plus de 36 h ou n'existe pas |

Il faut les outils PostgreSQL sur le serveur (`sudo apt install postgresql-client-17`, ou `PG_BIN_DIR=/usr/lib/postgresql/17/bin`).
La table `rate_limits` (compteurs jetables) n'est pas sauvegardée. Le mot de passe passe par les variables `PG*`, jamais en argument.

À la main :

```bash
npm run backup                 # sauvegarde immédiate + rotation
npm run backup:verify          # teste la plus récente (code de sortie 1 en cas d'échec)
npm run backup:verify -- backups/dzimmo-2026-09-21-0230.dump
```

**Droit `CREATEDB`.** Le test de restauration complète crée une base jetable : le compte de `DATABASE_URL` doit avoir ce droit
(`ALTER ROLE dzimmo CREATEDB;`), ou bien `BACKUP_VERIFY_URL` désigne un compte qui l'a. Sans lui, le test se replie sur une
**relecture complète de l'archive** (`pg_restore` lit tout le fichier et vérifie les tables) : elle détecte un fichier corrompu ou
tronqué, mais pas un problème de restauration proprement dit. Le mode utilisé est indiqué dans le journal.

### À faire en plus, hors application

Une sauvegarde qui reste sur le serveur ne protège pas d'une perte du serveur : **copier `BACKUP_DIR` ailleurs** (autre machine,
stockage objet, `rclone`/`rsync` dans un cron). Les photos envoyées ne sont pas dans la base (pas le dossier des justificatifs, voir § 2) :

```bash
tar czf /srv/backups/uploads-$(date +%F).tgz --exclude=uploads/thumbs -C /srv/dzimmo/public uploads
```

`uploads/thumbs` (miniatures des photos, créées à la première demande par l'application) est un cache : inutile de le sauvegarder,
il se reconstruit tout seul. Nginx doit continuer à transmettre `/uploads/thumbs/…` à l'application (le `location /` ci-dessus le
fait) : c'est elle qui crée la miniature manquante ; les suivantes sont servies par les fichiers eux-mêmes.

### Restauration

```bash
createdb dzimmo_neuve && pg_restore -d dzimmo_neuve --no-owner backups/dzimmo-AAAA-MM-JJ-HHMM.dump
```

Puis pointer `DATABASE_URL` vers cette base et `pm2 reload dzimmo`, ou restaurer sur place avec `pg_restore -d dzimmo --clean`.
Les justificatifs de vérification ne sont jamais sauvegardés (supprimés dès la décision) : rien à restaurer de ce côté.

## 8. Cache du navigateur

L'application pose elle-même les en-têtes de cache (rien à ajouter dans Nginx) : photos et miniatures `immutable` pendant un an,
`app.js` / `app.css` / `pro.js` / `contrats.js` versionnés par empreinte (`?v=…`) donc immuables, pages revalidées par ETag.
Un déploiement n'exige aucune purge : l'adresse des scripts change dès que leur contenu change.

## 9. Mises à jour

```bash
cd /srv/dzimmo && git pull && npm ci --omit=dev && pm2 reload dzimmo
```

`pm2 reload` renouvelle les workers un par un, sans coupure. Les nouvelles migrations s'appliquent au redémarrage.
Les tests tournent sur GitHub Actions (`.github/workflows/ci.yml`) à chaque poussée.
