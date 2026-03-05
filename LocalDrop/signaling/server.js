'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT         = parseInt(process.env.PORT) || 8080;
const RATE_LIMIT   = 20;          // max new WS connections per IP per minute
const RATE_WINDOW  = 60_000;      // 1 minute window
const ROOM_TIMEOUT = 10 * 60_000; // clean up rooms with 1 idle peer after 10 min

const rooms      = new Map(); // roomId -> Map<ws, role>
const roomTimers = new Map(); // roomId -> expiry timer
const ipRates    = new Map(); // ip -> { count, resetAt }

// ─── Rate limiting ────────────────────────────────────────────────────────────
function getIP(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .split(',')[0].trim();
}

function isRateLimited(ip) {
  const now   = Date.now();
  const entry = ipRates.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW; }
  entry.count++;
  ipRates.set(ip, entry);
  return entry.count > RATE_LIMIT;
}

// Purge stale IP entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of ipRates) if (now > e.resetAt) ipRates.delete(ip);
}, RATE_WINDOW);

// ─── HTTP (health check) ──────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('LocalDrop Signaling OK\n');
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer, maxPayload: 262144 });

wss.on('connection', (ws, req) => {
  const ip   = getIP(req);
  const url  = new URL(req.url, 'http://x');
  const room = (url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

  if (!room) return ws.close(1008, 'No room');

  if (isRateLimited(ip)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Too many connections — slow down' }));
    return ws.close(1008, 'Rate limited');
  }

  if (!rooms.has(room)) rooms.set(room, new Map());
  const peers = rooms.get(room);

  if (peers.size >= 2) {
    ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
    return ws.close(1008, 'Room full');
  }

  // Cancel the idle-room timer when the second peer arrives
  if (peers.size === 1) {
    clearTimeout(roomTimers.get(room));
    roomTimers.delete(room);
  }

  const role = peers.size === 0 ? 'host' : 'guest';
  peers.set(ws, role);
  ws._room = room;

  ws.send(JSON.stringify({ type: 'joined', role, peers: peers.size }));

  // Notify host when guest arrives
  if (role === 'guest') {
    for (const [peer, r] of peers) {
      if (r === 'host' && peer.readyState === 1) {
        peer.send(JSON.stringify({ type: 'peer-joined' }));
        break;
      }
    }
  }

  // Start idle timer: if the host is still alone after ROOM_TIMEOUT, close the room
  if (role === 'host') {
    const t = setTimeout(() => {
      if (rooms.get(room)?.size === 1) {
        ws.close(1001, 'Room idle timeout');
        rooms.delete(room);
        roomTimers.delete(room);
      }
    }, ROOM_TIMEOUT);
    roomTimers.set(room, t);
  }

  ws.on('message', (data) => {
    // Relay raw bytes to the other peer (offer / answer / ICE)
    for (const [peer] of peers) {
      if (peer !== ws && peer.readyState === 1) peer.send(data);
    }
  });

  ws.on('close', () => {
    peers.delete(ws);
    if (peers.size === 0) {
      clearTimeout(roomTimers.get(room));
      roomTimers.delete(room);
      rooms.delete(room);
    } else {
      for (const [peer] of peers) {
        if (peer.readyState === 1) peer.send(JSON.stringify({ type: 'peer-left' }));
      }
    }
  });

  ws.on('error', () => {});
});

httpServer.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
