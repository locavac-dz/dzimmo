-- Connexion avec Google : identifiant Google (« sub », unique et stable, contrairement à l'adresse email) rattaché au compte.

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_id ON users (google_id) WHERE google_id IS NOT NULL;
