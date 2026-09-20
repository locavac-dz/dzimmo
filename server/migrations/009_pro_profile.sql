-- Vitrine des agences et des promoteurs : type de professionnel, visuels, présentation, zones et services.
-- « kind » : une agence vend / loue pour des tiers, un promoteur vend ses propres programmes neufs.
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS kind         TEXT NOT NULL DEFAULT 'agence' CHECK (kind IN ('agence', 'promoteur'));
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS cover        TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS tagline      TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS commune      TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS facebook     TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS instagram    TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS hours        TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS founded_year INTEGER;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS services     JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS coverage     JSONB NOT NULL DEFAULT '[]';

-- Annuaire : filtre par type et par wilaya ; retrouver l'agence d'un compte
CREATE INDEX IF NOT EXISTS idx_agencies_kind_wilaya ON agencies (kind, wilaya);
CREATE INDEX IF NOT EXISTS idx_agencies_owner       ON agencies (owner_id);
-- Note de l'agence = moyenne des avis de ses annonces (jointure avis → annonces)
CREATE INDEX IF NOT EXISTS idx_reviews_property     ON reviews (property_id);
