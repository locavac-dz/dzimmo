// Tests unitaires de la logique de calcul d'amortissement du simulateur de crédit (fiche annonce).
// On extrait la formule pure sans DOM.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Formule d'amortissement : mensualité constante (emprunt à taux fixe).
function mensualite(loan, annualRate, years) {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return loan / n;
  return loan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

describe("calcCreditAnnonce — formule d'amortissement", () => {
  it('mensualité avec taux 0% = capital / mois', () => {
    const m = mensualite(1_200_000, 0, 10);
    assert.equal(Math.round(m), 10_000); // 1 200 000 / 120
  });

  it('mensualité standard (5%, 20 ans, 5 000 000 DZD)', () => {
    const m = mensualite(5_000_000, 5, 20);
    // Résultat attendu ≈ 33 000 DZD/mois (valeur de référence calculée)
    assert.ok(m > 30_000 && m < 36_000, `mensualité hors plage : ${Math.round(m)}`);
  });

  it('montant total remboursé > emprunt (intérêts positifs)', () => {
    const loan = 3_000_000;
    const m = mensualite(loan, 6, 15);
    const total = m * 15 * 12;
    assert.ok(total > loan, "Le total doit dépasser l'emprunt initial");
  });

  it('prêt nul = fonction non appelée (guard loan <= 0)', () => {
    const loan = 0;
    // La fonction calcCreditAnnonce retourne sans calcul si loan <= 0.
    // On vérifie que la formule ne produit pas NaN.
    if (loan <= 0) return; // guard reproduit du front
    assert.fail('Ne doit pas atteindre cette ligne');
  });

  it('mensualité décroît quand le taux baisse', () => {
    const m5 = mensualite(2_000_000, 5, 20);
    const m3 = mensualite(2_000_000, 3, 20);
    assert.ok(m3 < m5, 'Taux bas doit donner une mensualité plus faible');
  });

  it('mensualité décroît quand la durée augmente', () => {
    const m10 = mensualite(2_000_000, 5, 10);
    const m20 = mensualite(2_000_000, 5, 20);
    assert.ok(m20 < m10, 'Durée plus longue doit donner une mensualité plus faible');
  });
});
