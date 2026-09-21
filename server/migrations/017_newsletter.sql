-- Newsletter avec double confirmation (server/newsletter.js).
-- Avant : l'inscription ne demandait aucun consentement et rien n'était jamais envoyé. Désormais une adresse n'est
-- destinataire qu'après avoir cliqué le lien reçu par email (confirmed_at), et chaque envoi porte un lien de désinscription.
-- Les inscrits existants n'ont jamais confirmé : confirmed_at reste vide, ils ne reçoivent rien et leur ligne est supprimée
-- par la purge quotidienne des inscriptions non confirmées.
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS lang            text NOT NULL DEFAULT 'fr' CHECK (lang IN ('fr', 'ar'));
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS confirmed_at    timestamptz;
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS confirm_sent_at timestamptz;

-- Un envoi rédigé par un administrateur : une version par langue (au moins une), envoyé aux abonnés confirmés
CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id          serial      PRIMARY KEY,
  subject_fr  text        NOT NULL DEFAULT '',
  body_fr     text        NOT NULL DEFAULT '',
  subject_ar  text        NOT NULL DEFAULT '',
  body_ar     text        NOT NULL DEFAULT '',
  created_by  integer     REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  canceled_at timestamptz
);

-- File d'envoi : une ligne par destinataire. Les workers la vident par lots (réservation FOR UPDATE SKIP LOCKED), sans état en
-- mémoire. La ligne survit à la désinscription (subscriber_id devient NULL : plus aucune donnée personnelle, mais le compte
-- « envoyés » de la campagne reste exact) ; les envois encore en attente d'un désabonné sont supprimés par server/newsletter.js.
CREATE TABLE IF NOT EXISTS newsletter_deliveries (
  id            bigserial   PRIMARY KEY,
  campaign_id   integer     NOT NULL REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  subscriber_id integer     REFERENCES newsletter_subscribers(id) ON DELETE SET NULL,
  attempts      smallint    NOT NULL DEFAULT 0,
  tried_at      timestamptz,
  sent_at       timestamptz,
  UNIQUE (campaign_id, subscriber_id)
);
CREATE INDEX IF NOT EXISTS idx_newsletter_deliveries_pending ON newsletter_deliveries (id) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_newsletter_deliveries_subscriber ON newsletter_deliveries (subscriber_id);
