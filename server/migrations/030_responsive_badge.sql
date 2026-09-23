-- Migration 030 : badge « Réactif » — temps de réponse aux demandes de contact
-- responded_at est renseigné quand le propriétaire change le statut de « pending » à autre chose.
-- users.responsive est recalculé chaque nuit par le cron (80 % des demandes répondues en < 24 h,
-- sur les 30 derniers jours, avec au minimum 3 demandes).
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
ALTER TABLE users             ADD COLUMN IF NOT EXISTS responsive   BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_cr_responded
    ON contact_requests (property_id, responded_at)
 WHERE responded_at IS NOT NULL;
