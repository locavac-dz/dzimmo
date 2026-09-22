-- Heure souhaitée pour les demandes de visite (HH:MM, optionnel)
ALTER TABLE contact_requests
  ADD COLUMN IF NOT EXISTS visit_time TEXT
    CHECK (visit_time IS NULL OR visit_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
