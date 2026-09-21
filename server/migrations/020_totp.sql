-- Double authentification (TOTP, RFC 6238) — voir server/totp.js et server/two-factor.js.
--   totp_secret       secret chiffré (AES-256-GCM) ; posé dès « Configurer », il ne protège rien tant que totp_enabled_at est nul
--   totp_enabled_at   activation confirmée par un premier code valide
--   totp_last_step    dernier pas de 30 s accepté : un code ne sert qu'une fois (rejeu refusé)
--   totp_recovery     empreintes (HMAC) des codes de secours encore valables : un code de secours ne sert qu'une fois
--   totp_failures / totp_locked_until   essais comptés avant vérification : 5 échecs = verrou de 15 minutes

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step    BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery     TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_failures     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_locked_until TIMESTAMPTZ;
