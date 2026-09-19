-- Index des colonnes filtrées par les routes (les requêtes ciblées les utilisent au lieu de lire la table entière).
-- La contrainte UNIQUE (user_id, property_id) des favoris et l'index de users.email (UNIQUE) existent déjà.

CREATE INDEX IF NOT EXISTS idx_properties_owner        ON properties (owner_id);
CREATE INDEX IF NOT EXISTS idx_properties_agency       ON properties (agency_id) WHERE agency_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_properties_search       ON properties (status, mode, type_bien, wilaya);
CREATE INDEX IF NOT EXISTS idx_properties_published    ON properties (published_at DESC) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_contacts_property       ON contact_requests (property_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user           ON contact_requests (user_id);

CREATE INDEX IF NOT EXISTS idx_messages_from           ON messages (from_id);
CREATE INDEX IF NOT EXISTS idx_messages_to_unread      ON messages (to_id) WHERE NOT read;
CREATE INDEX IF NOT EXISTS idx_messages_to             ON messages (to_id);
CREATE INDEX IF NOT EXISTS idx_messages_property       ON messages (property_id);

CREATE INDEX IF NOT EXISTS idx_reviews_property        ON reviews (property_id);
CREATE INDEX IF NOT EXISTS idx_price_history_property  ON price_history (property_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_search_alerts_user      ON search_alerts (user_id);
CREATE INDEX IF NOT EXISTS idx_users_verification      ON users (verification_token) WHERE verification_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agencies_owner          ON agencies (owner_id);
CREATE INDEX IF NOT EXISTS idx_signalements_property   ON signalements (property_id);
