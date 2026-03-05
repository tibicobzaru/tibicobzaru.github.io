'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT) || 8080;
const rooms = new Map(); // roomId -> Map<ws, role>

// HTTP server — handles health checks + WS upgrades
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
  });
  res.end('LocalDrop Signaling OK\n');
});

const wss = new WebSocketServer({ server: httpServer, maxPayload: 262144 });

wss.on('connection', (ws, req) => {
  const url  = new URL(req.url, 'http://x');
  const room = (url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

  if (!room) return ws.close(1008, 'No room');

  if (!rooms.has(room)) rooms.set(room, new Map());
  const peers = rooms.get(room);

  if (peers.size >= 2) {
    ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
    return ws.close(1008, 'Room full');
  }

  const role = peers.size === 0 ? 'host' : 'guest';
  peers.set(ws, role);
  ws._room = room;

  console.log(`[${room}] ${role} joined (${peers.size}/2)`);

  ws.send(JSON.stringify({ type: 'joined', role, peers: peers.size }));

  // Tell host when guest arrives
  if (role === 'guest') {
    for (const [peer, r] of peers) {
      if (r === 'host' && peer.readyState === 1) {
        peer.send(JSON.stringify({ type: 'peer-joined' }));
        break;
      }
    }
  }

  ws.on('message', (data) => {
    // Relay raw to the other peer (offer/answer/ice)
    for (const [peer] of peers) {
      if (peer !== ws && peer.readyState === 1) {
        peer.send(data);
      }
    }
  });

  ws.on('close', () => {
    peers.delete(ws);
    console.log(`[${room}] ${role} left (${peers.size}/2)`);
    if (peers.size === 0) {
      rooms.delete(room);
      console.log(`[${room}] room deleted`);
    } else {
      for (const [peer] of peers) {
        if (peer.readyState === 1) {
          peer.send(JSON.stringify({ type: 'peer-left' }));
        }
      }
    }
  });

  ws.on('error', () => {});
});

httpServer.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
