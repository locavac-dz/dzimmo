-- Vidéo et visite virtuelle d'une annonce (server/videos.js) : liens seulement, enregistrés sous leur forme canonique.
-- La contrainte reprend exactement videos.CANONICAL : une adresse qui n'est pas d'un fournisseur reconnu ne peut pas être stockée,
-- même par une écriture directe en SQL (ces valeurs sont ensuite mises dans un iframe par la page).
ALTER TABLE properties ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS tour_url  TEXT;

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_video_url_check;
ALTER TABLE properties ADD CONSTRAINT properties_video_url_check CHECK (video_url IS NULL OR video_url ~
  '^https://(www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}|vimeo\.com/[0-9]{6,12}(/[0-9a-f]{6,16})?)$');

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_tour_url_check;
ALTER TABLE properties ADD CONSTRAINT properties_tour_url_check CHECK (tour_url IS NULL OR tour_url ~
  '^https://(my\.matterport\.com/show/\?m=[A-Za-z0-9]{11}|kuula\.co/share/((?!collection$)[A-Za-z0-9]{4,12}|collection/[A-Za-z0-9]{4,12}))$');
