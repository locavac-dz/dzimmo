-- Programmes neufs des promoteurs : un programme regroupe des lots (annonces) et affiche l'avancement de la construction.
-- Prix « à partir de », lots disponibles et vendus se calculent depuis les annonces rattachées (jamais saisis à la main).
CREATE TABLE IF NOT EXISTS projects (
  id               SERIAL PRIMARY KEY,
  agency_id        INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  wilaya           TEXT NOT NULL,
  commune          TEXT,
  address          TEXT,
  status           TEXT NOT NULL DEFAULT 'en_construction' CHECK (status IN ('sur_plan', 'en_construction', 'livre')),
  delivery_year    INTEGER,
  delivery_quarter INTEGER CHECK (delivery_quarter BETWEEN 1 AND 4),
  total_units      INTEGER,
  image            TEXT,
  photos           JSONB NOT NULL DEFAULT '[]',
  features         JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_agency ON projects (agency_id);
CREATE INDEX IF NOT EXISTS idx_projects_wilaya ON projects (wilaya);

ALTER TABLE properties ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_properties_project ON properties (project_id) WHERE project_id IS NOT NULL;
