-- Résumé quotidien des alertes de baisse de prix (server/price-drop.js, server/cron.js).
-- Les notifications par email sont mises en file ici et envoyées en un seul digest à 18 h,
-- au lieu d'un email par baisse et par membre.
CREATE TABLE price_drop_queue (
  id          SERIAL      PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  property_id INTEGER     NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  old_price   NUMERIC     NOT NULL,
  new_price   NUMERIC     NOT NULL,
  percent     INTEGER     NOT NULL,
  queued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pdq_user ON price_drop_queue (user_id);
