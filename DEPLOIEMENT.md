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
| `EMAIL_*` | compte SMTP : sans lui, aucun email de confirmation, de mot de passe oublié ni d'alerte |
| `VERIFICATION_DIR` | dossier **privé** des justificatifs de vérification (défaut : `private/verification` dans le projet) |

Le dossier des justificatifs ne doit jamais être servi par Nginx ni placé sous `public/`. L'utilisateur qui lance
l'application doit pouvoir y écrire (`chmod 700`). Les fichiers y sont supprimés dès que l'administrateur décide : il
n'y a rien à sauvegarder, et il ne faut pas l'inclure dans les sauvegardes du § 7.

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

## 6. Vérifications après déploiement

```bash
curl -s https://dzimmo.dz/api/health              # {"ok":true,…}
curl -s https://dzimmo.dz/robots.txt              # Sitemap: https://dzimmo.dz/sitemap.xml
curl -s -o /dev/null -w "%{http_code}\n" https://dzimmo.dz/page-inexistante   # 404
pm2 logs dzimmo --lines 30                        # aucun « ❌ Configuration », avertissements lus
```

Vérifier aussi qu'un email de confirmation arrive (inscription d'un compte de test) et que la connexion WebSocket
(`wss://dzimmo.dz/ws`) s'établit : une notification apparaît quand un message est reçu.

## 7. Sauvegardes

À planifier (cron) : la base **et** les photos envoyées (pas le dossier des justificatifs, voir § 2).

```bash
pg_dump -Fc dzimmo > /srv/backups/dzimmo-$(date +%F).dump
tar czf /srv/backups/uploads-$(date +%F).tgz -C /srv/dzimmo/public uploads
```

Restauration : `pg_restore -d dzimmo --clean dzimmo-AAAA-MM-JJ.dump`.

## 8. Mises à jour

```bash
cd /srv/dzimmo && git pull && npm ci --omit=dev && pm2 reload dzimmo
```

`pm2 reload` renouvelle les workers un par un, sans coupure. Les nouvelles migrations s'appliquent au redémarrage.
Les tests tournent sur GitHub Actions (`.github/workflows/ci.yml`) à chaque poussée.
