// Client: server browser, room lobby, setup and play.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameView } from '../src/game.ts';
import type { RoomView } from '../src/server.ts';
import { api, OFFLINE, type Session } from './api.ts';
import { Browser } from './browser.tsx';
import { playEvents } from './game-sounds.ts';
import { Lobby } from './lobby.tsx';
import { Page } from './page.tsx';
import { Play } from './play.tsx';
import { Setup } from './setup.tsx';
import { sfx } from './sfx.ts';
import { store } from './store.ts';
import type { Run } from './table.ts';

const loadSession = (): Session | null => { try { return JSON.parse(store.get('lks') ?? 'null'); } catch { return null; } };

function App() {
  const [session, setSession] = useState(loadSession);
  const [data, setData] = useState<RoomView | null>(null);
  const [err, setErr] = useState('');
  const [offline, setOffline] = useState(false);
  const run: Run = (fn) => async (...args) => {
    setErr('');
    try { await fn(...args); } catch (e) { setErr((e as Error).message); sfx('error'); }
  };
  const seen = useRef<GameView | null>(null);
  useEffect(() => {
    const g = data?.game ?? null, was = seen.current;
    seen.current = g;
    if (g && was) playEvents(was, g, data!.you);
  }, [data]);
  const join = (s: Session | null) => {
    store.set('lks', s && JSON.stringify(s));
    setSession(s);
    setData(null);
  };

  useEffect(() => {
    if (!session) return;
    const url = `/api/rooms/${session.room}/events?token=${encodeURIComponent(session.token)}`;
    let live = true, stream: EventSource, retry: ReturnType<typeof setTimeout>;
    const open = () => {
      stream = new EventSource(url);
      stream.onopen = () => setOffline(false);
      stream.onmessage = (e) => { setOffline(false); setData(JSON.parse(e.data)); };
      stream.onerror = async () => {
        setOffline(true);
        // EventSource retries a dropped connection itself, but gives up for good on an HTTP error: the room or
        // seat is gone, or the proxy has no app behind it mid-deploy (502, or 404 from Traefik). Only the app answers JSON.
        if (stream.readyState !== EventSource.CLOSED) return;
        const gone = await fetch(url).then((r) => {
          r.body?.cancel();
          return (r.status === 403 || r.status === 404) && !!r.headers.get('content-type')?.startsWith('application/json');
        }, () => false);
        if (!live) return;
        if (gone) join(null);
        else retry = setTimeout(open, 3000);
      };
    };
    open();
    return () => { live = false; clearTimeout(retry); stream.close(); setOffline(false); };
  }, [session]);

  const errBox = (
    <div id="error" role="alert" hidden={!err && !offline}>
      {err || OFFLINE}{err && <button type="button" class="x" aria-label="Dismiss" onClick={() => setErr('')}>×</button>}
    </div>
  );
  if (!session) return <><Browser run={run} onJoin={join} />{errBox}</>;
  const send = (path: string, body?: object) => api(`/api/rooms/${session.room}/${path}`, body, session.token);
  const onLeave = run(async () => {
    if (data?.game && data.game.phase !== 'over' && !confirm('Leaving forfeits the game. Leave?')) return;
    await send('leave', {}).catch(() => {}); // the room may be gone already; leave it here either way
    join(null);
  });
  const props = { data: data!, run, send, onLeave };
  const screen = !data ? <Page title="Last King Standing" onLeave={onLeave}><main class="main center"><p class="whisper">Joining the game…</p></main></Page>
    : !data.game ? <Lobby {...props} />
    : data.game.phase === 'setup' ? <Setup {...props} />
    : <Play {...props} />;
  return <>{screen}{errBox}</>;
}

render(<App />, document.getElementById('app')!);
