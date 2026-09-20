// Application Express (sans démarrage) : importée par server/index.js et par les tests.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('express-async-errors');

const express     = require('express');
const cors        = require('cors');
const path        = require('path');
const rateLimit   = require('express-rate-limit');
const compression = require('compression');
const helmet      = require('helmet');

const app = express();

// ── Reverse proxy (Nginx) ───────────────────────────────────────
// TRUST_PROXY = nombre de proxys de confiance devant l'app (1 pour Nginx).
// Absent ou 0 en local : on ne fait pas confiance à X-Forwarded-For (sinon
// un client direct pourrait usurper son IP et contourner les rate limits).
const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY && TRUST_PROXY !== '0' && TRUST_PROXY !== 'false') {
  app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
}

// ── En-têtes de sécurité (helmet) ───────────────────────────────
// Le front est une SPA sans étape de build : scripts et gestionnaires d'événements (onclick="…")
// sont en ligne, d'où 'unsafe-inline'. Le reste de la politique reste restrictif : scripts et
// styles externes limités à cdnjs (Leaflet), images https (photos, tuiles OpenStreetMap),
// aucun objet / iframe étranger, WebSocket vers notre propre origine uniquement.
const isProd = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr:  ["'unsafe-inline'"],
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      imgSrc:         ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc:        ["'self'", 'data:'],
      connectSrc:     ["'self'"],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      frameAncestors: ["'self'"],
      // Réécrit http:// en https:// : uniquement en production (casserait localhost en http)
      ...(isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  // Les photos /uploads doivent pouvoir être affichées ailleurs (aperçus WhatsApp / Facebook)
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // OpenStreetMap exige un Referer pour ses tuiles : on garde le comportement standard des navigateurs
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // HSTS seulement en production (HTTPS derrière Nginx)
  ...(isProd ? {} : { strictTransportSecurity: false }),
}));

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

// ── Langue des messages d'erreur de l'API (X-Lang / Accept-Language) ──
app.use('/api', require('./i18n').middleware);

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

const publicStatsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans une minute.' },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api/stats/public', publicStatsLimiter);

app.use(express.json());

// Service Worker sans cache pour détecter les mises à jour
app.get('/sw.js', (_, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});
// SEO : /, /annonce/:id-slug, sitemap.xml, robots.txt (avant les fichiers statiques)
require('./seo').mount(app);
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
app.use('/api/alerts',    require('./routes/alerts'));

app.get('/api/health', (_, res) => res.json({ ok: true, message: 'DzImmo API opérationnelle 🇩🇿' }));

// Chemins inconnus : vraie 404 (et non la SPA en 200, que les moteurs de recherche prendraient pour une page valide).
// Les pages du site sont servies plus haut : accueil et /annonce/… par seo.js, fichiers par express.static.
const page404 = (_, res) => res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
app.use('/api', (_, res) => res.status(404).json({ error: 'Route introuvable.' }));
app.get('/404', page404);
app.use(page404);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[Erreur]', err.message);
  const status = err.status || 500;
  // Erreurs techniques d'Express / body-parser : message français stable (traduisible), pas l'anglais du module
  const TECHNIQUES = { 'entity.parse.failed': 'Requête invalide (JSON mal formé).', 'entity.too.large': 'Requête trop volumineuse.' };
  const msg = TECHNIQUES[err.type] || (status < 500 ? err.message : 'Erreur interne du serveur.');
  res.status(status).json({ error: msg });
});

module.exports = app;
