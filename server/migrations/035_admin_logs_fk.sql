-- Correction admin_logs.admin_id : nullable + ON DELETE SET NULL
-- pour permettre la suppression d'un admin tout en conservant la trace d'audit.
ALTER TABLE admin_logs ALTER COLUMN admin_id DROP NOT NULL;
ALTER TABLE admin_logs DROP CONSTRAINT IF EXISTS admin_logs_admin_id_fkey;
ALTER TABLE admin_logs ADD CONSTRAINT admin_logs_admin_id_fkey
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL;
