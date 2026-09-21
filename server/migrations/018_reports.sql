-- Signalements d'annonces : un seul signalement en attente par membre et par annonce, traçabilité de la décision.
ALTER TABLE signalements ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE signalements ADD COLUMN IF NOT EXISTS resolved_by INTEGER;

-- Les doublons existants (même membre, même annonce, encore en attente) sont classés sans suite, le plus récent est conservé
UPDATE signalements SET status = 'dismissed', resolved_at = NOW()
 WHERE status = 'pending' AND user_id IS NOT NULL
   AND id NOT IN (SELECT MAX(id) FROM signalements WHERE status = 'pending' AND user_id IS NOT NULL GROUP BY property_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signalements_un_en_attente
  ON signalements (property_id, user_id) WHERE status = 'pending';

-- Liste d'administration (par statut, plus récents d'abord) et plafond quotidien par membre
CREATE INDEX IF NOT EXISTS idx_signalements_statut_date ON signalements (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signalements_membre_date ON signalements (user_id, created_at DESC);
