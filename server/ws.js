const { WebSocketServer } = require('ws');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

// Notifications temps réel. Sous pm2 en mode cluster, chaque worker ne connaît que ses propres connexions : la
// requête qui déclenche une notification et la connexion WebSocket du destinataire tombent le plus souvent dans
// des workers différents. Chaque worker écoute donc un canal PostgreSQL (LISTEN) ; send() y publie (pg_notify)
// et chaque worker remet le message à ses connexions locales. Sans écoute active (tests, panne de la connexion
// d'écoute), send() remet directement aux connexions du worker courant.

const CHANNEL = 'dz_ws';
const MAX_NOTIFY_BYTES = 7500; // PostgreSQL limite une notification à 8000 octets

function createHub({ getPool = () => require('./db').pool, channel = CHANNEL, retryMs = 2000 } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(channel)) throw new Error(`Nom de canal invalide : ${channel}`);
  const clients = new Map();      // userId → Set de connexions WebSocket de ce worker
  let listener = null, listening = false, stopped = false, timer = null;

  // Enregistre une connexion ; renvoie la fonction qui la retire
  function add(userId, ws) {
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(ws);
    return () => {
      const s = clients.get(userId);
      if (s) { s.delete(ws); if (!s.size) clients.delete(userId); }
    };
  }

  function deliverLocal(userId, data) {
    const conns = clients.get(Number(userId));
    if (!conns || !conns.size) return;
    const payload = JSON.stringify(data);
    conns.forEach(ws => { try { if (ws.readyState === 1) ws.send(payload); } catch {} });
  }

  function send(userId, data) {
    const payload = JSON.stringify({ userId: Number(userId), data });
    if (listening && Buffer.byteLength(payload) <= MAX_NOTIFY_BYTES) {
      getPool().query('SELECT pg_notify($1, $2)', [channel, payload]).catch(() => deliverLocal(userId, data));
      return;
    }
    deliverLocal(userId, data);
  }

  function retryLater() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => listen().catch(() => {}), retryMs);
    timer.unref?.();
  }

  // Ouvre la connexion d'écoute (dédiée, hors du pool) ; se reconnecte seule si elle tombe
  async function listen() {
    stopped = false;
    const client = new Client(getPool().options);
    const lost = () => {
      if (listener !== client) return;
      listener = null; listening = false;
      retryLater();
    };
    client.on('error', lost);
    client.on('end', lost);
    client.on('notification', m => {
      try { const { userId, data } = JSON.parse(m.payload); deliverLocal(userId, data); } catch { /* message illisible */ }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${channel}`);
    } catch (e) {
      client.removeAllListeners('error'); client.on('error', () => {});
      client.end().catch(() => {});
      retryLater();
      throw e;
    }
    listener = client; listening = true;
  }

  async function close() {
    stopped = true; listening = false;
    clearTimeout(timer);
    const c = listener; listener = null;
    if (c) await c.end().catch(() => {});
  }

  return { add, send, deliverLocal, listen, close, isListening: () => listening };
}

const hub = createHub();

function setup(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    let userId = null;
    try {
      const url   = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (token) {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        userId = payload.id;
      }
    } catch {}

    if (!userId) { ws.close(4001, 'Unauthorized'); return; }

    const remove = hub.add(userId, ws);
    ws.on('close', remove);
    ws.on('error', () => {});
  });
}

module.exports = { setup, send: hub.send, listen: hub.listen, close: hub.close, createHub };
