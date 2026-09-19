-- Index des tris de la liste d'annonces (GET /api/properties) : un parcours d'index dans l'ordre demandé
-- s'arrête après la première page au lieu de trier toutes les annonces du statut.
-- « id » ferme chaque tri (départage les ex æquo, donc des pages stables) et fait partie de l'index.
-- idx_properties_published (003, tri par published_at) reste utile aux alertes email.

CREATE INDEX IF NOT EXISTS idx_properties_status_created ON properties (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_properties_status_price   ON properties (status, price, id);
