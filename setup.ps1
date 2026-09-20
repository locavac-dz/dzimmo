# setup.ps1 — Initialise la base dzimmo et lance le serveur
# Exécuter depuis PowerShell : .\setup.ps1

$PG_BIN   = "C:\Program Files\PostgreSQL\17\bin"
$PG_ADMIN = "postgres"
$PG_PORT  = "5432"
$PG_PSQL  = "$PG_BIN\psql.exe"

Write-Host "`n=== DzImmo — Configuration de la base de données ===" -ForegroundColor Cyan

# 1. Vérifier que psql existe
if (-not (Test-Path $PG_PSQL)) {
    Write-Host "ERREUR: psql introuvable dans $PG_BIN" -ForegroundColor Red
    Write-Host "Ajustez la variable PG_BIN au début de ce script."
    exit 1
}

# 2. Créer l'utilisateur dzimmo s'il n'existe pas
# Mot de passe du rôle : variable d'environnement DZIMMO_DB_PASSWORD, sinon saisie masquée.
# Il ne doit jamais être écrit dans ce fichier (suivi par Git) : c'est le même que dans DATABASE_URL (.env).
$dbPassword = $env:DZIMMO_DB_PASSWORD
if (-not $dbPassword) {
    $secure = Read-Host "Mot de passe à donner au rôle 'dzimmo' (le même que dans DATABASE_URL du .env)" -AsSecureString
    $dbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if (-not $dbPassword) {
    Write-Host "ERREUR: mot de passe vide." -ForegroundColor Red
    exit 1
}
$sqlPassword = $dbPassword.Replace("'", "''")   # apostrophes doublées pour le littéral SQL

Write-Host "`n[1/3] Création de l'utilisateur 'dzimmo' (si absent)..." -ForegroundColor Yellow
& $PG_PSQL -U $PG_ADMIN -p $PG_PORT -c "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='dzimmo') THEN CREATE ROLE dzimmo LOGIN PASSWORD '$sqlPassword'; END IF; END `$`$;"

# 3. Créer la base dzimmo
Write-Host "`n[2/3] Création de la base 'dzimmo' (si absente)..." -ForegroundColor Yellow
$exists = & $PG_PSQL -U $PG_ADMIN -p $PG_PORT -tAc "SELECT 1 FROM pg_database WHERE datname='dzimmo'"
if ($exists -ne "1") {
    & $PG_PSQL -U $PG_ADMIN -p $PG_PORT -c "CREATE DATABASE dzimmo OWNER dzimmo ENCODING 'UTF8';"
    Write-Host "  ✅ Base 'dzimmo' créée." -ForegroundColor Green
} else {
    Write-Host "  ℹ️  Base 'dzimmo' déjà présente." -ForegroundColor Gray
}

# 4. Accorder les droits
Write-Host "`n[3/3] Attribution des droits à 'dzimmo'..." -ForegroundColor Yellow
& $PG_PSQL -U $PG_ADMIN -p $PG_PORT -d dzimmo -c "GRANT ALL PRIVILEGES ON DATABASE dzimmo TO dzimmo;"
& $PG_PSQL -U $PG_ADMIN -p $PG_PORT -d dzimmo -c "GRANT ALL ON SCHEMA public TO dzimmo;"

Write-Host "`n✅ Base de données prête !" -ForegroundColor Green
Write-Host "`n=== Démarrage du serveur DzImmo ===" -ForegroundColor Cyan

# 5. Démarrer le serveur
Set-Location $PSScriptRoot
npm run dev
