// Démarrage : connexion PostgreSQL, WebSocket, serveur HTTP, tâches planifiées.
// L'application Express elle-même est définie dans server/app.js (testable sans démarrer).
const http     = require('http');
const app      = require('./app');
const db       = require('./db');
const wsModule = require('./ws');

const PORT = process.env.PORT || 3001;

db.connect()
  .then(() => {
    const server = http.createServer(app);
    wsModule.setup(server);
    server.listen(PORT, () => {
      console.log(`\n🏢 DzImmo démarré sur http://localhost:${PORT}`);
      console.log(`   API disponible sur http://localhost:${PORT}/api\n`);
      require('./cron');
    });
  })
  .catch(err => {
    console.error('❌ Connexion PostgreSQL échouée :', err.message);
    process.exit(1);
  });
