// Last King Standing rules engine. Pure state machine, no I/O.
// Every illegal move throws an Error whose message is safe to show players.

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['C', 'D', 'H', 'S']; // ♣ Warrior, ♦ Archer, ♥ Healer, ♠ Shield
export const MAX_PLAYERS = 10;
const PER_DECK = 6; // a deck holds 4 aces + 2 jokers as Kings, and 48 cards deal 7 to 6 players
export const UNLIMITED = 99; // above any card value (max 13); survives JSON, unlike Infinity

export const value = (card) => (card.kingOf ? 1 : RANKS.indexOf(card.rank) + 2);

const fail = (msg) => { throw new Error(msg); };
const pos = (x, size, what) =>
  Number.isInteger(x) && x >= 0 && x < size ? x : fail(`Bad ${what}`);
const emptyGrid = () => [[null, null, null], [null, null, null]];
const cardsIn = (grid) => grid.flat().filter(Boolean);

const tag = (d) => (d ? `-${d + 1}` : ''); // keeps card ids unique across decks

// The deal deck: no aces or jokers, those are only ever Kings.
export function newDeck(decks = 1) {
  return Array.from({ length: decks }, (_, d) =>
    SUITS.flatMap((suit) => RANKS.map((rank) => ({ id: rank + suit + tag(d), rank, suit })))).flat();
}

