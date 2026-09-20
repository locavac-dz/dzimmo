-- Nettoyage des images d'annonces enregistrées avant la validation de server/images.js.
-- Règle identique à celle du serveur : un fichier envoyé sur ce site (/uploads/<nom>.<ext>) ou une adresse https d'un domaine de la
-- liste blanche (images.unsplash.com, photos des annonces de démonstration), 300 caractères au plus. Rien n'est supprimé : une valeur
-- invalide est retirée du champ (image vidée, élément retiré du tableau de photos) ; les annonces elles-mêmes restent intactes.
-- Ne touche ni au statut ni aux dates : ce n'est pas une modification de contenu par l'annonceur.
CREATE OR REPLACE FUNCTION pg_temp.listing_image_ok(v text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT v IS NOT NULL AND length(v) <= 300 AND (
       v ~* '^/uploads/[A-Za-z0-9_.-]+\.(webp|jpe?g|png|gif)$'
    OR v ~  '^https://images\.unsplash\.com/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+$'
  )
$$;

-- Image principale : vidée si invalide
UPDATE properties SET image = ''
 WHERE image IS NOT NULL AND image <> '' AND NOT pg_temp.listing_image_ok(image);

-- Photos : éléments invalides (ou non textuels) retirés du tableau ; un champ qui n'est pas un tableau redevient un tableau vide
UPDATE properties p
   SET photos = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(p.photos) e
                           WHERE jsonb_typeof(e) = 'string' AND pg_temp.listing_image_ok(e #>> '{}')), '[]'::jsonb)
 WHERE jsonb_typeof(p.photos) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.photos) e
                WHERE jsonb_typeof(e) <> 'string' OR NOT pg_temp.listing_image_ok(e #>> '{}'));

UPDATE properties SET photos = '[]'::jsonb WHERE photos IS NOT NULL AND jsonb_typeof(photos) <> 'array';

-- La fonction est propre à la session : on la retire pour que le script reste rejouable sur la même connexion
DROP FUNCTION pg_temp.listing_image_ok(text);
