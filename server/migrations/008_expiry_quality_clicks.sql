-- Confiance et qualité des annonces : reconfirmation périodique, signaux de qualité, clics de contact.

-- ── Expiration ──────────────────────────────────────────────────────────────
-- last_confirmed_at : dernière fois que l'annonceur a confirmé la disponibilité (création, modification, « toujours disponible »).
-- Les annonces existantes reçoivent la date de la migration : elles ne sont pas retirées du jour au lendemain.
-- expiry_notified_at : rappel envoyé (l'annonce sera retirée si rien n'est confirmé dans le délai de grâce).
-- expired_at : annonce retirée automatiquement (statut « archived » + cette date) ; l'annonceur peut la renouveler.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS last_confirmed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE properties ADD COLUMN IF NOT EXISTS expiry_notified_at  TIMESTAMPTZ;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS expired_at          TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_properties_confirm ON properties (last_confirmed_at) WHERE status = 'active';

-- ── Signaux de qualité ──────────────────────────────────────────────────────
-- Table à part (et non des colonnes de properties) : les réponses publiques renvoient properties.*, et les signaux
-- (prix suspect, texte copié) ne doivent être vus que de l'annonceur et des modérateurs.
CREATE TABLE IF NOT EXISTS listing_quality (
  property_id  INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  flags        JSONB NOT NULL DEFAULT '[]',      -- duplicate_own | duplicate_other | price_low | price_high
  details      JSONB NOT NULL DEFAULT '{}',
  title_key    TEXT,                             -- titre normalisé (sans accents, ponctuation ni casse)
  fingerprint  TEXT,                             -- empreinte du texte normalisé de la description (≥ 60 caractères)
  assessed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quality_fingerprint ON listing_quality (fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quality_title_key   ON listing_quality (title_key) WHERE title_key IS NOT NULL;

-- ── Clics de contact ────────────────────────────────────────────────────────
-- Compteurs anonymes par annonce, jour et canal : ni adresse IP ni identifiant de visiteur n'est conservé.
CREATE TABLE IF NOT EXISTS contact_clicks (
  property_id  INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  day          DATE    NOT NULL DEFAULT CURRENT_DATE,
  channel      TEXT    NOT NULL CHECK (channel IN ('call', 'whatsapp')),
  n            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, day, channel)
);
