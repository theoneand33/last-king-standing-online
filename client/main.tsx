// Client: server browser, room lobby, setup and play.
import { render } from 'preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Action, Card as CardT, Cell, Suit } from '../src/game.ts';
import type { RoomSummary, RoomView } from '../src/server.ts';

type Session = { room: string; token: string };
type Run = <A extends unknown[]>(fn: (...args: A) => unknown) => (...args: A) => Promise<void>;

const SYM: Record<Suit, string> = { C: '♣', D: '♦', H: '♥', S: '♠' };
const ROLE: Record<Suit, string> = { C: 'Warrior', D: 'Archer', H: 'Healer', S: 'Shield' };
const OFFLINE = "Can't reach the server. Check your connection; retrying…";

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const loadSession = (): Session | null => { try { return JSON.parse(store.get('lks') ?? 'null'); } catch { return null; } };

async function api<T = any>(path: string, body?: object, token = ''): Promise<T> {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-token': token },
    body: body && JSON.stringify(body),
  }).catch(() => { throw new Error(OFFLINE); });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Server error (${res.status}). Try again in a moment.`);
  return json;
}

// ---------- pieces ----------
const Crown = () => (
  <svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2 13h14v2H5z" /></svg>
);
const label = (c: CardT) => (c.kingOf ? 'King' : `${c.rank}${SYM[c.suit!]}`);
// Log lines carry card ids (7D, AC-2, JK1): print them as cards.
const prettyLog = (l: string) => l.replace(/\b(10|[2-9JQK])([CDHS])(?:-\d+)?\b/g, (_, r, s: Suit) => r + SYM[s]).replace(/\b(A[CDHS]|JK\d)(?:-\d+)?\b/g, 'King');
const lim = (c: CardT) => (c.limit >= 99 ? '∞' : c.limit);
const red = (c: CardT) => c.suit === 'D' || c.suit === 'H';
const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

type CardProps = { c: CardT | null; small?: boolean; extra?: string; disabled?: boolean; pressed?: boolean; onClick?: () => void; style?: Record<string, number>; where?: string };
function Card({ c, small, extra, disabled, pressed, onClick, style, where }: CardProps) {
  if (!c) return <span class={cls('pc gap', small && 'sm')} aria-hidden="true" />;
  const kills = c.stack.length;
  const name = c.kingOf ? 'King' : `${c.rank} of ${ROLE[c.suit!]}s`;
  const idx = c.kingOf ? <Crown /> : <><b>{c.rank}</b><i>{SYM[c.suit!]}</i></>;
  return (
    <button type="button" class={cls('pc', c.kingOf ? 'king' : red(c) && 'red', small && 'sm', extra)} disabled={disabled}
      aria-pressed={pressed} onClick={onClick} style={style} data-id={c.id} aria-label={`${where ? `${where}: ` : ''}${name}, kills up to ${lim(c)}, ${kills} kills`}>
      <span class="ix tl">{idx}</span><span class="face">{c.kingOf ? <Crown /> : SYM[c.suit!]}</span><span class="ix br">{idx}</span>
      <span class="role">{c.kingOf ? 'King' : ROLE[c.suit!]}</span>
      <span class="chips">
        <span class="chip" title={`Kills cards up to ${lim(c)}`}>≤{lim(c)}</span>
        {kills > 0 && <span key={kills} class="chip kill" title={`${kills} kill${kills > 1 ? 's' : ''}, last ${label(c.stack.at(-1)!)}`}>✕{kills}</span>}
      </span>
    </button>
  );
}

// Follows the system until the player picks; the pick is stored and set on <html data-theme>.
const applyTheme = (t: string | null) => { if (t) document.documentElement.dataset.theme = t; };
applyTheme(store.get('lks-theme'));
function ThemeToggle() {
  const [dark, setDark] = useState(() => (document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark');
  const flip = () => { const t = dark ? 'light' : 'dark'; applyTheme(t); store.set('lks-theme', t); setDark(!dark); };
  return (
    <button id="theme" type="button" class="btn line icon" aria-label="Dark theme" title="Dark theme" aria-pressed={dark} onClick={flip}>
      {/* Lucide icons (ISC licence): sun while dark, moon while light */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>
          : <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />}
      </svg>
    </button>
  );
}

function Page({ title, right, onLeave, children }: { title: string; right?: ComponentChildren; onLeave?: () => void; children: ComponentChildren }) {
  useEffect(() => { document.title = title; }, [title]);
  return (
    <>
      <header class="top">
        <div class="brand"><span class="logo"><Crown /></span><h1>{title}</h1></div>
        <div class="top-r">{right}<ThemeToggle />{onLeave && <button id="leave" class="btn line" onClick={onLeave}>Leave game</button>}</div>
      </header>
      {children}
    </>
  );
}

// Page position from layout offsets: ignores transforms (hover, selection) and scrolling.
function pagePos(el: HTMLElement) {
  let x = 0, y = 0;
  for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) { x += e.offsetLeft; y += e.offsetTop; }
  return [x, y];
}

// Cards are keyed by id, so Preact keeps their DOM nodes across updates. After each render, slide every card
// from where it was to where it is (swaps, the card behind a kill moving up) and fade in new ones (resurrections).
function useCardMotion() {
  const root = useRef<HTMLElement>(null);
  const last = useRef<Map<string, number[]> | null>(null);
  useLayoutEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const inOut = getComputedStyle(document.documentElement).getPropertyValue('--in-out');
    const now = new Map<string, number[]>();
    for (const el of root.current!.querySelectorAll<HTMLElement>('.pc[data-id]')) {
      const [x, y] = pagePos(el);
      now.set(el.dataset.id!, [x, y]);
      const was = last.current?.get(el.dataset.id!);
      if (!last.current) continue; // first paint: nothing to animate from
      if (!was) el.animate(reduce ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, scale: '.95' }, { opacity: 1, scale: '1' }], { duration: 200, easing: 'ease-out' });
      else if (!reduce && (was[0] !== x || was[1] !== y)) {
        el.animate([{ translate: `${was[0] - x}px ${was[1] - y}px` }, { translate: '0 0' }], { duration: 280, easing: inOut });
      }
    }
    last.current = now;
  });
  return root;
}

// ---------- screens ----------
function Browser({ run, onJoin }: { run: Run; onJoin: (s: Session) => void }) {
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
          <p>A card war for 2 to 10 players. Guard your King, strike theirs, be the last King standing.</p>
          <form id="new" class="newbar panel" onSubmit={(e) => { e.preventDefault(); sit('/api/rooms', form)(); }}>
            <label><span>Your name</span><input id="name" autocomplete="nickname" maxLength={24} value={form.name} required
              onInput={(e) => setForm({ ...form, name: e.currentTarget.value })} /></label>
            <label><span>Game name</span><input id="room" placeholder="Friday night" maxLength={24} value={form.room}
              onInput={(e) => setForm({ ...form, room: e.currentTarget.value })} /></label>
            <label><span>Players</span><select id="max" value={form.max} onChange={(e) => setForm({ ...form, max: +e.currentTarget.value })}>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option value={n}>{n}</option>)}</select></label>
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

type TableProps = { data: RoomView; run: Run; send: (path: string, body?: object) => Promise<unknown>; onLeave: () => void };

function Lobby({ data, run, send, onLeave }: TableProps) {
  const { room, you } = data;
  return (
    <Page title={room.name} right={<span class="pill">{room.players.length}/{room.max} players</span>} onLeave={onLeave}>
      <main class="main center">
        <section class="lobby panel">
          <h2>Players</h2>
          <ul class="roster">{Array.from({ length: room.max }, (_, i) => room.players[i]
            ? <li><span class="av" aria-hidden="true">{room.players[i][0].toUpperCase()}</span>{room.players[i]}</li>
            : <li class="open"><span class="av" aria-hidden="true" />Open spot</li>)}</ul>
          {room.host === you ? <>
            <button id="start" class="btn gold big" disabled={room.players.length < 2} onClick={run(() => send('start', {}))}>Start game</button>
            <p class="whisper">{room.players.length < 2 ? 'Needs one more player' : 'No one else can join once you start'}</p>
          </> : <p class="whisper">The host starts the game when everyone is in</p>}
        </section>
      </main>
    </Page>
  );
}

function Setup({ data, run, send, onLeave, showErr }: TableProps & { showErr: (m: string) => void }) {
  const [pick, setPick] = useState<{ discard: string[]; layout: string[] }>({ discard: [], layout: [] });
  const tray = useRef<HTMLDivElement>(null);
  // A picked card unmounts and drops keyboard focus to <body>: hand it to the next card, or to Lock in.
  useEffect(() => {
    if (document.activeElement !== document.body) return;
    (tray.current?.querySelector<HTMLElement>('.hand .pc') ?? document.getElementById('confirm'))?.focus();
  }, [pick]);
  const g = data.game!;
  const me = g.players.find((p) => p.id === data.you)!;
  if (!me.alive || me.ready) {
    const waiting = g.players.filter((p) => p.alive && !p.ready).map((p) => p.name);
    return <Page title={data.room.name} onLeave={onLeave}><main class="main center"><p class="whisper">Waiting for {waiting.join(', ')} to place their cards…</p></main></Page>;
  }
  const pool = [me.king, ...(me.hand as CardT[])];
  const { discard, layout } = pick;
  const byId = (id: string) => pool.find((c) => c.id === id)!;
  const placing = discard.length >= 2;
  const tap = (id: string) => {
    if (!placing && id === me.king.id) return showErr('You can’t discard your King');
    showErr('');
    setPick(placing ? { discard, layout: [...layout, id] } : { discard: [...discard, id], layout });
  };
  const slot = (i: number) => layout[i] ? <Card key={layout[i]} c={byId(layout[i])} disabled extra="land" />
    : <span key={`slot${i}`} class={cls('pc ghost', placing && i === layout.length && 'next')}>{placing && i === layout.length && <b>Next</b>}{i < 3 ? 'Front' : 'Back'}</span>;

  return (
    <Page title={data.room.name} right={<span class="pill">{placing ? 'Place 6' : `Discard ${2 - discard.length}`}</span>} onLeave={onLeave}>
      <main class="main setup">
        <div class="lay">
          <div class="muck"><span class="tiny">Discards</span>{[0, 1].map((i) => discard[i]
            ? <Card key={discard[i]} c={byId(discard[i])} disabled extra="land" small /> : <span key={`d${i}`} class="pc ghost sm" />)}</div>
          <div class="formation panel">{[0, 1, 2, 3, 4, 5].map(slot)}</div>
          <p class="whisper">{placing ? 'Tap cards in order: front row left to right, then the back row' : 'Tap two cards to throw away. Your King stays.'}</p>
        </div>
        <div class="hand-tray panel" ref={tray}>
          <div class="hand">{pool.map((c, i) => discard.includes(c.id) || layout.includes(c.id) ? null
            : <Card key={c.id} c={c} style={{ '--i': i }} onClick={() => tap(c.id)} />)}</div>
          <div class="tray-actions">
            <button id="reset" class="btn line" onClick={() => setPick({ discard: [], layout: [] })}>Pick up all</button>
            <button id="confirm" class="btn gold" disabled={layout.length !== 6}
              onClick={run(async () => { await send('action', { action: { type: 'setup', ...pick } }); setPick({ discard: [], layout: [] }); })}>Lock in layout</button>
          </div>
        </div>
      </main>
    </Page>
  );
}

function Play({ data, run, send, onLeave }: TableProps) {
  const [sel, setSel] = useState<Cell[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const board = useCardMotion();
  const g = data.game!;
  const meIdx = g.players.findIndex((p) => p.id === data.you);
  const me = g.players[meIdx];
  const myTurn = g.phase === 'play' && g.turn === meIdx && !g.pending;
  const isSel = (pi: number, r: number, c: number) => sel.some((s) => s.player === pi && s.row === r && s.col === c);
  const toggle = (player: number, row: number, col: number) => setSel(isSel(player, row, col)
    ? sel.filter((s) => !(s.player === player && s.row === row && s.col === col))
    : [...sel.slice(-1), { player, row, col }]); // keep the last two picks
  const act = (action: Action) => send('action', { action });
  const move = (fn: () => unknown) => run(async () => { await fn(); setSel([]); });
  const need2 = () => { if (sel.length !== 2) throw new Error('Select two cards'); return sel; };
  const mine = (a: Cell) => { if (a.player !== meIdx || a.row !== 0) throw new Error('First pick one of your front-row cards'); };

  const grid = (pi: number, small: boolean) => g.players[pi].grid!.flatMap((row, r) => row.map((c, col) => (
    <Card key={c?.id ?? `gap${r}${col}`} c={c} small={small} extra={isSel(pi, r, col) ? 'sel' : undefined}
      where={`${pi === meIdx ? 'Your' : `${g.players[pi].name}'s`} ${r === 0 ? 'front' : 'back'} row`}
      pressed={isSel(pi, r, col)} onClick={() => toggle(pi, r, col)} />
  )));

  const turnName = g.phase === 'play' ? (myTurn ? 'Your move' : `${g.players[g.turn].name} to play`) : 'Game over';
  let banner: ComponentChildren = null;
  let status = turnName; // read out by the live region below
  if (g.phase === 'over') {
    status = `${g.players.find((p) => p.id === g.winner)!.name} wins`;
    banner = <div class="dealer panel"><b>{status}</b><button id="leave2" class="btn gold" onClick={onLeave}>Back to games</button></div>;
  } else if (g.pending && g.pending.defender === meIdx) {
    const t = g.pending.target;
    status = `Incoming on your ${label(me.grid![t.row][t.col]!)}. Block with a Shield, or take the hit.`;
    banner = (
      <div class="dealer panel alarm"><b>Incoming on your {label(me.grid![t.row][t.col]!)}.</b> Block with a Shield?
        {g.pending.shields.map((c) => <button class="btn gold" onClick={run(() => act({ type: 'shield', col: c }))}>Block with {label(me.grid![t.row][c]!)}</button>)}
        <button class="btn line" onClick={run(() => act({ type: 'shield', col: null }))}>Take the hit</button></div>
    );
  } else if (g.pending) {
    status = `${g.players[g.pending.defender].name} is deciding whether to block…`;
    banner = <div class="dealer panel">{status}</div>;
  }
  const hint = !myTurn ? '' : g.half === 'action'
    ? (sel.length === 0 ? 'Tap one of your front cards' : sel.length === 1 ? 'Now tap a target, or a card holding kills' : 'Pick a move')
    : 'Swap two cards in one layout, or pass';

  const right = <>
    <span class={cls('pill', myTurn && 'hot')}>{turnName}{g.phase === 'play' && g.half === 'swap' && ' · swap'}</span>
    <button id="logbtn" class="btn line" aria-expanded={logOpen} aria-controls="log" onClick={() => setLogOpen(!logOpen)}>Log</button>
  </>;

  return (
    <Page title={data.room.name} right={right} onLeave={onLeave}>
      <main class="main board" ref={board}>
        <p class="sr-only" role="status">{status}</p>
        <div class="opps" style={{ '--n': g.players.length - 1 }}>{g.players.map((p, pi) => {
          if (pi === meIdx) return null;
          const playing = pi === g.turn && g.phase === 'play';
          return (
            <section key={p.id} class={cls('opp panel', playing && 'turn', !p.alive && 'out')}>
              <header><span class="av" aria-hidden="true">{p.name[0].toUpperCase()}</span><h2>{p.name}</h2>{!p.alive && <span class="pill">Out</span>}{playing && <span class="pill hot">Playing</span>}</header>
              {p.alive && <div class="mini-grid">{grid(pi, true)}</div>}
            </section>
          );
        })}</div>
        {banner}
        <section class={cls('mine panel', myTurn && 'turn', !me.alive && 'out')}>
          {me.alive ? <div class="my-grid">{grid(meIdx, false)}</div> : <p class="whisper">You are out. Watch the rest play.</p>}
        </section>
        {myTurn && (
          <nav class="moves panel" aria-label="Moves"><span class="hint">{hint}</span>
            {g.half === 'action' && <>
              <button id="attack" class="btn gold" onClick={move(() => { const [a, t] = need2(); mine(a); return act({ type: 'attack', col: a.col, target: t }); })}>Attack</button>
              <button id="res" class="btn line" onClick={move(() => { const [a, s] = need2(); mine(a); return act({ type: 'resurrect', col: a.col, from: s }); })}>Resurrect</button>
            </>}
            <button id="swap" class={cls('btn', g.half === 'action' ? 'line' : 'gold')} onClick={move(() => {
              const [a, b] = need2();
              if (a.player !== b.player) throw new Error('Swap within one layout');
              return act({ type: 'swap', player: a.player, a: [a.row, a.col], b: [b.row, b.col] });
            })}>Swap</button>
            <button id="skip" class="btn line" onClick={move(() => act({ type: 'skip' }))}>{g.half === 'action' ? 'Skip to swap' : 'Pass'}</button>
            {sel.length > 0 && <button id="clear" class="btn line" onClick={() => setSel([])}>Clear</button>}
          </nav>
        )}
        <aside id="log" class="drawer panel" hidden={!logOpen}><h2>Game log</h2>
          <ol>{g.log.length ? g.log.slice().reverse().map((l) => <li>{prettyLog(l)}</li>) : <li>No moves yet.</li>}</ol>
          <p class="tiny">♣ Warrior kills up to double its value · ♦ Archer hits the back row · ♥ Healer revives a captured card · ♠ Shield blocks for its row</p></aside>
      </main>
    </Page>
  );
}

function App() {
  const [session, setSession] = useState(loadSession);
  const [data, setData] = useState<RoomView | null>(null);
  const [err, setErr] = useState('');
  const [offline, setOffline] = useState(false);
  const run: Run = (fn) => async (...args) => {
    setErr('');
    try { await fn(...args); } catch (e) { setErr((e as Error).message); }
  };
  const join = (s: Session | null) => {
    store.set('lks', s && JSON.stringify(s));
    setSession(s);
    setData(null);
  };

  useEffect(() => {
    if (!session) return;
    const stream = new EventSource(`/api/rooms/${session.room}/events?token=${encodeURIComponent(session.token)}`);
    stream.onopen = () => setOffline(false);
    stream.onmessage = (e) => { setOffline(false); setData(JSON.parse(e.data)); };
    stream.onerror = async () => {
      // EventSource retries on its own; say so, and only give up if the room is gone.
      setOffline(true);
      const rooms = await api<RoomSummary[]>('/api/rooms').catch(() => null);
      if (rooms && !rooms.some((r) => r.id === session.room)) join(null);
    };
    return () => { stream.close(); setOffline(false); };
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
    await send('leave', {}).catch(() => {});
    join(null);
  });
  const props = { data: data!, run, send, onLeave };
  const screen = !data ? <Page title="Last King Standing" onLeave={onLeave}><main class="main center"><p class="whisper">Joining the game…</p></main></Page>
    : !data.game ? <Lobby {...props} />
    : data.game.phase === 'setup' ? <Setup {...props} showErr={setErr} />
    : <Play {...props} />;
  return <>{screen}{errBox}</>;
}

render(<App />, document.getElementById('app')!);
