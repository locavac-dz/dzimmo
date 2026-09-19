require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');
const bcrypt   = require('bcryptjs');

// ── Connexion PostgreSQL ─────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// ── Initialisation du schéma ─────────────────────────────────
async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

// ── Helper : rows → plain objects ────────────────────────────
function rows(r) { return r.rows; }
function row(r)  { return r.rows[0] || null; }

// ── Collection — interface générique ────────────────────────
class Collection {
  constructor(table) { this._t = table; }

  async findOne(pred) {
    if (typeof pred === 'function') {
      const all = await this.find();
      return all.find(pred) || null;
    }
    return null;
  }

  async find(pred) {
    const r = rows(await pool.query(`SELECT * FROM ${this._t} ORDER BY id`));
    return pred ? r.filter(pred) : r;
  }

  async insert(doc) {
    const keys   = Object.keys(doc);
    const vals   = Object.values(doc);
    const cols   = keys.join(', ');
    const params = keys.map((_,i) => `$${i+1}`).join(', ');
    const r = await pool.query(
      `INSERT INTO ${this._t} (${cols}) VALUES (${params}) RETURNING *`, vals
    );
    return row(r);
  }

  async update(pred, changes) {
    if (typeof pred === 'function') {
      const all     = await this.find();
      const targets = all.filter(pred);
      for (const t of targets) {
        const keys = Object.keys(changes);
        const vals = Object.values(changes);
        const sets = keys.map((k,i) => `${k} = $${i+1}`).join(', ');
        await pool.query(`UPDATE ${this._t} SET ${sets} WHERE id = $${keys.length+1}`, [...vals, t.id]);
      }
      return targets.length;
    }
    return 0;
  }

  async delete(pred) {
    if (typeof pred === 'function') {
      const all     = await this.find();
      const targets = all.filter(pred);
      for (const t of targets) {
        await pool.query(`DELETE FROM ${this._t} WHERE id = $1`, [t.id]);
      }
      return targets.length;
    }
    return 0;
  }

  async findById(id) {
    const r = await pool.query(`SELECT * FROM ${this._t} WHERE id = $1`, [id]);
    return r.rows[0] || null;
  }

  async count(pred) {
    if (!pred) {
      const r = await pool.query(`SELECT COUNT(*) FROM ${this._t}`);
      return parseInt(r.rows[0].count);
    }
    const all = await this.find();
    return all.filter(pred).length;
  }
}

// ── Seed données de démonstration ───────────────────────────
const SEED_PROPERTIES = [
  {
    title: 'Appartement F4 vue mer à Alger',
    description: 'Magnifique appartement F4 avec vue imprenable sur la mer, situé dans une résidence sécurisée à Hydra. Cuisine équipée, double vitrage, parking sous-sol inclus.',
    mode: 'vente', type_bien: 'appartement',
    price: 28000000, surface_m2: 110, rooms: 4, baths: 2, floor: 5, total_floors: 10,
    wilaya: 'Alger', commune: 'Hydra', address: 'Résidence Les Cèdres, Hydra',
    lat: 36.7538, lng: 3.0088,
    image: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80',
    features: JSON.stringify(['meuble','parking','balcon','ascenseur','gardien','interphone']),
    status: 'active', views: 245,
  },
  {
    title: 'Villa avec piscine à Oran',
    description: 'Somptueuse villa de standing avec piscine chauffée, jardin paysager, 5 chambres et salon de réception. Idéale pour famille ou investissement locatif premium.',
    mode: 'vente', type_bien: 'villa',
    price: 85000000, surface_m2: 380, rooms: 7, baths: 4, floor: 0, total_floors: 2,
    wilaya: 'Oran', commune: 'Es Senia',
    lat: 35.6324, lng: -0.5981,
    image: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80',
    features: JSON.stringify(['piscine','parking','jardin','gardien','climatisation']),
    status: 'active', views: 189,
  },
  {
    title: 'Local commercial 120m² Annaba',
    description: 'Local commercial idéalement situé en plein centre-ville d\'Annaba, rez-de-chaussée, vitrine sur rue principale, accès facile, fort passage piéton.',
    mode: 'location_longue', type_bien: 'local_commercial',
    price: 180000, surface_m2: 120, rooms: 2, baths: 1, floor: 0, total_floors: 1,
    wilaya: 'Annaba', commune: 'Annaba Centre',
    lat: 36.9000, lng: 7.7667,
    image: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
    features: JSON.stringify(['vitrine','climatisation','alarme']),
    status: 'active', views: 92,
  },
  {
    title: 'Appartement F3 meublé à Constantine',
    description: 'Appartement F3 entièrement meublé et équipé, idéal pour location courte ou longue durée. Quartier calme, proche universités et commerces.',
    mode: 'location_longue', type_bien: 'appartement',
    price: 65000, surface_m2: 85, rooms: 3, baths: 1, floor: 3, total_floors: 6,
    wilaya: 'Constantine', commune: 'Ain Abid',
    lat: 36.3650, lng: 6.6147,
    image: 'https://images.unsplash.com/photo-1555993539-1732b0258235?w=800&q=80',
    features: JSON.stringify(['meuble','wifi','parking','gardien']),
    status: 'active', views: 134,
  },
  {
    title: 'Terrain agricole 2 hectares Blida',
    description: 'Terrain agricole de 2 hectares irrigué, sol fertile, accès route principale, puits artésien, idéal pour exploitation maraîchère ou fruitière.',
    mode: 'vente', type_bien: 'terrain',
    price: 12000000, surface_m2: 20000, rooms: 0, baths: 0, floor: 0, total_floors: 0,
    wilaya: 'Blida', commune: 'Mouzaia',
    lat: 36.4800, lng: 2.6800,
    image: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80',
    features: JSON.stringify(['eau','electricite','route']),
    status: 'active', views: 67,
  },
  {
    title: 'Bureau 60m² résidence standing Alger',
    description: 'Bureau moderne dans une résidence sécurisée à Bab Ezzouar, climatisé, open space ou bureaux séparés, parking visiteurs, idéal TPE / profession libérale.',
    mode: 'location_longue', type_bien: 'bureau',
    price: 120000, surface_m2: 60, rooms: 3, baths: 1, floor: 2, total_floors: 8,
    wilaya: 'Alger', commune: 'Bab Ezzouar',
    lat: 36.7213, lng: 3.1876,
    image: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&q=80',
    features: JSON.stringify(['climatisation','parking','ascenseur','gardien','fibre']),
    status: 'active', views: 78,
  },
];

