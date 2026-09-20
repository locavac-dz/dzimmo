// Démarrage : connexion PostgreSQL, WebSocket, serveur HTTP, tâches planifiées.
// L'application Express elle-même est définie dans server/app.js (testable sans démarrer).
const http     = require('http');
const app      = require('./app');
const db       = require('./db');
const wsModule = require('./ws');

const PORT = process.env.PORT || 3001;

// Production : refuse de démarrer avec un secret JWT d'exemple, une APP_URL locale… (avertit des réglages dégradés)
if (!require('./config-check').reportConfig()) process.exit(1);

db.connect()
  .then(() => {
    const server = http.createServer(app);
    wsModule.setup(server);
    // Notifications temps réel entre workers (pm2 en mode cluster) ; se reconnecte seul si la connexion tombe
    wsModule.listen().catch(e => console.warn('[ws] écoute inter-workers indisponible :', e.message));
    server.listen(PORT, () => {
      console.log(`\n🏢 DzImmo démarré sur http://localhost:${PORT}`);
      console.log(`   API disponible sur http://localhost:${PORT}/api\n`);
      // pm2 en mode cluster lance N workers : les tâches planifiées ne tournent que dans le premier
      // (sinon chaque alerte email partirait N fois). NODE_APP_INSTANCE est absent hors pm2 : une seule instance.
      const instance = process.env.NODE_APP_INSTANCE;
      if (instance === undefined || instance === '0') {
        require('./cron');
        // Annonces antérieures à la détection des doublons : titre et texte normalisés, par lots (sans bloquer le démarrage).
        // Un seul worker s'en charge : lancés partout, ils recalculaient tous les mêmes lots.
        (async () => { while (await require('./quality').backfill() > 0); })().catch(e => console.warn('[qualité] empreintes :', e.message));
      }
    });
  })
  .catch(err => {
    console.error('❌ Connexion PostgreSQL échouée :', err.message);
    process.exit(1);
  });
