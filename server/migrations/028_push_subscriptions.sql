-- Abonnements Web Push (notifications push navigateur) par utilisateur et endpoint.
-- Un même endpoint ne peut appartenir qu'à un seul abonné (UNIQUE sur endpoint).
-- Nettoyé automatiquement lors d'une erreur 404/410 renvoyée par le serveur push.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
