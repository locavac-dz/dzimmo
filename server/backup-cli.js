// Sauvegarde et vérification à la main (le cron de server/cron.js fait la même chose chaque nuit).
//   npm run backup                    → crée une sauvegarde dans BACKUP_DIR (défaut : backups/) et applique la rotation
//   npm run backup:verify             → vérifie la plus récente (restauration dans une base jetable)
//   npm run backup:verify -- <fichier> → vérifie un fichier précis
// Code de sortie 0 si tout va bien, 1 sinon : utilisable dans un script ou une supervision externe.
const { pool } = require('./db');
const backup   = require('./backup');

(async () => {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === 'sauvegarder') {
    const r = await backup.backup();
    console.log(`✅ ${r.file} (${Math.round(r.size / 1024)} Ko) dans ${backup.dir()}`);
    if (r.pruned.length) console.log(`   ${r.pruned.length} ancienne(s) sauvegarde(s) supprimée(s) (on garde ${backup.keep()}).`);
  } else if (cmd === 'verifier') {
    const target = file || (backup.list()[0] || {}).path;
    const v = await backup.verify(target);
    console.log(`✅ ${v.file} : ${v.mode === 'restauration'
      ? `restauré dans une base jetable, ${v.tables} tables, ${v.users} comptes`
      : `archive lisible, ${v.tables} tables (restauration complète impossible sans le droit CREATEDB : voir DEPLOIEMENT.md § 7)`}.`);
  } else {
    console.error('Usage : npm run backup | npm run backup:verify [-- <fichier>]');
    process.exit(1);
  }
})()
  .catch(e => { console.error('❌', e.message); process.exit(1); })
  .finally(() => pool.end());
