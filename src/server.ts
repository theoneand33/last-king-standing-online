// HTTP + Server-Sent Events game server. Clients POST actions and receive their
// own filtered view of the room over an SSE stream. Rooms persist in SQLite.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createGame, act, forfeit, view, MIN_PLAYERS, MAX_PLAYERS, type Game, type GameView } from './game.ts';

const PUBLIC = new URL('../public/', import.meta.url);
// The page and its bundle change with every deploy; card art and sounds don't, so browsers may keep them.
const FILES: Record<string, { type: string; cache?: string }> = {
  '.html': { type: 'text/html' },
  '.js': { type: 'text/javascript' },
  '.png': { type: 'image/png', cache: 'public, max-age=86400' },
  '.mp3': { type: 'audio/mpeg', cache: 'public, max-age=86400' },
  '.txt': { type: 'text/plain' },
};
const IDLE_MS = 60 * 60 * 1000;
const MAX_ROOMS = 1000; // room creation is open to anyone; caps memory and disk
// Bump when the saved room shape changes: rooms saved in another shape are dropped on load.
const SAVE_VERSION = 2;

type Seat = { id: string; token: string; name: string; left: boolean };
type Client = { res: http.ServerResponse; token: string };
type Room = { id: string; name: string; max: number; players: Seat[]; game: Game | null; host: string | null; touched: number; clients: Set<Client> };
export type RoomSummary = { id: string; name: string; max: number; status: Game['phase'] | 'lobby'; players: string[] };
export type RoomView = { room: RoomSummary & { host: string | null }; you: string | null; game: GameView | null };

type Req = { body: Record<string, any>; req: http.IncomingMessage; res: http.ServerResponse };
type InRoom = Req & { r: Room };
type Seated = InRoom & { me: Seat };
type RoomRoute = { seat: false; run: (q: InRoom) => unknown } | { seat: true; run: (q: Seated) => unknown };

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const rid = (n: number) => randomBytes(n).toString('base64url');

