require('dotenv').config();
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');

const DB_PATH       = process.env.DB_PATH;
const PORT          = parseInt(process.env.PORT          || '3000',  10);
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '2000',  10);
const MAX_ROWS      = parseInt(process.env.MAX_ROWS      || '15',    10);

// ---------------------------------------------------------------------------
// Username resolution
// ---------------------------------------------------------------------------
const usernameCache = new Map();

async function resolveUsername(discordId) {
  if (!discordId) return 'UNKNOWN';
  const id = String(discordId);
  if (usernameCache.has(id)) return usernameCache.get(id);

  if (!DISCORD_TOKEN) {
    const name = 'USER' + id.slice(-4).padStart(4, '0');
    usernameCache.set(id, name);
    return name;
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/users/${id}`, {
      headers: { Authorization: `Bot ${DISCORD_TOKEN}` },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const raw  = data.global_name || data.username || id;
    const name = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 13) ||
                 ('USER' + id.slice(-4));
    usernameCache.set(id, name);
    return name;
  } catch {
    const name = 'USER' + id.slice(-4).padStart(4, '0');
    usernameCache.set(id, name);
    return name;
  }
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
let db = null;

function openDb() {
  if (!DB_PATH) {
    console.error('[ERROR] DB_PATH is not set in .env');
    return null;
  }
  if (!fs.existsSync(DB_PATH)) {
    console.warn(`[WARN] DB not found at: ${DB_PATH} — will retry next poll`);
    return null;
  }
  try {
    const inst = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    console.log(`[DB] Opened: ${DB_PATH}`);
    return inst;
  } catch (e) {
    console.error(`[ERROR] Failed to open DB: ${e.message}`);
    return null;
  }
}

async function fetchRequests() {
  if (!db) db = openDb();
  if (!db) return [];

  try {
    const rows = db.prepare(`
      SELECT id, type, title, season, status, discord_id
      FROM requests
      WHERE status NOT IN ('COMPLETED', 'TERMINATED', 'UNAVAILABLE')
      ORDER BY id ASC
      LIMIT ?
    `).all(MAX_ROWS);

    return await Promise.all(rows.map(async r => ({
      id:        r.id,
      type:      r.type,
      title:     r.title,
      season:    r.season,
      status:    r.status,
      requester: await resolveUsername(r.discord_id),
    })));
  } catch (e) {
    console.error(`[ERROR] Query failed: ${e.message}`);
    db = null;
    return [];
  }
}

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

const server = http.createServer((req, res) => {
  const urlPath  = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(__dirname, 'public', urlPath);
  const mime     = MIME[path.extname(filePath)] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
const wss     = new WebSocketServer({ server });
const clients = new Set();
let lastMessage  = null;
let lastRowsJson = '';

wss.on('connection', ws => {
  clients.add(ws);
  if (lastMessage) ws.send(lastMessage);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', ()  => clients.delete(ws));
});

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  lastMessage = msg;
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) ws.send(msg);
  }
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------
async function poll() {
  const rows = await fetchRequests();
  const json = JSON.stringify(rows);
  if (json !== lastRowsJson) {
    lastRowsJson = json;
    broadcast({ type: 'update', rows });
    console.log(`[POLL] ${new Date().toLocaleTimeString()} — ${rows.length} active requests — update sent`);
  }
}

server.listen(PORT, () => {
  console.log(`\n  ✈  Split-Flap Display  →  http://localhost:${PORT}\n`);
  poll();
  setInterval(poll, POLL_INTERVAL);
});

process.on('SIGINT', () => {
  if (db) db.close();
  process.exit(0);
});
