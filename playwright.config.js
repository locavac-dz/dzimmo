// Configuration Playwright pour les tests E2E de fumée.
// Les tests tournent contre le serveur local (port 3001).
// En CI, webServer démarre le serveur ; en local, reuseExistingServer permet de réutiliser
// le serveur déjà lancé (npm run dev).
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: `http://localhost:${process.env.PORT || 3001}`,
    headless: true,
    locale: 'fr-DZ',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'node server/index.js',
    url: `http://localhost:${process.env.PORT || 3001}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
