import { useEffect, useState } from 'preact/hooks';
import { MIN_PLAYERS, MAX_PLAYERS } from '../src/game.ts';
import type { RoomSummary } from '../src/server.ts';
import { api, OFFLINE, type Session } from './api.ts';
import { Page } from './page.tsx';
import { store } from './store.ts';
import type { Run } from './table.ts';

const SIZES = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

export function Browser({ run, onJoin }: { run: Run; onJoin: (s: Session) => void }) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [offline, setOffline] = useState(false);
  const [form, setForm] = useState({ name: store.get('lks-name') ?? '', room: '', max: 4 });
  useEffect(() => {
    const load = () => api<RoomSummary[]>('/api/rooms').then((r) => { setRooms(r); setOffline(false); }, () => setOffline(true));
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);
  const sit = (path: string, body: object) => run(async () => {
    store.set('lks-name', form.name);
    onJoin(await api<Session>(path, body));
  });

  return (
    <Page title="Last King Standing">
      <main class="main">
        <section class="opener">
          <h2>Play a game</h2>
          <p>A card war for {MIN_PLAYERS} to {MAX_PLAYERS} players. Guard your King, strike theirs, be the last King standing.</p>
          <form id="new" class="newbar panel" onSubmit={(e) => { e.preventDefault(); sit('/api/rooms', form)(); }}>
            <label><span>Your name</span><input id="name" autocomplete="nickname" maxLength={24} value={form.name} required
              onInput={(e) => setForm({ ...form, name: e.currentTarget.value })} /></label>
            <label><span>Game name</span><input id="room" placeholder="Friday night" maxLength={24} value={form.room}
              onInput={(e) => setForm({ ...form, room: e.currentTarget.value })} /></label>
            <label><span>Players</span><select id="max" value={form.max} onChange={(e) => setForm({ ...form, max: +e.currentTarget.value })}>
              {SIZES.map((n) => <option value={n}>{n}</option>)}</select></label>
            <button id="create" class="btn gold">Create game</button>
          </form>
        </section>
        <section class="tables">
          <h2>{offline ? OFFLINE : rooms.length ? `${rooms.length} game${rooms.length > 1 ? 's' : ''} open` : 'No games yet. Create the first one.'}</h2>
          {rooms.length > 0 && <ul class="game-list panel">{rooms.map((r) => {
            const open = r.status === 'lobby' && r.players.length < r.max;
            return (
              <li class="game-row" key={r.id}>
                <div><b>{r.name}</b><span class="meta">{r.players.length} of {r.max} players · {r.players.join(', ')}</span></div>
                {open ? <button class="btn gold" onClick={sit(`/api/rooms/${r.id}/join`, { name: form.name })}>Join</button>
                  : <span class="pill">{r.status === 'lobby' ? 'Full' : 'In play'}</span>}
              </li>
            );
          })}</ul>}
        </section>
      </main>
    </Page>
  );
}
