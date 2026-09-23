-- Migration 031 : partage de liste de favoris
-- Un jeton par compte, généré à la demande ; l'effacer invalide l'ancien lien.
ALTER TABLE users ADD COLUMN IF NOT EXISTS favorites_share_token VARCHAR(64) UNIQUE;
