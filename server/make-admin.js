// Donne (ou retire) le rôle administrateur à un compte existant.
//   npm run make-admin -- <email>            → promouvoir
//   npm run make-admin -- <email> --retirer  → retirer le rôle
// Le compte doit d'abord exister : s'inscrire sur le site, puis lancer la commande.
const { pool } = require('./db');

(async () => {
  const [email, flag] = process.argv.slice(2);
  if (!email || email.startsWith('--')) {
    console.error('Usage : npm run make-admin -- <email> [--retirer]');
    process.exit(1);
  }
  const admin = flag !== '--retirer';
  const r = await pool.query(
    'UPDATE users SET is_admin = $1 WHERE lower(email) = lower($2) RETURNING id, name, email, is_admin',
    [admin, email]);
  if (!r.rowCount) {
    console.error(`Aucun compte avec l'email « ${email} ». Inscrivez-vous d'abord sur le site.`);
    process.exit(1);
  }
  const u = r.rows[0];
  console.log(`✅ ${u.name} <${u.email}> (#${u.id}) : ${u.is_admin ? 'administrateur' : 'utilisateur ordinaire'}.`);
  console.log('   Le compte doit se reconnecter pour que le changement soit pris en compte.');
})()
  .catch(e => { console.error('Erreur :', e.message); process.exit(1); })
  .finally(() => pool.end());
