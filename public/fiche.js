// Fiche imprimable (server/fiche.js) : le bouton ouvre la fenêtre d'impression du navigateur (le projet n'admet aucun script en ligne).
document.getElementById('fiche-print')?.addEventListener('click', () => window.print());
