-- Vues journalières par annonce : courbe d'évolution sur 30 jours dans le tableau de bord.
-- Les clics appel / WhatsApp sont déjà dans contact_clicks (migration 008).
CREATE TABLE IF NOT EXISTS property_views_daily (
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  day         DATE    NOT NULL DEFAULT CURRENT_DATE,
  views       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, day)
);
CREATE INDEX IF NOT EXISTS idx_pvd_property ON property_views_daily (property_id, day DESC);
