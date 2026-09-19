-- Langue préférée de chaque compte (fr | ar) : dernière langue utilisée sur le site.
-- Sert à rédiger emails et notifications dans la langue du destinataire.
ALTER TABLE users ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'fr';
