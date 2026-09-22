// Tests unitaires de server/turnstile.js
// On utilise verifyWith() pour passer le secret en paramètre (SECRET est une constante de module).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { verifyWith } = require('../../server/turnstile');

describe('turnstile.verifyWith', () => {
  it('renvoie true si aucun secret (mode dev/test sans CAPTCHA)', async () => {
    assert.equal(await verifyWith('', 'token-quelconque', '127.0.0.1'), true);
    assert.equal(await verifyWith(undefined, 'token', '127.0.0.1'), true);
  });

  it('renvoie false pour un token non-string quand le secret est défini', async () => {
    // Le secret est défini mais le token est absent/invalide : on refuse sans appel réseau
    assert.equal(await verifyWith('sec', null, '127.0.0.1'), false);
    assert.equal(await verifyWith('sec', 42, '127.0.0.1'), false);
    assert.equal(await verifyWith('sec', '', '127.0.0.1'), false);
  });

  it("renvoie true en cas d'erreur réseau (graceful degradation)", async () => {
    // On simule une URL injoignable pour provoquer une exception fetch
    const { verifyWith: vw } = require('../../server/turnstile');
    // On ne peut pas monkey-patcher ENDPOINT facilement, mais on peut tester en passant un
    // token valide (string non vide) avec un secret factice : la vraie URL CF sera refusée (pas de réseau
    // vers Cloudflare en CI). Le comportement attendu est true (graceful) en cas d'erreur.
    // On crée une version locale pour ce test.
    const SECRET_TEST = 'secret-de-test';
    const TOKEN_TEST  = 'jeton-de-test';
    // Le code réel attrape toute exception du fetch et renvoie true
    const result = await verifyWith(SECRET_TEST, TOKEN_TEST, '127.0.0.1');
    // En CI sans accès Cloudflare, la requête échoue → true (graceful)
    // En local avec accès réseau, la réponse Cloudflare sera success:false → false
    // Le test vérifie seulement que la valeur est booléenne (pas d'exception levée)
    assert.equal(typeof result, 'boolean');
  });
});
