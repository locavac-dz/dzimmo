// Tests E2E de fumée : vérifient que les routes essentielles répondent correctement.
// Ces tests nécessitent un serveur en cours d'exécution (voir playwright.config.js).
// Les tests d'API utilisent page.request (pas de vrai rendu navigateur) pour aller vite.
const { test, expect } = require('@playwright/test');

// ── API publique ─────────────────────────────────────────────────────────────

test.describe('API publique', () => {
  test('GET /api/stats/public répond avec des compteurs', async ({ request }) => {
    const res = await request.get('/api/stats/public');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.active).toBe('number');
    expect(typeof body.users).toBe('number');
  });

  test('GET /api/properties renvoie une liste paginée', async ({ request }) => {
    const res = await request.get('/api/properties?limit=5');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  test('GET /api/agencies renvoie une liste', async ({ request }) => {
    const res = await request.get('/api/agencies');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  test('un chemin API inconnu renvoie 404 JSON', async ({ request }) => {
    const res = await request.get('/api/chemin-inexistant-xyz');
    expect(res.status()).toBe(404);
    const ct = res.headers()['content-type'] || '';
    expect(ct).toContain('application/json');
  });

  test('GET /api/captcha renvoie la clé publique Turnstile', async ({ request }) => {
    const res = await request.get('/api/captcha');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.enabled).toBe('boolean');
  });
});

// ── Pages statiques ──────────────────────────────────────────────────────────

test.describe('Pages HTML', () => {
  test('la page d\'accueil se charge avec le titre DzImmo', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/DzImmo/i);
  });

  test('GET / renvoie du HTML avec la balise <title>', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>');
    expect(html).toContain('DzImmo');
  });

  test('GET /404.html renvoie du HTML', async ({ request }) => {
    const res = await request.get('/404.html');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('404');
  });

  test('un chemin inconnu renvoie 404 (vraie 404, pas un repli 200)', async ({ request }) => {
    const res = await request.get('/page-inexistante-xyz-abc');
    expect(res.status()).toBe(404);
  });
});

// ── SEO et sitemap ───────────────────────────────────────────────────────────

test.describe('SEO', () => {
  test('GET /sitemap.xml renvoie un index XML', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] || '';
    expect(ct).toContain('xml');
    const body = await res.text();
    expect(body).toContain('<sitemapindex');
  });

  test('GET /robots.txt renvoie les directives', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('User-agent');
    expect(body).toContain('Sitemap');
  });

  test('GET /vente/appartements/alger renvoie 200 ou 404 (jamais 500)', async ({ request }) => {
    const res = await request.get('/vente/appartements/alger');
    expect([200, 404]).toContain(res.status());
  });
});