// One ace per player, then jokers once the aces run out.
function kings(decks) {
  const ids = (names) => Array.from({ length: decks }, (_, d) => names.map((n) => n + tag(d))).flat();
  return [...ids(['AC', 'AD', 'AH', 'AS']).map((id) => [id, 'A']), ...ids(['JK1', 'JK2']).map((id) => [id, 'JK'])];
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A Warrior (♣) doubles its value. Kings start unlimited, but this applies to one resurrected later.
const faceLimit = (card) => (card.suit === 'C' ? 2 : 1) * value(card);

function makeCard({ id, rank, suit }) {
  const card = { id, rank, suit, kingOf: null, limit: 0, stack: [], sick: -1 };
  card.limit = faceLimit(card);
  return card;
}

/** players: [{id, name}] in clockwise seat order. deck: optional deal order (tests). */
export function createGame(players, { deck } = {}) {
  if (players.length < 2 || players.length > MAX_PLAYERS) fail(`Need 2–${MAX_PLAYERS} players`);
  const decks = Math.ceil(players.length / PER_DECK);
  const pile = (deck ?? shuffle(newDeck(decks))).map(makeCard);
  const kingCards = kings(decks);
  return {
    phase: 'setup', // setup → play → over
    turn: 0, // seat index whose turn it is
    half: 'action', // action → swap
    turnNo: 0,
    pending: null, // an attack waiting for the defender's shield decision
    winner: null,
    log: [],
    players: players.map((p, i) => ({
      id: p.id,
      name: p.name,
      alive: true,
      ready: false,
      hand: pile.splice(0, 7),
      king: {
        id: kingCards[i][0], rank: kingCards[i][1], suit: null, kingOf: p.id,
        limit: UNLIMITED, stack: [], sick: -1,
      },
      grid: null,
    })),
  };
}

/** Apply one player's action. Mutates g. Throws on illegal moves. */
export function act(g, playerId, a) {
  const pi = g.players.findIndex((p) => p.id === playerId);
  if (pi < 0) fail('Not in this game');
  if (!a || typeof a !== 'object') fail('Bad action');
  const me = g.players[pi];
  if (!me.alive) fail('You are out');

  if (g.phase === 'setup') {
    if (a.type !== 'setup') fail('Lay out your cards first');
    return setup(g, me, a);
  }
  if (g.phase !== 'play') fail('Game is over');

  if (g.pending) {
    if (a.type !== 'shield' || pi !== g.pending.defender) fail('Waiting for a shield decision');
    resolveShield(g, a.col);
    return advance(g);
  }
  if (pi !== g.turn) fail('Not your turn');

  switch (a.type) {
    case 'skip': break;
    case 'swap': swap(g, a); break;
    case 'attack':
      if (g.half !== 'action') fail('Only swaps in the swap half');
      if (attack(g, pi, a)) return; // paused for a shield decision
      break;
    case 'resurrect':
      if (g.half !== 'action') fail('Only swaps in the swap half');
      resurrect(g, pi, a);
      break;
    default: fail('Unknown action');
  }
  advance(g);
}

function setup(g, me, { discard, layout }) {
  if (me.ready) fail('Already laid out');
  if (!Array.isArray(discard) || !Array.isArray(layout)) fail('Bad layout');
  if (discard.length !== 2 || new Set(discard).size !== 2) fail('Discard exactly 2 cards');
  const keep = me.hand.filter((c) => !discard.includes(c.id));
  if (keep.length !== 5) fail('Discards must come from your hand');
  const pool = [me.king, ...keep];
  if (layout.length !== 6 || new Set(layout).size !== 6) fail('Lay out your King and 5 cards');
  const cards = layout.map((id) => pool.find((c) => c.id === id) ?? fail('Unknown card in layout'));
  me.grid = [cards.slice(0, 3), cards.slice(3)];
  me.hand = [];
  me.ready = true;
  if (g.players.every((p) => p.ready || !p.alive)) {
    g.phase = 'play';
    g.turn = g.players.findIndex((p) => p.alive);
  }
}

function attack(g, pi, a) {
  const me = g.players[pi];
  const col = pos(a.col, 3, 'attacker');
  const atk = me.grid[0][col] ?? fail('No card there');
  if (atk.suit === 'H') fail('Healers cannot attack');
  if (atk.sick === g.turnNo) fail('A resurrected card acts from your next turn');

  const ti = pos(a.target?.player, g.players.length, 'target player');
  const t = g.players[ti];
  if (ti === pi || !t.alive) fail('Pick a living opponent');
  const tr = pos(a.target.row, 2, 'target row');
  const tc = pos(a.target.col, 3, 'target column');
  const victim = t.grid[tr][tc] ?? fail('No card there');

  const backEmpty = t.grid[1].every((c) => !c);
  if (atk.suit === 'D') {
    if (tr !== (backEmpty ? 0 : 1)) fail('Archers hit the back row (front only once it is empty)');
  } else if (tr !== 0) fail('Only front-row targets');
  if (value(victim) > atk.limit) fail(`Above this card's limit (${atk.limit})`);
  if (victim.kingOf === t.id && cardsIn(t.grid).length > 1 && atk.stack.length < 3)
    fail('The King is protected until its owner has no other cards, or you have 3+ kills');

  const shields = [0, 1, 2].filter((c) => c !== tc && t.grid[tr][c]?.suit === 'S');
  if (shields.length) {
    g.pending = { attacker: { player: pi, col }, target: { player: ti, row: tr, col: tc }, defender: ti, shields };
    return true;
  }
  kill(g, atk, ti, tr, tc);
  return false;
}

function resolveShield(g, col) {
  const { attacker, target, shields } = g.pending;
  if (col != null && !shields.includes(col)) fail('That card cannot shield');
  g.pending = null;
  const atk = g.players[attacker.player].grid[0][attacker.col];
  kill(g, atk, target.player, target.row, col ?? target.col);
}

function kill(g, atk, ti, r, c) {
  const t = g.players[ti];
  const victim = t.grid[r][c];
  t.grid[r][c] = null;
  if (r === 0) [t.grid[0][c], t.grid[1][c]] = [t.grid[1][c], null]; // card behind moves up
  victim.stack = []; // the victim's own kills leave the game
  atk.stack.push(victim);
  atk.limit = Math.min(atk.limit, value(victim) - 1);
  g.log.push(`${atk.id} killed ${t.name}'s ${victim.id}`);
  if (victim.kingOf === t.id) eliminate(g, ti);
}

function resurrect(g, pi, a) {
  const me = g.players[pi];
  const col = pos(a.col, 3, 'healer');
  const healer = me.grid[0][col];
  if (healer?.suit !== 'H') fail('Pick a front-row ♥');
  if (healer.sick === g.turnNo) fail('A resurrected card acts from your next turn');
  const oi = pos(a.from?.player, g.players.length, 'stack owner');
  const owner = g.players[oi];
  if (!owner.alive) fail('That player is out');
  const holder = owner.grid[pos(a.from.row, 2, 'stack row')][pos(a.from.col, 3, 'stack column')];
  if (!holder?.stack.length) fail('That card has no stack');

  const back = holder.stack.pop();
  back.sick = g.turnNo;
  back.limit = faceLimit(back); // a fresh limit: face value, ♣ doubled, a King 1
  me.grid[0][col] = back;
  holder.stack.push(healer);
  holder.limit = Math.min(holder.limit, value(healer) - 1);
  g.log.push(`${me.name}'s ${healer.id} resurrected ${back.id} from ${holder.id}`);
}

function swap(g, a) {
  const p = g.players[pos(a.player, g.players.length, 'player')];
  if (!p.alive) fail('That player is out');
  const [r1, c1] = [pos(a.a?.[0], 2, 'row'), pos(a.a?.[1], 3, 'column')];
  const [r2, c2] = [pos(a.b?.[0], 2, 'row'), pos(a.b?.[1], 3, 'column')];
  if (!p.grid[r1][c1] || !p.grid[r2][c2]) fail('Swap two living cards');
  if (r1 === r2 && c1 === c2) fail('Pick two different cards');
  [p.grid[r1][c1], p.grid[r2][c2]] = [p.grid[r2][c2], p.grid[r1][c1]];
  g.log.push(`${g.players[g.turn].name} swapped ${p.grid[r1][c1].id} and ${p.grid[r2][c2].id}`);
}

function eliminate(g, ti) {
  const t = g.players[ti];
  t.alive = false;
  t.grid = emptyGrid(); // remaining cards leave the game
  g.log.push(`${t.name} is out`);
  const alive = g.players.filter((p) => p.alive);
  if (alive.length === 1) {
    g.phase = 'over';
    g.winner = alive[0].id;
    g.pending = null;
  }
}

function advance(g) {
  if (g.phase !== 'play') return;
  if (g.half === 'action') { g.half = 'swap'; return; }
  nextTurn(g);
}

function nextTurn(g) {
  g.half = 'action';
  g.turnNo++;
  do g.turn = (g.turn + 1) % g.players.length; while (!g.players[g.turn].alive);
}

/** A player leaves: they are out. Keeps the game moving if it was waiting on them. */
export function forfeit(g, playerId) {
  const ti = g.players.findIndex((p) => p.id === playerId);
  if (ti < 0 || !g.players[ti].alive || g.phase === 'over') return;
  const wasTurn = g.phase === 'play' && g.turn === ti;
  const wasPending = g.pending;
  g.pending = null; // a pending attack fizzles
  eliminate(g, ti);
  if (g.phase === 'setup' && g.players.every((p) => p.ready || !p.alive)) {
    g.phase = 'play';
    g.turn = g.players.findIndex((p) => p.alive);
  } else if (wasTurn) nextTurn(g);
  else if (wasPending) advance(g); // the defender left: the attacker moves on to the swap half
}

/** What one player may see: during setup, other players' hands and layouts are hidden. */
export function view(g, playerId) {
  const v = structuredClone(g);
  for (const p of v.players) {
    if (g.phase === 'setup' && p.id !== playerId) {
      p.hand = p.hand.length;
      p.grid = null;
    }
  }
  v.log = v.log.slice(-30);
  return v;
}
