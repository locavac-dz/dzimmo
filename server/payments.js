// Paiement en ligne des mises à la une. Un seul point d'entrée par fournisseur : le reste du code (server/featured.js,
// routes/promotions.js) ne sait pas comment on paie, seulement si le paiement est « simulé » ou « en ligne ».
//
//   simulated : développement et tests seulement (aucun argent) ; l'annonceur confirme dans le navigateur.
//   satim     : à raccorder quand le contrat SATIM sera signé (CIB / Edahabia : enregistrement de la commande, redirection vers la
//               page de paiement, retour vérifié côté serveur). Tant que ce n'est pas fait, il est refusé en production par
//               server/config-check.js et checkout() lève une erreur : on ne prétend jamais avoir encaissé.

function provider(env = process.env) {
  const v = String(env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  if (v) return v;
  return env.NODE_ENV === 'production' ? 'satim' : 'simulated';
}

// Le mode simulé n'existe jamais en production, quoi que dise la configuration
function simulated(env = process.env) {
  return provider(env) === 'simulated' && env.NODE_ENV !== 'production';
}

// Prépare le paiement d'une promotion en attente. Renvoie { simulated: true } ou { redirect: 'https://…' }.
async function checkout(promotion, env = process.env) {
  if (simulated(env)) return { simulated: true };
  throw new Error('Paiement en ligne non raccordé (SATIM).');
}

module.exports = { provider, simulated, checkout };
