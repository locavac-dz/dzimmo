ALTER TABLE search_alerts
  ADD COLUMN IF NOT EXISTS rooms     SMALLINT,
  ADD COLUMN IF NOT EXISTS condition TEXT CHECK (condition IN ('brut','semi_fini','renove','bon_etat','neuf'));
