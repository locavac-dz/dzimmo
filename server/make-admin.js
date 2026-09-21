// Donne (ou retire) le rôle administrateur à un compte existant.
//   npm run make-admin -- <email>              → promouvoir
//   npm run make-admin -- <email> --retirer    → retirer le rôle
//   npm run make-admin -- <email> --reset-2fa  → désactiver la double authentification (téléphone et codes de secours perdus)
// Le compte doit d'abord exister : s'inscrire sur le site, puis lancer la commande.
const { pool } = require('./db');
const { revokeSessions } = require('./sessions');

const FLAGS = ['--retirer', '--reset-2fa'];

(async () => {
  const [email, flag] = process.argv.slice(2);
  if (!email || email.startsWith('--') || (flag && !FLAGS.includes(flag))) {
    console.error('Usage : npm run make-admin -- <email> [--retirer | --reset-2fa]');
    process.exit(1);
  }

  if (flag === '--reset-2fa') {
    const r = await pool.query(
      `UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_recovery = '{}',
                        totp_failures = 0, totp_locked_until = NULL
        WHERE lower(email) = lower($1) RETURNING id, name, email`, [email]);
    if (!r.rowCount) {
      console.error(`Aucun compte avec l'email « ${email} ».`);
      process.exit(1);
    }
    const u = r.rows[0];
    await revokeSessions(u.id);   // qui contrôle le compte a changé : toutes les sessions ouvertes sont fermées
    console.log(`✅ ${u.name} <${u.email}> (#${u.id}) : double authentification désactivée, sessions fermées.`);
    console.log('   À la prochaine connexion, le compte devra la configurer de nouveau (si ADMIN_2FA_REQUIRED est actif).');
    return;
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
