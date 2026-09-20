-- Nettoyage des avatars enregistrés avant la validation (PUT /api/auth/profile acceptait une chaîne quelconque).
-- Règle identique à celle de server/images.js : un fichier envoyé sur ce site (/uploads/<nom>.<ext>, 300 caractères au plus) ou la photo
-- d'un compte Google servie par Google (lh0…lh9.googleusercontent.com, 500 caractères au plus). Une valeur invalide est retirée (NULL) ;
-- le compte lui-même n'est pas touché.
UPDATE users SET avatar = NULL
 WHERE avatar IS NOT NULL
   AND NOT (
        (length(avatar) <= 300 AND avatar ~* '^/uploads/[A-Za-z0-9_.-]+\.(webp|jpe?g|png|gif)$')
     OR (length(avatar) <= 500 AND avatar ~  '^https://lh[0-9]\.googleusercontent\.com/[A-Za-z0-9._~/=-]+$')
   );
