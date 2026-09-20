-- Mot de passe oublié : plafond d'emails par compte et par heure (COUNT sur user_id et created_at).
CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens (user_id, created_at DESC);