/** db: SQLite file path; ':memory:' (the default) keeps rooms only for this process. */
export function createServer({ db: dbPath = ':memory:' } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const upsert = db.prepare('INSERT INTO rooms (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data');
  const remove = db.prepare('DELETE FROM rooms WHERE id = ?');

  const rooms = new Map<string, Room>();
  for (const row of db.prepare('SELECT id, data FROM rooms').all()) {
    const { v, ...data } = JSON.parse(row.data as string);
    if (v === SAVE_VERSION) rooms.set(data.id, { ...data, clients: new Set() });
    else remove.run(row.id as string);
  }

  const summary = (r: Room): RoomSummary => ({
    id: r.id, name: r.name, max: r.max, status: r.game ? r.game.phase : 'lobby',
    players: r.players.filter((p) => !p.left).map((p) => p.name),
  });

  function roomView(r: Room, token: string): RoomView {
    const me = r.players.find((p) => p.token === token);
    return { room: { ...summary(r), host: r.host }, you: me?.id ?? null, game: r.game ? view(r.game, me?.id) : null };
  }

  // Every change to a room goes through here: save it, then push each client its view.
  function commit(r: Room) {
    r.touched = Date.now();
    const { clients, ...data } = r;
    upsert.run(r.id, JSON.stringify({ v: SAVE_VERSION, ...data }));
    for (const c of clients) c.res.write(`data: ${JSON.stringify(roomView(r, c.token))}\n\n`);
  }

  function drop(r: Room) {
    for (const c of r.clients) c.res.end();
    rooms.delete(r.id);
    remove.run(r.id);
  }

  function addPlayer(r: Room, name: string) {
    const p = { id: rid(6), token: rid(18), name, left: false };
    r.players.push(p);
    return p;
  }

  const routes: Record<string, (q: Req) => unknown> = {
    'GET /api/rooms': () => [...rooms.values()].map(summary),

    'POST /api/rooms': ({ body }) => {
      if (rooms.size >= MAX_ROOMS) throw new Error('Too many rooms, try later');
      const max = Number.isInteger(body.max) && body.max >= MIN_PLAYERS && body.max <= MAX_PLAYERS ? body.max : 4;
      const r: Room = { id: rid(6), name: text(body.room, 'Room'), max, players: [], game: null, clients: new Set(), host: null, touched: 0 };
      const p = addPlayer(r, text(body.name, 'Player'));
      r.host = p.id;
      rooms.set(r.id, r);
      commit(r);
      return { room: r.id, token: p.token };
    },
  };

  // Under /api/rooms/:id/, keyed by method and the last path segment.
  const roomRoutes: Record<string, RoomRoute> = {
    'POST join': { seat: false, run: ({ r, body }) => {
      if (r.game) throw new Error('Game already started');
      if (r.players.length >= r.max) throw new Error('Room is full');
      const p = addPlayer(r, text(body.name, 'Player'));
      commit(r);
      return { room: r.id, token: p.token };
    } },

    'GET events': { seat: true, run: ({ r, me, req, res }) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
      const client = { res, token: me.token };
      r.clients.add(client);
      res.write(`data: ${JSON.stringify(roomView(r, me.token))}\n\n`);
      req.on('close', () => r.clients.delete(client));
    } },

    'POST start': { seat: true, run: ({ r, me }) => {
      if (me.id !== r.host) throw new Error('Only the host can start');
      if (r.game) throw new Error('Already started');
      if (r.players.length < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players`);
      r.game = createGame(r.players);
      commit(r);
      return {};
    } },

    'POST action': { seat: true, run: ({ r, me, body }) => {
      if (!r.game) throw new Error('Game has not started');
      act(r.game, me.id, body.action);
      commit(r);
      return {};
    } },

    'POST leave': { seat: true, run: ({ r, me }) => {
      if (r.game) {
        forfeit(r.game, me.id);
        me.left = true;
      } else r.players.splice(r.players.indexOf(me), 1);
      if (r.host === me.id) r.host = r.players.find((p) => !p.left)?.id ?? null;
      if (!r.host) drop(r);
      else commit(r);
      return {};
    } },
  };

  async function dispatch(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveFile(res, url.pathname);
    const m = url.pathname.match(/^\/api\/rooms\/([\w-]+)\/(\w+)$/);
    const body = req.method === 'POST' ? await readJson(req) : {};
    if (!m) {
      const route = routes[`${req.method} ${url.pathname}`] ?? fail(404, 'Not found');
      return route({ body, req, res });
    }
    const route = roomRoutes[`${req.method} ${m[2]}`] ?? fail(404, 'Not found');
    const r = rooms.get(m[1]) ?? fail(404, 'No such room');
    if (!route.seat) return route.run({ body, req, res, r });
    const header = req.headers['x-token'];
    const token = url.searchParams.get('token') ?? (typeof header === 'string' ? header : null);
    const me = r.players.find((p) => p.token === token && !p.left) ?? fail(403, 'Not in this room');
    return route.run({ body, req, res, r, me });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const out = await dispatch(req, res, new URL(req.url ?? '/', 'http://x'));
      if (!res.headersSent) send(res, 200, out); // a route that answered itself (a file, a stream) is done
    } catch (e) {
      if (res.headersSent) return void res.end();
      send(res, e instanceof HttpError ? e.status : 400, { error: (e as Error).message });
    }
  });

  // SSE keep-alive for proxies, and drop rooms nobody has touched for an hour.
  const timer = setInterval(() => {
    for (const r of rooms.values()) {
      for (const c of r.clients) c.res.write(': ping\n\n');
      if (Date.now() - r.touched > IDLE_MS) drop(r);
    }
  }, 25_000);
  server.on('close', () => { clearInterval(timer); db.close(); });
  return server;
}

function fail(status: number, message: string): never { throw new HttpError(status, message); }

async function serveFile(res: http.ServerResponse, pathname: string) {
  const path = pathname === '/' ? '/index.html' : pathname;
  const kind = FILES[extname(path)] ?? fail(404, 'Not found');
  const file = new URL(`.${path}`, PUBLIC);
  if (!file.href.startsWith(PUBLIC.href)) fail(404, 'Not found');
  const data = await readFile(file).catch(() => fail(404, 'Not found')); // before writeHead, so a failed read can still send an error
  res.writeHead(200, { 'content-type': kind.type, ...(kind.cache ? { 'cache-control': kind.cache } : {}) });
  res.end(data);
}

function send(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function text(s: unknown, fallback: string) {
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, 24) : fallback;
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, any>> {
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
  createServer({ db: process.env.DB_PATH ?? 'lks.db' }).listen(port, '0.0.0.0', () => console.log(`Listening on :${port}`));
}
