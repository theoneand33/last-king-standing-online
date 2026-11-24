// Functional client: server browser, room lobby, setup and play. UI is intentionally plain.
const SYM = { C: '♣', D: '♦', H: '♥', S: '♠' };
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
const run = (fn) => async (...args) => {
  $err.textContent = '';
  try { await fn(...args); } catch (e) { $err.textContent = e.message; }
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

// ---------- rendering ----------
const h = (html) => { $app.innerHTML = html; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const label = (c) => (c.kingOf ? `♚${c.rank === 'JK' ? 'Jk' : 'A'}` : `${c.rank}${SYM[c.suit]}`);
const lim = (c) => (c.limit >= 99 ? '∞' : c.limit);

function cardHtml(c, attrs = '', extra = '') {
  if (!c) return `<span class="card empty">-</span>`;
  const red = c.suit === 'D' || c.suit === 'H' ? ' red' : '';
  const top = c.stack?.length ? `, top ${label(c.stack.at(-1))}` : '';
  return `<span class="card${red}${extra}" ${attrs}>${label(c)}<small>lim ${lim(c)}</small>` +
    `<small>kills ${c.stack?.length ?? 0}${top}</small></span>`;
}

function render() {
  clearInterval(browseTimer);
  if (!session) return renderBrowser();
  if (!data) return h('Connecting…');
  if (!data.game) return renderLobby();
  if (data.game.phase === 'setup') return renderSetup();
  renderPlay();
}

async function renderBrowser() {
  const name = localStorage.getItem('lks-name') ?? '';
  const rooms = await api('/api/rooms').catch(() => []);
  if (session) return; // joined while loading
  h(`<p><label>Your name <input id="name" value="${esc(name)}"></label></p>
    <p><label>New room <input id="room" placeholder="Room name"></label>
      <select id="max">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select> players
      <button id="create">Create</button></p>
    <h2>Rooms</h2>
    ${rooms.length ? '' : '<p>No rooms yet.</p>'}
    <ul>${rooms.map((r) => `<li>${esc(r.name)} — ${r.players.length}/${r.max} — ${r.status}
      (${r.players.map(esc).join(', ')})
      ${r.status === 'lobby' && r.players.length < r.max ? `<button data-join="${r.id}">Join</button>` : ''}</li>`).join('')}</ul>`);
  const nameVal = () => { const v = document.getElementById('name').value; localStorage.setItem('lks-name', v); return v; };
  document.getElementById('create').onclick = run(async () => {
    const res = await api('/api/rooms', { name: nameVal(), room: document.getElementById('room').value, max: +document.getElementById('max').value });
    save(res); connect(); render();
  });
  $app.querySelectorAll('[data-join]').forEach((b) => (b.onclick = run(async () => {
    const res = await api(`/api/rooms/${b.dataset.join}/join`, { name: nameVal() });
    save(res); connect(); render();
  })));
  browseTimer = setInterval(() => document.activeElement?.tagName !== 'INPUT' && render(), 3000);
}

function leaveButton() {
  return `<button id="leave">Leave room</button>`;
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
  h(`<h2>${esc(room.name)}</h2><p>Players (${room.players.length}/${room.max}): ${room.players.map(esc).join(', ')}</p>
    ${room.host === you ? '<button id="start">Start game</button>' : '<p>Waiting for the host to start…</p>'}
    ${leaveButton()}`);
  const s = document.getElementById('start');
  if (s) s.onclick = run(() => api(`/api/rooms/${session.room}/start`, {}));
  wireLeave();
}

function renderSetup() {
  const me = data.game.players.find((p) => p.id === data.you);
  if (!me.alive || me.ready) {
    h(`<p>Waiting for others to lay out their cards…</p>${leaveButton()}`);
    return wireLeave();
  }
  const pool = [me.king, ...me.hand];
  const { discard, layout } = setupPick;
  const step = discard.length < 2 ? 'Step 1: click 2 cards to discard.' :
    'Step 2: click the remaining 6 in order — front row left→right, then back row left→right.';
  h(`<p>${step}</p>
    <p>${pool.map((c) => {
      const used = discard.includes(c.id) || layout.includes(c.id);
      return cardHtml(c, `data-id="${c.id}"`, used ? ' sel' : '');
    }).join('')}</p>
    <p>Discard: ${discard.join(', ') || '—'}<br>Front: ${layout.slice(0, 3).join(' ') || '—'}<br>Back: ${layout.slice(3).join(' ') || '—'}</p>
    <button id="reset">Reset</button>
    <button id="confirm" ${layout.length === 6 ? '' : 'disabled'}>Confirm layout</button> ${leaveButton()}`);
  $app.querySelectorAll('[data-id]').forEach((el) => (el.onclick = () => {
    const id = el.dataset.id;
    if (discard.includes(id) || layout.includes(id)) return;
    if (discard.length < 2) {
      if (id === me.king.id) return void ($err.textContent = 'You cannot discard your King');
      discard.push(id);
    } else layout.push(id);
    $err.textContent = '';
    renderSetup();
  }));
  document.getElementById('reset').onclick = () => { setupPick = { discard: [], layout: [] }; renderSetup(); };
  document.getElementById('confirm').onclick = run(async () => {
    await act({ type: 'setup', ...setupPick });
    setupPick = { discard: [], layout: [] };
  });
  wireLeave();
}

function renderPlay() {
  const g = data.game;
  const meIdx = g.players.findIndex((p) => p.id === data.you);
  const myTurn = g.phase === 'play' && g.turn === meIdx && !g.pending;
  const isSel = (pi, r, c) => sel.some((s) => s.player === pi && s.row === r && s.col === c);

  let status;
  if (g.phase === 'over') status = `<b>${esc(g.players.find((p) => p.id === g.winner).name)} wins!</b>`;
  else if (g.pending) status = `${esc(g.players[g.pending.defender].name)} may shield the attack…`;
  else status = `${esc(g.players[g.turn].name)}'s turn — ${g.half} half`;

  let controls = '';
  if (g.pending && g.pending.defender === meIdx) {
    const t = g.pending.target;
    const target = g.players[meIdx].grid[t.row][t.col];
    controls = `<p>Your ${label(target)} is attacked. Shield with:
      ${g.pending.shields.map((c) => `<button data-shield="${c}">${label(g.players[meIdx].grid[t.row][c])}</button>`).join('')}
      <button data-shield="">No shield</button></p>`;
  } else if (myTurn) {
    controls = `<p>Select cards, then:
      ${g.half === 'action' ? '<button id="attack">Attack</button> <button id="res">Resurrect</button>' : ''}
      <button id="swap">Swap</button> <button id="skip">Skip ${g.half} half</button>
      <button id="clear">Clear selection</button></p>
      <p><small>Attack: your front card, then a target. Resurrect: your front ♥, then any card with kills.
      Swap: two cards in one grid.</small></p>`;
  }

  h(`<p>${status}</p>${controls}
    ${g.players.map((p, pi) => `<div class="player${pi === g.turn && g.phase === 'play' ? ' turn' : ''}${p.alive ? '' : ' out'}">
      <b>${esc(p.name)}${pi === meIdx ? ' (you)' : ''}</b>${p.alive ? '' : ' — out'}
      ${p.grid ? p.grid.map((row, r) => `<div>${r ? 'Back ' : 'Front'} ${row.map((c, col) =>
        cardHtml(c, `data-cell="${pi},${r},${col}"`, isSel(pi, r, col) ? ' sel' : '')).join('')}</div>`).join('') : ''}
    </div>`).join('')}
    <details><summary>Log</summary><pre>${g.log.map(esc).join('\n')}</pre></details>
    ${leaveButton()}`);

  $app.querySelectorAll('[data-cell]').forEach((el) => (el.onclick = () => {
    const [player, row, col] = el.dataset.cell.split(',').map(Number);
    if (isSel(player, row, col)) sel = sel.filter((s) => !(s.player === player && s.row === row && s.col === col));
    else sel = [...sel.slice(-1), { player, row, col }]; // keep the last two picks
    renderPlay();
  }));
  $app.querySelectorAll('[data-shield]').forEach((b) => (b.onclick = run(() =>
    act({ type: 'shield', col: b.dataset.shield === '' ? null : +b.dataset.shield }))));

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = run(async () => { await fn(); sel = []; }); };
  const need2 = () => { if (sel.length !== 2) throw new Error('Select two cards'); return sel; };
  const mine = (a) => { if (a.player !== meIdx || a.row !== 0) throw new Error('First pick one of your front-row cards'); };
  on('attack', () => { const [a, t] = need2(); mine(a); return act({ type: 'attack', col: a.col, target: t }); });
  on('res', () => { const [a, s] = need2(); mine(a); return act({ type: 'resurrect', col: a.col, from: s }); });
  on('swap', () => {
    const [a, b] = need2();
    if (a.player !== b.player) throw new Error('Swap within one grid');
    return act({ type: 'swap', player: a.player, a: [a.row, a.col], b: [b.row, b.col] });
  });
  on('skip', () => act({ type: 'skip' }));
  on('clear', () => { renderPlay(); });
  wireLeave();
}

if (session) connect();
render();
