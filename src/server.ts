// HTTP + Server-Sent Events game server. Clients POST actions and receive their
// own filtered view of the room over an SSE stream. Rooms persist in SQLite.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createGame, act, forfeit, view, MAX_PLAYERS, type Game, type GameView } from './game.ts';

const PUBLIC = new URL('../public/', import.meta.url);
const STATIC: Record<string, [string, string]> = { '/': ['index.html', 'text/html'], '/client.js': ['client.js', 'text/javascript'] };
const CARD_ART = /^\/cards\/((10|[2-9JQKA])[CDHS]|JK[12])\.png$/; // card faces, see public/cards/LICENSE.txt
const SFX = /^\/sfx\/[a-z]+\.mp3$/; // sound effects, made in SoundCraft
const IDLE_MS = 60 * 60 * 1000;
const MAX_ROOMS = 1000; // room creation is open to anyone; caps memory and disk

type Seat = { id: string; token: string; name: string; left: boolean };
type Client = { res: http.ServerResponse; token: string | null };
type Room = { id: string; name: string; max: number; players: Seat[]; game: Game | null; host: string | null; touched: number; clients: Set<Client> };
export type RoomSummary = { id: string; name: string; max: number; status: Game['phase'] | 'lobby'; players: string[] };
export type RoomView = { room: RoomSummary & { host: string | null }; you: string | null; game: GameView | null };
type Ctx = { r: Room; me: Seat; body: Record<string, any> };

const rid = (n: number) => randomBytes(n).toString('base64url');

/** db: SQLite file path; ':memory:' (the default) keeps rooms only for this process. */
export function createServer({ db: dbPath = ':memory:' } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const upsert = db.prepare('INSERT INTO rooms (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data');
  const remove = db.prepare('DELETE FROM rooms WHERE id = ?');

  const rooms = new Map<string, Room>(
    db.prepare('SELECT data FROM rooms').all().map((row) => {
      const r: Room = { ...JSON.parse(row.data as string), clients: new Set() };
      return [r.id, r];
    }),
  );

  const summary = (r: Room): RoomSummary => ({
    id: r.id, name: r.name, max: r.max, status: r.game ? r.game.phase : 'lobby',
    players: r.players.filter((p) => !p.left).map((p) => p.name),
  });

  function roomView(r: Room, token: string | null): RoomView {
    const me = r.players.find((p) => p.token === token);
    return {
      room: { ...summary(r), host: r.players.find((p) => p.token === r.host)?.id ?? null },
      you: me?.id ?? null,
      game: r.game ? view(r.game, me?.id) : null,
    };
  }

  // Every change to a room goes through here: save it, then push each client its view.
  function commit(r: Room) {
    r.touched = Date.now();
    const { clients, ...data } = r;
    upsert.run(r.id, JSON.stringify(data));
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

  const routes: Record<string, (ctx: Ctx) => unknown> = {
    'GET /api/rooms': () => [...rooms.values()].map(summary),

    'POST /api/rooms': ({ body }) => {
      if (rooms.size >= MAX_ROOMS) throw new Error('Too many rooms, try later');
      const max = Number.isInteger(body.max) && body.max >= 2 && body.max <= MAX_PLAYERS ? body.max : 4;
      const r: Room = { id: rid(6), name: text(body.room, 'Room'), max, players: [], game: null, clients: new Set(), host: null, touched: 0 };
      const p = addPlayer(r, text(body.name, 'Player'));
      r.host = p.token;
      rooms.set(r.id, r);
      commit(r);
      return { room: r.id, token: p.token };
    },

    'POST /api/rooms/:id/join': ({ r, body }) => {
      if (r.game) throw new Error('Game already started');
      if (r.players.length >= r.max) throw new Error('Room is full');
      const p = addPlayer(r, text(body.name, 'Player'));
      commit(r);
      return { room: r.id, token: p.token };
    },

    'POST /api/rooms/:id/start': ({ r, me }) => {
      if (me.token !== r.host) throw new Error('Only the host can start');
      if (r.game) throw new Error('Already started');
      if (r.players.length < 2) throw new Error('Need at least 2 players');
      r.game = createGame(r.players);
      commit(r);
      return {};
    },

    'POST /api/rooms/:id/action': ({ r, me, body }) => {
      if (!r.game) throw new Error('Game has not started');
      act(r.game, me.id, body.action);
      commit(r);
      return {};
    },

    'POST /api/rooms/:id/leave': ({ r, me }) => {
      if (r.game) {
        forfeit(r.game, me.id);
        me.left = true;
      } else r.players.splice(r.players.indexOf(me), 1);
      if (r.host === me.token) r.host = r.players.find((p) => !p.left)?.token ?? null;
      if (!r.host) drop(r);
      else commit(r);
      return {};
    },
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      const asset = url.pathname.slice(1);
      const file = STATIC[url.pathname] ?? (CARD_ART.test(url.pathname) ? [asset, 'image/png'] : SFX.test(url.pathname) ? [asset, 'audio/mpeg'] : null);
      if (req.method === 'GET' && file) {
        const [path, type] = file;
        const data = await readFile(new URL(path, PUBLIC)); // before writeHead, so a failed read can still send an error
        res.writeHead(200, { 'content-type': type, ...(!STATIC[url.pathname] ? { 'cache-control': 'public, max-age=86400' } : {}) });
        return res.end(data);
      }

      const m = url.pathname.match(/^\/api\/rooms\/([\w-]+)\/(\w+)$/);
      const r = m && rooms.get(m[1]);
      if (m && !r) return send(res, 404, { error: 'No such room' });
      const header = req.headers['x-token'];
      const token = url.searchParams.get('token') ?? (typeof header === 'string' ? header : null);

      if (req.method === 'GET' && r && m?.[2] === 'events') {
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
      // Room routes always have r (checked above); `me` is only missing on join, which ignores it.
      send(res, 200, route({ r: r as Room, me: me as Seat, body }));
    } catch (e) {
      send(res, 400, { error: (e as Error).message });
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
