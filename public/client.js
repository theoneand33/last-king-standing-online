// Client: server browser, room lobby, setup and play.
const SYM = { C: '♣', D: '♦', H: '♥', S: '♠' };
const ROLE = { C: 'Warrior', D: 'Archer', H: 'Healer', S: 'Shield' };
const $app = document.getElementById('app');
const $err = document.getElementById('error');

let session = load(); // { room, token }
let data = null; // latest room view from the server
let sel = []; // selected cells: { player, row, col }
let setupPick = { discard: [], layout: [] };
let stream = null;
let browseTimer = null;

function load() {
  try { return JSON.parse(localStorage.getItem('lks')); } catch { return null; }
}
function save(s) {
  session = s;
  try { s ? localStorage.setItem('lks', JSON.stringify(s)) : localStorage.removeItem('lks'); } catch {}
}
const getName = () => { try { return localStorage.getItem('lks-name') ?? ''; } catch { return ''; } };
const setName = (v) => { try { localStorage.setItem('lks-name', v); } catch {} return v; };

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-token': session?.token ?? '' },
    body: body && JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json;
}
const showErr = (m) => { $err.textContent = m; $err.hidden = !m; };
const run = (fn) => async (...args) => {
  showErr('');
  try { await fn(...args); } catch (e) { showErr(e.message); }
};
const act = (action) => api(`/api/rooms/${session.room}/action`, { action });

function connect() {
  stream?.close();
  stream = new EventSource(`/api/rooms/${session.room}/events?token=${encodeURIComponent(session.token)}`);
  stream.onmessage = (e) => { data = JSON.parse(e.data); render(); };
  stream.onerror = async () => {
    // EventSource retries on its own; only give up if the room is gone.
    const res = await fetch(`/api/rooms`).then((r) => r.json()).catch(() => null);
    if (res && !res.some((r) => r.id === session.room)) leaveLocal();
  };
}

function leaveLocal() {
  stream?.close();
  stream = null;
  data = null;
  sel = [];
  setupPick = { discard: [], layout: [] };
  save(null);
  render();
}

