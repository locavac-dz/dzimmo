-- Correction search_logs.id : SERIAL (int4) → BIGINT pour cohérence avec admin_logs
-- et résistance au dépassement sur un site à fort volume de recherches.
ALTER TABLE search_logs ALTER COLUMN id TYPE BIGINT;
