-- Mise en avant « À la une » (server/featured.js) : date de fin sur l'annonce, historique des achats dans « promotions ».
-- Une annonce est à la une tant que featured_until est dans le futur : aucune tâche planifiée à tenir à jour, la date fait foi.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS featured_until TIMESTAMPTZ;

-- La bande « À la une » ne lit que les annonces encore en cours de mise en avant (index partiel, très petit)
CREATE INDEX IF NOT EXISTS idx_properties_featured ON properties (featured_until) WHERE featured_until IS NOT NULL;

-- provider : simulated (développement seulement) | satim | admin (offert par un administrateur, montant 0)
-- Le paiement n'est jamais rattaché à une carte : on ne garde que le montant, la formule et l'état.
CREATE TABLE IF NOT EXISTS promotions (
  id          SERIAL PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  days        INTEGER NOT NULL CHECK (days > 0),
  amount      NUMERIC NOT NULL CHECK (amount >= 0),
  provider    TEXT NOT NULL CHECK (provider IN ('simulated', 'satim', 'admin')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_promotions_property ON promotions (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotions_owner    ON promotions (owner_id, status);
