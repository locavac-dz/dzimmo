-- Compteurs de limitation de débit partagés entre les workers pm2 (server/rate-store.js).
-- Avant : chaque worker comptait dans sa propre mémoire, donc « 20 tentatives de connexion par quart d'heure » devenait
-- 20 × le nombre de cœurs, et un même visiteur était compté une fois par worker dans les clics Appeler / WhatsApp.
-- La clé est un HMAC (jamais l'adresse IP en clair) ; une ligne ne vit que le temps de sa fenêtre (purge horaire, server/cron.js).
-- UNLOGGED : données jetables, pas de journal d'écriture ; vidée sans dommage après un arrêt brutal de PostgreSQL.
CREATE UNLOGGED TABLE IF NOT EXISTS rate_limits (
  key      text        PRIMARY KEY,
  hits     integer     NOT NULL DEFAULT 1,
  reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits (reset_at);
