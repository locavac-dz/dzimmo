// ── Supervision : prévenir quand quelque chose casse ─────────────────────────
// Sans ce module, un plantage, une tâche planifiée en échec ou une sauvegarde manquée ne se voyaient que dans les journaux, donc jamais.
// Une alerte part par email à ALERT_EMAIL, sinon CONTACT_EMAIL, sinon aux administrateurs (dans leur langue).
// Anti-inondation : une seule alerte par « nature » de panne (`kind`) et par heure, tous workers pm2 confondus (table alert_throttle,
// réservation atomique en SQL). Base injoignable (cas typique d'une panne) : repli sur un délai en mémoire du processus.
// Aucun détail sensible : le message d'erreur est expurgé des adresses email et des numéros avant d'être écrit ou envoyé.
const db     = require('./db');
const mailer = require('./mailer');

const THROTTLE_MINUTES = 60;
const MAX_ADMIN = 10;
const MAX_DETAIL = 300;

// Repli quand la base ne répond pas : { kind → timestamp du dernier envoi }
const local = new Map();

// Message technique exploitable mais sans donnée personnelle : adresses email, longues suites de chiffres (téléphones, cartes), URL de connexion à la base
function sanitize(err, max = MAX_DETAIL) {
  const raw = err && err.message ? err.message : String(err ?? 'erreur inconnue');
  return raw
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']*/gi, '<url>')
    .replace(/[^\s<>"']+@[^\s<>"']+/g, '<adresse>')
    .replace(/\+?\d[\d ().-]{7,}\d/g, '<numéro>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Vrai si CE processus obtient le droit d'envoyer l'alerte (dernier envoi de ce `kind` plus vieux que la période)
async function reserve(kind) {
  try {
    const r = await db.pool.query(
      `INSERT INTO alert_throttle (kind, last_sent_at) VALUES ($1, NOW())
       ON CONFLICT (kind) DO UPDATE SET last_sent_at = NOW()
         WHERE alert_throttle.last_sent_at < NOW() - make_interval(mins => $2)
       RETURNING kind`, [kind, THROTTLE_MINUTES]);
    return r.rowCount > 0;
  } catch {
    const last = local.get(kind) || 0;
    if (Date.now() - last < THROTTLE_MINUTES * 60000) return false;
    local.set(kind, Date.now());
    return true;
  }
}

async function recipients() {
  for (const v of [process.env.ALERT_EMAIL, process.env.CONTACT_EMAIL]) {
    const to = (v || '').trim();
    if (to && mailer.EMAIL_OK.test(to)) return [{ email: to, lang: 'fr' }];
  }
  try {
    return (await db.pool.query(
      'SELECT email, lang FROM users WHERE is_admin = true AND banned = false ORDER BY id LIMIT $1', [MAX_ADMIN])).rows;
  } catch { return []; }
}

// Envoie l'alerte. `kind` : « famille » ou « famille:nom » (crash, http, cron:sauvegarde…) ; ne lève jamais d'exception
// (une alerte qui échoue ne doit pas aggraver la panne). Renvoie true si au moins un email est parti.
async function alert(kind, err, name) {
  try {
    if (!mailer.configured() || !(await reserve(kind))) return false;
    const detail = sanitize(err);
    const sent = await Promise.all((await recipients()).map(r =>
      mailer.mailAlert({ to: r.email, lang: r.lang, kind, name, detail })));
    return sent.some(Boolean);
  } catch (e) {
    console.error('[monitor] alerte non envoyée :', sanitize(e));
    return false;
  }
}

// Entoure une tâche planifiée : l'erreur est journalisée ET signalée (au lieu de n'apparaître que dans les journaux).
// `family` choisit le titre de l'email (« cron » : tâche planifiée, « backup » : sauvegarde).
const guard = (name, fn, family = 'cron') => async (...args) => {
  try { return await fn(...args); }
  catch (e) {
    console.error(`[cron] Erreur ${name} :`, sanitize(e));
    await alert(`${family}:${name}`, e, name);
  }
};

// Plantage du processus. uncaughtException : on prévient (au plus 5 s) puis on sort, pm2 relance un worker sain.
// unhandledRejection : on prévient et on continue (le worker reste utilisable, la requête concernée a déjà reçu sa réponse d'erreur).
let installed = false;
function installProcessHandlers() {
  if (installed) return;
  installed = true;
  process.on('uncaughtException', async e => {
    console.error('[crash] exception non gérée :', e && e.stack ? sanitize(e.stack, 2000) : sanitize(e));
    await Promise.race([alert('crash', e), new Promise(r => setTimeout(r, 5000))]);
    process.exit(1);
  });
  process.on('unhandledRejection', e => {
    console.error('[crash] promesse rejetée non gérée :', sanitize(e));
    alert('crash:rejection', e);
  });
}

module.exports = { alert, guard, sanitize, installProcessHandlers, THROTTLE_MINUTES };
