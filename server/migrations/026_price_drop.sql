-- Alerte de baisse de prix des favoris (server/price-drop.js).
-- Choix du membre : les alertes sont actives par défaut, il les coupe depuis son profil.
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_price_drop BOOLEAN NOT NULL DEFAULT true;
-- Réservation atomique d'une alerte par annonce (délai entre deux alertes) : commune à tous les workers, aucun état en mémoire.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS price_drop_notified_at TIMESTAMPTZ;
-- (idx_favorites_property, migration 023, sert la recherche des membres qui suivent l'annonce ; idx_price_history_property, migration 003, l'historique.)
