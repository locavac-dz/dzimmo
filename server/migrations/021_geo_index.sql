-- Recherche sur la carte (server/geo.js) : rectangle englobant sur la position des annonces publiées.
-- Partiel : seules les annonces actives et géolocalisées y figurent (le reste n'est jamais cherché par zone).
CREATE INDEX IF NOT EXISTS idx_properties_geo ON properties (lat, lng) WHERE status = 'active' AND lat IS NOT NULL AND lng IS NOT NULL;
