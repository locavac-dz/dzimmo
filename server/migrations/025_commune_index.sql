-- Pages de commune (/vente/oran/bir-el-djir…) et filtre `commune` de l'API. Index partiels : seules les annonces publiées sont cherchées.
-- (wilaya, commune) : la page de commune du serveur (server/seo.js) et la liste des saisies d'une wilaya.
CREATE INDEX IF NOT EXISTS idx_properties_commune ON properties (wilaya, commune) WHERE status = 'active' AND commune IS NOT NULL;
-- dz_norm(commune) : le filtre de l'API ignore casse, accents et ponctuation.
CREATE INDEX IF NOT EXISTS idx_properties_commune_norm ON properties (dz_norm(commune)) WHERE status = 'active' AND commune IS NOT NULL;
