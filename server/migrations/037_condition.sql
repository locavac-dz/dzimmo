-- État du bien : brut, semi_fini, renove, bon_etat, neuf
-- Champ optionnel (NULL = non précisé), inclus dans le texte de recherche

ALTER TABLE properties ADD COLUMN IF NOT EXISTS condition TEXT
  CHECK (condition IN ('brut','semi_fini','renove','bon_etat','neuf'));

-- dz_search_property reçoit un 8e paramètre optionnel (DEFAULT NULL) : l'état du bien.
-- Les appelants existants (dz_reindex_search, graines) n'ont pas à changer.
CREATE OR REPLACE FUNCTION dz_search_property(
  p_title text, p_description text, p_commune text, p_address text,
  p_wilaya text, p_type text, p_mode text, p_condition text DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT dz_norm(concat_ws(' ',
    p_title, p_commune, p_address, p_wilaya,
    dz_lex('wilaya', p_wilaya), dz_lex('type', p_type), dz_lex('mode', p_mode),
    dz_lex('condition', p_condition),
    p_description))
$$;

-- Recalcule tous les textes en passant le nouveau champ condition
CREATE OR REPLACE FUNCTION dz_reindex_search() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO property_search (property_id, text)
    SELECT id, dz_search_property(title, description, commune, address, wilaya, type_bien, mode, condition)
      FROM properties
    ON CONFLICT (property_id) DO UPDATE SET text = EXCLUDED.text;
  INSERT INTO agency_search (agency_id, text)
    SELECT id, dz_search_agency(name, tagline, description, commune, address, wilaya, kind) FROM agencies
    ON CONFLICT (agency_id) DO UPDATE SET text = EXCLUDED.text;
  INSERT INTO project_search (project_id, text)
    SELECT id, dz_search_project(name, description, commune, address, wilaya) FROM projects
    ON CONFLICT (project_id) DO UPDATE SET text = EXCLUDED.text;
END $$;

-- Déclencheur : inclure condition dans les colonnes surveillées
CREATE OR REPLACE FUNCTION dz_trg_property_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO property_search (property_id, text)
    VALUES (NEW.id, dz_search_property(NEW.title, NEW.description, NEW.commune, NEW.address,
                                       NEW.wilaya, NEW.type_bien, NEW.mode, NEW.condition))
    ON CONFLICT (property_id) DO UPDATE SET text = EXCLUDED.text;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_property_search ON properties;
CREATE TRIGGER trg_property_search
  AFTER INSERT OR UPDATE OF title, description, commune, address, wilaya, type_bien, mode, condition
  ON properties FOR EACH ROW EXECUTE FUNCTION dz_trg_property_search();

-- Recalcul des textes existants (search_lexicon aura les nouveaux termes au prochain démarrage)
SELECT dz_reindex_search();
