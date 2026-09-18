require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('express-async-errors');

const express     = require('express');
const http        = require('http');
const cors        = require('cors');
const path        = require('path');
const rateLimit   = require('express-rate-limit');
const compression = require('compression');
const db          = require('./db');
const wsModule    = require('./ws');

const app = express();
app.use(compression());

// ── CORS ────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3001')
  .split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origine non autorisée — ' + origin));
  },
  credentials: true,
}));

// ── Rate limiting ────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop d'uploads. Réessayez dans 1 heure." },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api/upload', uploadLimiter);

app.use(express.json());

// Service Worker sans cache pour détecter les mises à jour
app.get('/sw.js', (_, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth',       require('./routes/auth'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/contacts',   require('./routes/contacts'));
app.use('/api/messages',   require('./routes/messages'));
app.use('/api/upload',     require('./routes/upload'));
app.use('/api/agencies',   require('./routes/agencies'));
app.use('/api/favorites',  require('./routes/favorites'));
app.use('/api/stats',      require('./routes/stats'));
app.use('/api/admin',      require('./routes/admin'));
app.use('/api/newsletter', require('./routes/newsletter'));

app.get('/api/health', (_, res) => res.json({ ok: true, message: 'DzImmo API opérationnelle 🇩🇿' }));
app.get('/404', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', '404.html')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[Erreur]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur.' });
});

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
