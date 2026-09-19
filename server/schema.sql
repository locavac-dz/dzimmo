-- Schéma DzImmo — tables fondamentales.
-- Les évolutions sont dans server/migrations/.

CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  email               TEXT UNIQUE NOT NULL,
  password            TEXT NOT NULL,
  phone               TEXT,
  bio                 TEXT,
  avatar              TEXT,
  is_agent            BOOLEAN DEFAULT false,
  is_admin            BOOLEAN DEFAULT false,
  email_verified      BOOLEAN DEFAULT false,
  verification_token  TEXT,
  banned              BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agencies (
  id          SERIAL PRIMARY KEY,
  owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  phone       TEXT,
  address     TEXT,
  wilaya      TEXT,
  logo        TEXT,
  website     TEXT,
  verified    BOOLEAN DEFAULT false,
  rating      NUMERIC DEFAULT 0,
  reviews     INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS properties (
  id              SERIAL PRIMARY KEY,
  owner_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  agency_id       INTEGER REFERENCES agencies(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  mode            TEXT NOT NULL,   -- vente | location_longue | location_courte
  type_bien       TEXT NOT NULL,   -- appartement | villa | maison | bureau | local_commercial | terrain | ferme | entrepot
  price           NUMERIC NOT NULL,
  surface_m2      NUMERIC,
  rooms           INTEGER,
  baths           INTEGER,
  floor           INTEGER,
  total_floors    INTEGER,
  wilaya          TEXT NOT NULL,
  commune         TEXT,
  address         TEXT,
  lat             NUMERIC,
  lng             NUMERIC,
  image           TEXT,
  photos          JSONB DEFAULT '[]',
  features        JSONB DEFAULT '[]',  -- ['meuble','parking','balcon','ascenseur',...]
  status          TEXT DEFAULT 'active',  -- active | sold | rented | archived
  verified        BOOLEAN DEFAULT false,
  rating          NUMERIC DEFAULT 0,
  reviews         INTEGER DEFAULT 0,
  views           INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_requests (
  id            SERIAL PRIMARY KEY,
  property_id   INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT DEFAULT 'info',  -- visite | info | offre
  message       TEXT,
  visit_date    DATE,
  offer_amount  NUMERIC,
  status        TEXT DEFAULT 'pending',  -- pending | confirmed | rejected | done
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id                  SERIAL PRIMARY KEY,
  property_id         INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  agency_id           INTEGER REFERENCES agencies(id) ON DELETE CASCADE,
  author_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
  contact_request_id  INTEGER REFERENCES contact_requests(id) ON DELETE SET NULL,
  rating              NUMERIC NOT NULL,
  comment             TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorites (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, property_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id           SERIAL PRIMARY KEY,
  from_id      INTEGER REFERENCES users(id),
  to_id        INTEGER REFERENCES users(id),
  property_id  INTEGER,
  body         TEXT,
  read         BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id         SERIAL PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signalements (
  id          SERIAL PRIMARY KEY,
  property_id INTEGER,
  user_id     INTEGER,
  motif       TEXT,
  message     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_alerts (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  wilaya      TEXT,
  mode        TEXT,
  type_bien   TEXT,
  min_price   NUMERIC,
  max_price   NUMERIC,
  min_surface NUMERIC,
  last_sent   TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
