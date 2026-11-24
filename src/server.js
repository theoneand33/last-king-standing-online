// HTTP + Server-Sent Events game server. Clients POST actions and receive their
// own filtered view of the room over an SSE stream. No dependencies.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createGame, act, forfeit, view, MAX_PLAYERS } from './game.js';

const PUBLIC = new URL('../public/', import.meta.url);
const STATIC = { '/': ['index.html', 'text/html'], '/client.js': ['client.js', 'text/javascript'] };
const IDLE_MS = 60 * 60 * 1000;

const rid = (n) => randomBytes(n).toString('base64url');

export function createServer() {
  const rooms = new Map(); // id → room

  const summary = (r) => ({
    id: r.id, name: r.name, max: r.max, status: r.game ? r.game.phase : 'lobby',
    players: r.players.filter((p) => !p.left).map((p) => p.name),
  });

  function roomView(r, token) {
    const me = r.players.find((p) => p.token === token);
    return {
      room: { ...summary(r), host: r.players.find((p) => p.token === r.host)?.id ?? null },
      you: me?.id ?? null,
      game: r.game ? view(r.game, me?.id) : null,
    };
  }

  function broadcast(r) {
    r.touched = Date.now();
    for (const c of r.clients) c.res.write(`data: ${JSON.stringify(roomView(r, c.token))}\n\n`);
  }

  function addPlayer(r, name) {
    const p = { id: rid(6), token: rid(18), name, left: false };
    r.players.push(p);
    return p;
  }

  const routes = {
    'GET /api/rooms': () => [...rooms.values()].map(summary),

    'POST /api/rooms': ({ body }) => {
      const max = Number.isInteger(body.max) && body.max >= 2 && body.max <= MAX_PLAYERS ? body.max : 4;
      const r = { id: rid(6), name: text(body.room, 'Room'), max, players: [], game: null, clients: new Set(), host: null };
      const p = addPlayer(r, text(body.name, 'Player'));
      r.host = p.token;
      rooms.set(r.id, r);
      broadcast(r);
      return { room: r.id, token: p.token };
    },

    'POST /api/rooms/:id/join': ({ r, body }) => {
      if (r.game) throw new Error('Game already started');
      if (r.players.length >= r.max) throw new Error('Room is full');
      const p = addPlayer(r, text(body.name, 'Player'));
      broadcast(r);
      return { room: r.id, token: p.token };
    },

    'POST /api/rooms/:id/start': ({ r, me }) => {
      if (me.token !== r.host) throw new Error('Only the host can start');
      if (r.game) throw new Error('Already started');
      if (r.players.length < 2) throw new Error('Need at least 2 players');
      r.game = createGame(r.players);
      broadcast(r);
      return {};
    },

    'POST /api/rooms/:id/action': ({ r, me, body }) => {
      if (!r.game) throw new Error('Game has not started');
      act(r.game, me.id, body.action);
      broadcast(r);
      return {};
    },

    'POST /api/rooms/:id/leave': ({ r, me }) => {
      if (r.game) {
        forfeit(r.game, me.id);
        me.left = true;
      } else r.players.splice(r.players.indexOf(me), 1);
      if (r.host === me.token) r.host = r.players.find((p) => !p.left)?.token ?? null;
      if (!r.host) rooms.delete(r.id);
      else broadcast(r);
      return {};
    },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        res.writeHead(200, { 'content-type': type });
        return res.end(await readFile(new URL(file, PUBLIC)));
      }

      const m = url.pathname.match(/^\/api\/rooms\/([\w-]+)\/(\w+)$/);
      const r = m && rooms.get(m[1]);
      if (m && !r) return send(res, 404, { error: 'No such room' });
      const token = url.searchParams.get('token') ?? req.headers['x-token'];

      if (req.method === 'GET' && m?.[2] === 'events') {
        if (!r.players.some((p) => p.token === token)) return send(res, 403, { error: 'Not in this room' });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
        const client = { res, token };
        r.clients.add(client);
        res.write(`data: ${JSON.stringify(roomView(r, token))}\n\n`);
        req.on('close', () => r.clients.delete(client));
        return;
      }

      const route = routes[`${req.method} ${m ? `/api/rooms/:id/${m[2]}` : url.pathname}`];
      if (!route) return send(res, 404, { error: 'Not found' });
      const body = req.method === 'POST' ? await readJson(req) : {};
      const me = r && r.players.find((p) => p.token === token && !p.left);
      if (m && m[2] !== 'join' && !me) return send(res, 403, { error: 'Not in this room' });
      send(res, 200, route({ r, me, body }));
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  });

  // SSE keep-alive for proxies, and drop rooms nobody has touched for an hour.
  const timer = setInterval(() => {
    for (const r of rooms.values()) {
      for (const c of r.clients) c.res.write(': ping\n\n');
      if (Date.now() - r.touched > IDLE_MS) {
        for (const c of r.clients) c.res.end();
        rooms.delete(r.id);
      }
    }
  }, 25_000);
  server.on('close', () => clearInterval(timer));
  return server;
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function text(s, fallback) {
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, 24) : fallback;
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('Body too large');
  }
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new Error('Bad JSON');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, '0.0.0.0', () => console.log(`Listening on :${port}`));
}
