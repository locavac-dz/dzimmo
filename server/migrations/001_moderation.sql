-- Modération des annonces.
-- Nouveaux statuts de properties.status : 'pending' (en attente de validation)
-- et 'rejected' (refusée, motif dans moderation_reason).

ALTER TABLE properties ADD COLUMN IF NOT EXISTS published_at      TIMESTAMPTZ;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS moderated_at      TIMESTAMPTZ;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS moderated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Les annonces existantes ont déjà été publiées : on conserve leur date de création.
UPDATE properties SET published_at = created_at
 WHERE published_at IS NULL AND status IN ('active', 'sold', 'rented', 'archived');

CREATE INDEX IF NOT EXISTS idx_properties_status ON properties (status);
