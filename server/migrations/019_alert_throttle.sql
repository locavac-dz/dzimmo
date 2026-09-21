-- Alertes de supervision (server/monitor.js) : une seule alerte par nature de panne et par période, tous workers confondus.
-- La ligne garde la date du dernier envoi ; aucune donnée personnelle, aucun détail de l'erreur.
CREATE TABLE IF NOT EXISTS alert_throttle (
  kind         TEXT        PRIMARY KEY,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