const SEED_COORDS = [
  { lat: 36.7538, lng: 3.0088 }, { lat: 35.6324, lng: -0.5981 },
  { lat: 36.9000, lng: 7.7667 }, { lat: 36.3650, lng: 6.6147 },
  { lat: 36.4800, lng: 2.6800 }, { lat: 36.7213, lng: 3.1876 },
];

// Données de démonstration (compte demo@dzimmo.dz, agence, annonces) : développement uniquement.
// En production, jamais : ce compte a un mot de passe connu et serait un accès ouvert.
// Pour créer le premier administrateur : s'inscrire sur le site puis `npm run make-admin -- <email>`.
async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.log('ℹ️  Production : données de démonstration ignorées.');
    return;
  }
  const hash = bcrypt.hashSync('demo1234', 10);
  await pool.query(
    `INSERT INTO users (name, email, password, is_agent, is_admin, email_verified)
     VALUES ($1,$2,$3,true,false,true) ON CONFLICT (email) DO NOTHING`,
    ['DzImmo Demo', 'demo@dzimmo.dz', hash]
  );
  const ownerRow = await pool.query(`SELECT id FROM users WHERE email = 'demo@dzimmo.dz'`);
  const ownerId  = ownerRow.rows[0].id;

  // La table agencies n'a pas de contrainte d'unicité : ON CONFLICT ne protégeait de rien et une
  // agence identique était recréée à chaque démarrage. On teste donc l'existence explicitement.
  await pool.query(
    `INSERT INTO agencies (owner_id, name, description, phone, wilaya, verified)
     SELECT $1::int, $2::text, $3::text, $4::text, $5::text, true
      WHERE NOT EXISTS (SELECT 1 FROM agencies WHERE owner_id = $1::int AND name = $2::text)`,
    [ownerId, 'Agence Immobilière Horizon', 'Votre partenaire immobilier de confiance en Algérie depuis 2010.', '+213 21 XX XX XX', 'Alger']
  ).catch(() => {});

  const propCount = await pool.query(`SELECT COUNT(*) FROM properties`);
  if (parseInt(propCount.rows[0].count) === 0) {
    const agencyRow = await pool.query(`SELECT id FROM agencies WHERE owner_id = $1 LIMIT 1`, [ownerId]);
    const agencyId  = agencyRow.rows[0]?.id || null;

    for (let i = 0; i < SEED_PROPERTIES.length; i++) {
      const s = SEED_PROPERTIES[i];
      await pool.query(
        `INSERT INTO properties
          (owner_id, agency_id, title, description, mode, type_bien, price, surface_m2, rooms, baths,
           floor, total_floors, wilaya, commune, address, lat, lng, image, photos, features, status, views)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          ownerId, agencyId, s.title, s.description, s.mode, s.type_bien, s.price,
          s.surface_m2, s.rooms, s.baths, s.floor, s.total_floors,
          s.wilaya, s.commune, s.address || null,
          SEED_COORDS[i].lat, SEED_COORDS[i].lng,
          s.image, JSON.stringify([s.image]),
          s.features, s.status, s.views,
        ]
      );
    }
    console.log('✅ Base de données initialisée avec données de démonstration.');
  }
}

// ── Collections ─────────────────────────────────────────────
const users           = new Collection('users');
const properties      = new Collection('properties');
const agencies        = new Collection('agencies');
const contact_requests = new Collection('contact_requests');
const reviews         = new Collection('reviews');
const messages        = new Collection('messages');
const favorites       = new Collection('favorites');

async function connect() {
  await pool.query('SELECT 1');
  await initSchema();
  const migrate = require('./migrate');
  await migrate(pool);
  await seed();
  console.log('🐘 PostgreSQL connecté');
}

module.exports = { users, properties, agencies, contact_requests, reviews, messages, favorites, connect, pool };
