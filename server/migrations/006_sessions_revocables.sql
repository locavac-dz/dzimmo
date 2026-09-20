-- Sessions révocables : tout jeton de session émis avant cette date est refusé (voir server/sessions.js).
-- Posée quand un compte change de mains ou que son mot de passe est réinitialisé : un intrus qui détient encore un jeton
-- (valable 7 jours) perd son accès tout de suite.

ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMPTZ;
