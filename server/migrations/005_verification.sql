-- Vérification des annonceurs : justificatif d'identité (particulier) ou de profession (registre de commerce,
-- agrément) examiné par un administrateur. Le badge public repose sur users.verified_kind.
-- Les fichiers ne sont pas dans cette table : ils restent dans un dossier privé (hors public/) et sont
-- supprimés dès la décision ; on conserve seulement le résultat, le motif et l'examinateur.

ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_kind TEXT CHECK (verified_kind IN ('identity', 'business'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at   TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS verification_requests (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('identity', 'business')),
  doc_type     TEXT NOT NULL,                       -- cni | passeport | permis | registre_commerce | agrement
  reference    TEXT,                                -- numéro du registre de commerce / de l'agrément (professionnels)
  files        JSONB NOT NULL DEFAULT '[]',         -- noms des fichiers privés ; vidé à la décision
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reason       TEXT,                                -- motif du refus
  reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Une seule demande en cours par compte (garantie même en cas de double envoi simultané)
CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_pending ON verification_requests (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_verification_status ON verification_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_verification_user   ON verification_requests (user_id, created_at DESC);