// ---------- rendering: a card table seen from your chair ----------
const h = (html) => { $app.innerHTML = html; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2 13h14v2H5z"/></svg>';
const label = (c) => (c.kingOf ? 'King' : `${c.rank}${SYM[c.suit]}`);
// Log lines carry card ids (7D, AC-2, JK1): print them as cards.
const prettyLog = (l) => esc(l).replace(/\b(10|[2-9JQK])([CDHS])(?:-\d+)?\b/g, (_, r, s) => r + SYM[s]).replace(/\b(A[CDHS]|JK\d)(?:-\d+)?\b/g, 'King');
const lim = (c) => (c.limit >= 99 ? '∞' : c.limit);
const red = (c) => c.suit === 'D' || c.suit === 'H';

function cardHtml(c, attrs = '', extra = '', small = false) {
  const sz = small ? ' sm' : '';
  if (!c) return `<span class="pc gap${sz}" aria-hidden="true"></span>`;
  const kills = c.stack?.length ?? 0;
  const chip = `<span class="chip" title="Kills cards up to ${lim(c)}">≤${lim(c)}</span>${kills ? `<span class="chip kill" title="${kills} kill${kills > 1 ? 's' : ''}, last ${label(c.stack.at(-1))}">✕${kills}</span>` : ''}`;
  const name = c.kingOf ? 'King' : `${c.rank} of ${ROLE[c.suit]}s`;
  const idx = c.kingOf ? CROWN : `<b>${c.rank}</b><i>${SYM[c.suit]}</i>`;
  return `<button type="button" class="pc${c.kingOf ? ' king' : red(c) ? ' red' : ''}${sz}${extra}" ${attrs} aria-label="${name}, kills up to ${lim(c)}, ${kills} kills">
    <span class="ix tl">${idx}</span><span class="face">${c.kingOf ? CROWN : SYM[c.suit]}</span><span class="ix br">${idx}</span>
    <span class="role">${c.kingOf ? 'King' : ROLE[c.suit]}</span><span class="chips">${chip}</span></button>`;
}

function topbar(title, right = '') {
  return `<header class="top"><div class="brand"><span class="logo">${CROWN}</span><span>${title}</span></div>
    <div class="top-r">${right}${session ? '<button id="leave" class="btn line">Leave table</button>' : ''}</div></header>`;
}
function page(title, right, body) {
  h(topbar(title, right) + body);
  if (session) wireLeave();
}

function render() {
  clearInterval(browseTimer);
  if (!session) return renderBrowser();
  if (!data) return page('Last King Standing', '', '<main class="felt center"><p class="whisper">Finding your seat…</p></main>');
  if (!data.game) return renderLobby();
  if (data.game.phase === 'setup') return renderSetup();
  renderPlay();
}

const seatRing = (names, max, cls = '') => `<div class="ring ${cls}" style="--n:${max}">${Array.from({ length: max }, (_, i) =>
  `<span class="seat${names[i] ? ' taken' : ''}" style="--i:${i}" title="${names[i] ? esc(names[i]) : 'Open seat'}">${names[i] ? esc(names[i][0].toUpperCase()) : ''}</span>`).join('')}</div>`;

async function renderBrowser() {
  const rooms = await api('/api/rooms').catch(() => []);
  if (session) return; // joined while loading
  const keep = { name: document.getElementById('name')?.value ?? getName(), room: document.getElementById('room')?.value ?? '' };
  page('Last King Standing', '', `
    <main class="felt">
      <section class="opener">
        <h1>Pull up a chair.</h1>
        <p>A card war for 2 to 10 players. Guard your King, strike theirs, be the last crown on the table.</p>
        <form id="new" class="newbar" onsubmit="return false">
          <label><span>Your name</span><input id="name" autocomplete="nickname" maxlength="24" value="${esc(keep.name)}" required></label>
          <label><span>Table name</span><input id="room" placeholder="Friday night" maxlength="32" value="${esc(keep.room)}"></label>
          <label><span>Seats</span><select id="max">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <button id="create" class="btn gold">Open a table</button>
        </form>
      </section>
      <section class="tables">
        <h2>${rooms.length ? `${rooms.length} table${rooms.length > 1 ? 's' : ''} open` : 'No tables yet. Open the first one.'}</h2>
        <div class="table-grid">${rooms.map((r) => {
          const open = r.status === 'lobby' && r.players.length < r.max;
          return `<article class="mini">
            ${seatRing(r.players, r.max, 'small')}
            <div class="mini-t"><b>${esc(r.name)}</b><span>${r.players.length} of ${r.max} seated · ${r.status === 'lobby' ? 'waiting' : 'playing'}</span></div>
            ${open ? `<button class="btn gold" data-join="${r.id}">Sit down</button>` : `<span class="pill">${r.status === 'lobby' ? 'Full' : 'In play'}</span>`}
          </article>`;
        }).join('')}</div>
      </section>
    </main>`);
  const nameVal = () => setName(document.getElementById('name').value);
  document.getElementById('create').onclick = run(async () => {
    const res = await api('/api/rooms', { name: nameVal(), room: document.getElementById('room').value, max: +document.getElementById('max').value });
    save(res); connect(); render();
  });
  $app.querySelectorAll('[data-join]').forEach((b) => (b.onclick = run(async () => {
    const res = await api(`/api/rooms/${b.dataset.join}/join`, { name: nameVal() });
    save(res); connect(); render();
  })));
  browseTimer = setInterval(() => !['INPUT', 'SELECT'].includes(document.activeElement?.tagName) && render(), 3000);
}

function wireLeave() {
  document.getElementById('leave').onclick = run(async () => {
    if (data?.game?.phase === 'play' && !confirm('Leaving forfeits the game. Leave?')) return;
    await api(`/api/rooms/${session.room}/leave`, {}).catch(() => {});
    leaveLocal();
  });
}

function renderLobby() {
  const { room, you } = data;
  const host = room.host === you;
  page(esc(room.name), `<span class="pill">${room.players.length}/${room.max} seated</span>`, `
    <main class="felt center">
      <div class="oval">
        ${seatRing(room.players, room.max, 'big')}
        <div class="oval-c">
          <p class="whisper">${room.players.map(esc).join(' · ')}</p>
          ${host ? `<button id="start" class="btn gold big" ${room.players.length < 2 ? 'disabled' : ''}>Deal the cards</button>
            <p class="whisper">${room.players.length < 2 ? 'Needs one more player.' : 'Open seats stay empty once you deal.'}</p>`
            : '<p class="whisper">The host deals when everyone is in.</p>'}
        </div>
      </div>
    </main>`);
  const s = document.getElementById('start');
  if (s) s.onclick = run(() => api(`/api/rooms/${session.room}/start`, {}));
}

function renderSetup() {
  const me = data.game.players.find((p) => p.id === data.you);
  const waiting = data.game.players.filter((p) => p.alive && !p.ready).map((p) => esc(p.name));
  if (!me.alive || me.ready) {
    return page(esc(data.room.name), '', `<main class="felt center"><p class="whisper">Waiting for ${waiting.join(', ')} to lay out…</p></main>`);
  }
  const pool = [me.king, ...me.hand];
  const { discard, layout } = setupPick;
  const byId = (id) => pool.find((c) => c.id === id);
  const placing = discard.length >= 2;
  const slot = (i) => layout[i] ? cardHtml(byId(layout[i]), 'disabled', ' land')
    : `<span class="pc ghost${placing && i === layout.length ? ' next' : ''}">${i < 3 ? 'Front' : 'Back'}</span>`;
  page(esc(data.room.name), `<span class="pill">${placing ? 'Place 6' : `Discard ${2 - discard.length}`}</span>`, `
    <main class="felt setup">
      <div class="lay">
        <div class="muck"><span class="tiny">Discards</span>${[0, 1].map((i) => discard[i] ? cardHtml(byId(discard[i]), 'disabled', ' land', true) : '<span class="pc ghost sm"></span>').join('')}</div>
        <div class="formation">${[0, 1, 2].map(slot).join('')}${[3, 4, 5].map(slot).join('')}</div>
        <p class="whisper">${placing ? 'Tap cards in order: front row left to right, then the back row.' : 'Tap two cards to throw away. Your King stays.'}</p>
      </div>
      <div class="hand-tray">
        <div class="hand">${pool.map((c) => (discard.includes(c.id) || layout.includes(c.id) ? '' : cardHtml(c, `data-id="${c.id}"`))).join('')}</div>
        <div class="tray-actions"><button id="reset" class="btn line">Pick up all</button>
          <button id="confirm" class="btn gold" ${layout.length === 6 ? '' : 'disabled'}>Lock in layout</button></div>
      </div>
    </main>`);
  $app.querySelectorAll('[data-id]').forEach((el) => (el.onclick = () => {
    const id = el.dataset.id;
    if (discard.length < 2) {
      if (id === me.king.id) return showErr('Your King stays on the table');
      discard.push(id);
    } else layout.push(id);
    showErr('');
    renderSetup();
  }));
  document.getElementById('reset').onclick = () => { setupPick = { discard: [], layout: [] }; renderSetup(); };
  document.getElementById('confirm').onclick = run(async () => {
    await act({ type: 'setup', ...setupPick });
    setupPick = { discard: [], layout: [] };
  });
}

function renderPlay() {
  const g = data.game;
  const meIdx = g.players.findIndex((p) => p.id === data.you);
  const myTurn = g.phase === 'play' && g.turn === meIdx && !g.pending;
  const isSel = (pi, r, c) => sel.some((s) => s.player === pi && s.row === r && s.col === c);
  const me = g.players[meIdx];

  let banner = '';
  if (g.phase === 'over') banner = `<div class="dealer win"><b>${esc(g.players.find((p) => p.id === g.winner).name)} wins the table.</b><button id="leave2" class="btn gold">Back to tables</button></div>`;
  else if (g.pending && g.pending.defender === meIdx) {
    const t = g.pending.target;
    banner = `<div class="dealer alarm"><b>Incoming on your ${label(me.grid[t.row][t.col])}.</b> Block with a Shield?
      ${g.pending.shields.map((c) => `<button class="btn gold" data-shield="${c}">Block with ${label(me.grid[t.row][c])}</button>`).join('')}
      <button class="btn line" data-shield="">Take the hit</button></div>`;
  } else if (g.pending) banner = `<div class="dealer">${esc(g.players[g.pending.defender].name)} is deciding whether to block…</div>`;

  const seat = (p, pi) => `<section class="opp${pi === g.turn && g.phase === 'play' ? ' turn' : ''}${p.alive ? '' : ' out'}">
      <header><span class="av">${esc(p.name[0].toUpperCase())}</span><b>${esc(p.name)}</b>${p.alive ? '' : '<span class="pill">Out</span>'}${pi === g.turn && g.phase === 'play' ? '<span class="pill hot">Playing</span>' : ''}</header>
      ${p.alive ? `<div class="mini-grid">${p.grid.flatMap((row, r) => row.map((c, col) => cardHtml(c, `data-cell="${pi},${r},${col}" aria-pressed="${isSel(pi, r, col)}"`, isSel(pi, r, col) ? ' sel' : '', true))).join('')}</div>` : ''}
    </section>`;

  const turnName = g.phase === 'play' ? (myTurn ? 'Your move' : `${esc(g.players[g.turn].name)} to play`) : 'Game over';
  const hint = !myTurn ? '' : g.half === 'action'
    ? (sel.length === 0 ? 'Tap one of your front cards' : sel.length === 1 ? 'Now tap a target, or a card holding kills' : 'Pick a move')
    : 'Swap two cards in one layout, or pass';

  page(esc(data.room.name), `<span class="pill${myTurn ? ' hot' : ''}">${turnName}${g.phase === 'play' ? ` · ${g.half}` : ''}</span><button id="logbtn" class="btn line" aria-expanded="false" aria-controls="log">Log</button>`, `
    <main class="felt table">
      <div class="opps" style="--n:${g.players.length - 1}">${g.players.map((p, pi) => (pi === meIdx ? '' : seat(p, pi))).join('')}</div>
      ${banner}
      <section class="mine${myTurn ? ' turn' : ''}${me.alive ? '' : ' out'}">
        ${me.alive ? `<div class="my-grid">${me.grid.flatMap((row, r) => row.map((c, col) => cardHtml(c, `data-cell="${meIdx},${r},${col}" aria-pressed="${isSel(meIdx, r, col)}"`, isSel(meIdx, r, col) ? ' sel' : ''))).join('')}</div>` : '<p class="whisper">You are out. Watch the rest play.</p>'}
      </section>
      ${myTurn ? `<nav class="moves" aria-label="Moves"><span class="hint">${hint}</span>
        ${g.half === 'action' ? '<button id="attack" class="btn gold">Attack</button><button id="res" class="btn gold">Resurrect</button>' : ''}
        <button id="swap" class="btn gold">Swap</button><button id="skip" class="btn line">${g.half === 'action' ? 'Skip to swap' : 'Pass'}</button>
        ${sel.length ? '<button id="clear" class="btn line">Clear</button>' : ''}</nav>` : ''}
      <aside id="log" class="drawer" hidden><h2>Table log</h2><ol>${g.log.slice().reverse().map((l) => `<li>${prettyLog(l)}</li>`).join('') || '<li>No moves yet.</li>'}</ol>
        <p class="tiny">♣ Warrior kills up to double its value · ♦ Archer hits the back row · ♥ Healer revives a captured card · ♠ Shield blocks for its row</p></aside>
    </main>`);

  $app.querySelectorAll('[data-cell]').forEach((el) => (el.onclick = () => {
    const [player, row, col] = el.dataset.cell.split(',').map(Number);
    if (isSel(player, row, col)) sel = sel.filter((s) => !(s.player === player && s.row === row && s.col === col));
    else sel = [...sel.slice(-1), { player, row, col }]; // keep the last two picks
    renderPlay();
  }));
  $app.querySelectorAll('[data-shield]').forEach((b) => (b.onclick = run(() =>
    act({ type: 'shield', col: b.dataset.shield === '' ? null : +b.dataset.shield }))));
  const logBtn = document.getElementById('logbtn'); const log = document.getElementById('log');
  if (logOpen) { log.hidden = false; logBtn.setAttribute('aria-expanded', 'true'); }
  logBtn.onclick = () => { logOpen = log.hidden; log.hidden = !logOpen; logBtn.setAttribute('aria-expanded', String(logOpen)); };

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = run(async () => { await fn(); sel = []; render(); }); };
  const need2 = () => { if (sel.length !== 2) throw new Error('Select two cards'); return sel; };
  const mine = (a) => { if (a.player !== meIdx || a.row !== 0) throw new Error('First pick one of your front-row cards'); };
  on('attack', () => { const [a, t] = need2(); mine(a); return act({ type: 'attack', col: a.col, target: t }); });
  on('res', () => { const [a, s] = need2(); mine(a); return act({ type: 'resurrect', col: a.col, from: s }); });
  on('swap', () => {
    const [a, b] = need2();
    if (a.player !== b.player) throw new Error('Swap within one layout');
    return act({ type: 'swap', player: a.player, a: [a.row, a.col], b: [b.row, b.col] });
  });
  on('skip', () => act({ type: 'skip' }));
  on('clear', () => {});
  const l2 = document.getElementById('leave2');
  if (l2) l2.onclick = () => document.getElementById('leave').click();
}
let logOpen = false;

if (session) connect();
render();
