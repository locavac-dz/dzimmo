-- Recherche tolérante (accents, arabe, français ↔ arabe) : voir server/search.js.
-- Fichier GÉNÉRÉ par un script à partir de normalize() (tables de correspondance) : dz_norm() doit rester identique à normalize(),
-- ce que tests/api/search.test.js vérifie caractère par caractère. Aucune extension PostgreSQL requise.

-- Lexique français ↔ arabe (wilayas, types de biens, modes, types de professionnels), aligné sur server/search.js au démarrage
CREATE TABLE IF NOT EXISTS search_lexicon (
  kind  TEXT NOT NULL,
  key   TEXT NOT NULL,
  terms TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);

-- Textes de recherche normalisés : des tables à part, pour ne rien ajouter aux réponses de l'API (SELECT p.*)
CREATE TABLE IF NOT EXISTS property_search (property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agency_search   (agency_id   INTEGER PRIMARY KEY REFERENCES agencies(id)   ON DELETE CASCADE, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_search  (project_id  INTEGER PRIMARY KEY REFERENCES projects(id)   ON DELETE CASCADE, text TEXT NOT NULL);

-- Normalisation : minuscules sans accents, lettres arabes unifiées, tachkil et tatwil retirés, chiffres indo-arabes en chiffres,
-- tout le reste (ponctuation, tirets, apostrophes) en espace. Miroir exact de normalize() dans server/search.js.
CREATE OR REPLACE FUNCTION dz_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             lower(translate(
               replace(replace(replace(replace(replace(replace(coalesce(t, ''), 'æ', 'ae'), 'Æ', 'ae'), 'œ', 'oe'), 'Œ', 'oe'), 'ß', 'ss'), 'ẞ', 'ss'),
               'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝàáâãäåçèéêëìíîïðñòóôõöøùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİıĴĵĶķĹĺĻļĽľŁłŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻǾǿȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳأإآٱىةؤئکی٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
               'aaaaaaceeeeiiiidnoooooouuuuyaaaaaaceeeeiiiidnoooooouuuuyyaaaaaaccccccccddddeeeeeeeeeegggggggghhiiiiiiiiiijjkkllllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzzoouuaaiioouuuuuuuuuuaaaaggkkoooojggnnaaooaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyyاااايهويكي01234567890123456789')),
             '[\u0300-\u036F\u064B-\u065F\u0670\u0640]', '', 'g'),
           '[^a-z0-9\u0621-\u064A]+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION dz_lex(p_kind text, p_key text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT terms FROM search_lexicon WHERE kind = p_kind AND key = p_key), '')
$$;

-- Ce qui se cherche : titre, commune, adresse, wilaya (français et arabe), type de bien et mode (français et arabe), description
CREATE OR REPLACE FUNCTION dz_search_property(p_title text, p_description text, p_commune text, p_address text, p_wilaya text, p_type text, p_mode text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT dz_norm(concat_ws(' ', p_title, p_commune, p_address, p_wilaya, dz_lex('wilaya', p_wilaya), dz_lex('type', p_type), dz_lex('mode', p_mode), p_description))
$$;
CREATE OR REPLACE FUNCTION dz_search_agency(p_name text, p_tagline text, p_description text, p_commune text, p_address text, p_wilaya text, p_kind text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT dz_norm(concat_ws(' ', p_name, p_tagline, p_commune, p_address, p_wilaya, dz_lex('wilaya', p_wilaya), dz_lex('kind', p_kind), p_description))
$$;
CREATE OR REPLACE FUNCTION dz_search_project(p_name text, p_description text, p_commune text, p_address text, p_wilaya text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT dz_norm(concat_ws(' ', p_name, p_commune, p_address, p_wilaya, dz_lex('wilaya', p_wilaya), dz_lex('kind', 'promoteur'), p_description))
$$;

-- Recalcule tous les textes (migration, changement du lexique)
CREATE OR REPLACE FUNCTION dz_reindex_search() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO property_search (property_id, text)
    SELECT id, dz_search_property(title, description, commune, address, wilaya, type_bien, mode) FROM properties
    ON CONFLICT (property_id) DO UPDATE SET text = EXCLUDED.text;
  INSERT INTO agency_search (agency_id, text)
    SELECT id, dz_search_agency(name, tagline, description, commune, address, wilaya, kind) FROM agencies
    ON CONFLICT (agency_id) DO UPDATE SET text = EXCLUDED.text;
  INSERT INTO project_search (project_id, text)
    SELECT id, dz_search_project(name, description, commune, address, wilaya) FROM projects
    ON CONFLICT (project_id) DO UPDATE SET text = EXCLUDED.text;
END $$;

-- Déclencheurs : le texte de recherche suit chaque création et modification, quelle que soit l'origine (API, SQL, seed, scripts)
CREATE OR REPLACE FUNCTION dz_trg_property_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO property_search (property_id, text)
    VALUES (NEW.id, dz_search_property(NEW.title, NEW.description, NEW.commune, NEW.address, NEW.wilaya, NEW.type_bien, NEW.mode))
    ON CONFLICT (property_id) DO UPDATE SET text = EXCLUDED.text;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_property_search ON properties;
CREATE TRIGGER trg_property_search AFTER INSERT OR UPDATE OF title, description, commune, address, wilaya, type_bien, mode ON properties
  FOR EACH ROW EXECUTE FUNCTION dz_trg_property_search();

CREATE OR REPLACE FUNCTION dz_trg_agency_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO agency_search (agency_id, text)
    VALUES (NEW.id, dz_search_agency(NEW.name, NEW.tagline, NEW.description, NEW.commune, NEW.address, NEW.wilaya, NEW.kind))
    ON CONFLICT (agency_id) DO UPDATE SET text = EXCLUDED.text;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_agency_search ON agencies;
CREATE TRIGGER trg_agency_search AFTER INSERT OR UPDATE OF name, tagline, description, commune, address, wilaya, kind ON agencies
  FOR EACH ROW EXECUTE FUNCTION dz_trg_agency_search();

CREATE OR REPLACE FUNCTION dz_trg_project_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO project_search (project_id, text)
    VALUES (NEW.id, dz_search_project(NEW.name, NEW.description, NEW.commune, NEW.address, NEW.wilaya))
    ON CONFLICT (project_id) DO UPDATE SET text = EXCLUDED.text;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_project_search ON projects;
CREATE TRIGGER trg_project_search AFTER INSERT OR UPDATE OF name, description, commune, address, wilaya ON projects
  FOR EACH ROW EXECUTE FUNCTION dz_trg_project_search();

-- Textes des annonces, agences et programmes existants (le lexique arabe est ajouté au démarrage par search.sync, qui recalcule alors)
SELECT dz_reindex_search();
