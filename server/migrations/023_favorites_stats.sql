-- Statistiques de l'annonceur (server/advice.js) : favoris comptés par annonce et par jour (GET /api/properties/:id/stats).
-- La contrainte UNIQUE(user_id, property_id) ne sert que les requêtes par membre : il manquait l'index côté annonce.
CREATE INDEX IF NOT EXISTS idx_favorites_property ON favorites (property_id, created_at);
