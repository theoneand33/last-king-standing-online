// Last King Standing rules engine. Pure state machine, no I/O.
// Every illegal move throws an Error whose message is safe to show players.

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['C', 'D', 'H', 'S'] as const; // ♣ Warrior, ♦ Archer, ♥ Healer, ♠ Shield
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
const PER_DECK = 6; // a deck holds 4 aces + 2 jokers as Kings, and 48 cards deal 7 to 6 players
export const UNLIMITED = 99; // above any card value (max 13); survives JSON, unlike Infinity

export type Suit = (typeof SUITS)[number];
export type Card = {
  id: string;
  face: string; // the printed card, id without the deck tag: 7D, AH, JK1
  rank: string;
  suit: Suit | null; // null for Kings
  kingOf: string | null; // owner's player id, for Kings
  limit: number;
  stack: Card[];
  sick: number; // turnNo it was resurrected on
};
type Slot = Card | null;
export type Grid = [Slot[], Slot[]]; // front row, back row; 3 columns each
export type Cell = { player: number; row: number; col: number };
export type Player = {
  id: string;
  name: string;
  alive: boolean;
  ready: boolean;
  hand: Card[];
  king: Card;
  grid: Grid | null; // null until laid out
};
/** A card as the log names it. */
export type CardName = Pick<Card, 'rank' | 'suit'>;
/** Seats are indexes into Game.players. */
export type LogEvent =
  | { type: 'kill'; player: number; card: CardName; kills: number; owner: number; victim: CardName }
  | { type: 'resurrect'; player: number; healer: CardName; card: CardName; from: CardName }
  | { type: 'swap'; player: number; a: CardName; b: CardName }
  | { type: 'out'; player: number };
export type Pending = { attacker: { player: number; col: number }; target: Cell; defender: number; shields: number[] };
export type Game = {
  phase: 'setup' | 'play' | 'over';
  turn: number; // seat index whose turn it is
  half: 'action' | 'swap';
  turnNo: number;
  pending: Pending | null; // an attack waiting for the defender's shield decision
  winner: string | null;
  log: LogEvent[];
  players: Player[];
};
// Action fields arrive as untrusted JSON; the engine validates each one.
export type Action =
  | { type: 'setup'; discard: string[]; layout: string[] }
  | { type: 'skip' }
  | { type: 'swap'; player: number; a: [number, number]; b: [number, number] }
  | { type: 'attack'; col: number; target: Cell }
  | { type: 'resurrect'; col: number; from: Cell }
  | { type: 'shield'; col: number | null };
/** What one player sees: during setup, others' hands are a count and their grids hidden.
 * `log` is the tail of the game's log; `logStart` is the index of its first event in the whole log. */
export type GameView = Omit<Game, 'players'> & { logStart: number; players: (Omit<Player, 'hand'> & { hand: Card[] | number })[] };

export const value = (card: Card) => (card.kingOf ? 1 : RANKS.indexOf(card.rank) + 2);

function fail(msg: string): never { throw new Error(msg); }
const pos = (x: unknown, size: number, what: string) =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) < size ? (x as number) : fail(`Bad ${what}`);
const emptyGrid = (): Grid => [[null, null, null], [null, null, null]];
const cardsIn = (grid: Grid) => grid.flat().filter(Boolean);
// Only called once play has started, when every living player has laid out.
const gridOf = (p: Player) => p.grid ?? fail('Not laid out yet');

const tag = (d: number) => (d ? `-${d + 1}` : ''); // keeps card ids unique across decks
const name = (c: Card): CardName => ({ rank: c.rank, suit: c.suit });

type DealCard = { id: string; face: string; rank: string; suit: Suit };

// The deal deck: no aces or jokers, those are only ever Kings.
export function newDeck(decks = 1): DealCard[] {
  return Array.from({ length: decks }, (_, d) =>
    SUITS.flatMap((suit) => RANKS.map((rank) => ({ id: rank + suit + tag(d), face: rank + suit, rank, suit })))).flat();
}

// One ace per player, then jokers once the aces run out.
function kings(decks: number) {
  const all = (faces: string[], rank: string) =>
    Array.from({ length: decks }, (_, d) => faces.map((face) => ({ id: face + tag(d), face, rank }))).flat();
  return [...all(SUITS.map((s) => 'A' + s), 'A'), ...all(['JK1', 'JK2'], 'JK')];
}

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A Warrior (♣) doubles its value. Kings start unlimited, but this applies to one resurrected later.
const faceLimit = (card: Card) => (card.suit === 'C' ? 2 : 1) * value(card);

function makeCard({ id, face, rank, suit }: DealCard): Card {
  const card: Card = { id, face, rank, suit, kingOf: null, limit: 0, stack: [], sick: -1 };
  card.limit = faceLimit(card);
  return card;
}

/** players: [{id, name}] in clockwise seat order. deck: optional deal order (tests). */
export function createGame(players: { id: string; name: string }[], { deck }: { deck?: DealCard[] } = {}): Game {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) fail(`Need ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  const decks = Math.ceil(players.length / PER_DECK);
  const pile = (deck ?? shuffle(newDeck(decks))).map(makeCard);
  const kingCards = kings(decks);
  return {
    phase: 'setup', // setup → play → over
    turn: 0,
    half: 'action', // action → swap
    turnNo: 0,
    pending: null,
    winner: null,
    log: [],
    players: players.map((p, i) => ({
      id: p.id,
      name: p.name,
      alive: true,
      ready: false,
      hand: pile.splice(0, 7),
      king: { ...kingCards[i], suit: null, kingOf: p.id, limit: UNLIMITED, stack: [], sick: -1 },
      grid: null,
    })),
  };
}

/** Apply one player's action. Mutates g. Throws on illegal moves. */
export function act(g: Game, playerId: string, a: Action) {
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
  if ((a.type === 'attack' || a.type === 'resurrect') && g.half !== 'action') fail('Only swaps in the swap half');

  switch (a.type) {
    case 'skip': break;
    case 'swap': swap(g, a); break;
    case 'attack':
      if (attack(g, pi, a)) return; // paused for a shield decision
      break;
    case 'resurrect': resurrect(g, pi, a); break;
    default: fail('Unknown action');
  }
  advance(g);
}

function setup(g: Game, me: Player, { discard, layout }: { discard: unknown; layout: unknown }) {
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
  startIfAllReady(g);
}

function startIfAllReady(g: Game) {
  if (g.phase !== 'setup' || !g.players.every((p) => p.ready || !p.alive)) return false;
  g.phase = 'play';
  g.turn = g.players.findIndex((p) => p.alive);
  return true;
}

function attack(g: Game, pi: number, a: Extract<Action, { type: 'attack' }>) {
  const me = gridOf(g.players[pi]);
  const col = pos(a.col, 3, 'attacker');
  const atk = me[0][col] ?? fail('No card there');
  if (atk.suit === 'H') fail('Healers cannot attack');
  if (atk.sick === g.turnNo) fail('A resurrected card acts from your next turn');

  const ti = pos(a.target?.player, g.players.length, 'target player');
  const t = g.players[ti];
  if (ti === pi || !t.alive) fail('Pick a living opponent');
  const grid = gridOf(t);
  const tr = pos(a.target.row, 2, 'target row');
  const tc = pos(a.target.col, 3, 'target column');
  const victim = grid[tr][tc] ?? fail('No card there');

  const backEmpty = grid[1].every((c) => !c);
  if (atk.suit === 'D') {
    if (tr !== (backEmpty ? 0 : 1)) fail('Archers hit the back row (front only once it is empty)');
  } else if (tr !== 0) fail('Only front-row targets');
  if (value(victim) > atk.limit) fail(`Above this card's limit (${atk.limit})`);
  if (victim.kingOf === t.id && cardsIn(grid).length > 1 && atk.stack.length < 3)
    fail('The King is protected until its owner has no other cards, or you have 3+ kills');

  const shields = [0, 1, 2].filter((c) => c !== tc && grid[tr][c]?.suit === 'S');
  if (shields.length) {
    g.pending = { attacker: { player: pi, col }, target: { player: ti, row: tr, col: tc }, defender: ti, shields };
    return true;
  }
  kill(g, pi, atk, ti, tr, tc);
  return false;
}

function resolveShield(g: Game, col: number | null | undefined) {
  const { attacker, target, shields } = g.pending!;
  if (col != null && !shields.includes(col)) fail('That card cannot shield');
  g.pending = null;
  const atk = gridOf(g.players[attacker.player])[0][attacker.col]!;
  kill(g, attacker.player, atk, target.player, target.row, col ?? target.col);
}

function kill(g: Game, pi: number, atk: Card, ti: number, r: number, c: number) {
  const t = g.players[ti];
  const grid = gridOf(t);
  const victim = grid[r][c]!;
  grid[r][c] = null;
  if (r === 0) [grid[0][c], grid[1][c]] = [grid[1][c], null]; // card behind moves up
  victim.stack = []; // the victim's own kills leave the game
  atk.stack.push(victim);
  atk.limit = Math.min(atk.limit, value(victim) - 1);
  g.log.push({ type: 'kill', player: pi, card: name(atk), kills: atk.stack.length, owner: ti, victim: name(victim) });
  if (victim.kingOf === t.id) eliminate(g, ti);
}

function resurrect(g: Game, pi: number, a: Extract<Action, { type: 'resurrect' }>) {
  const me = g.players[pi];
  const grid = gridOf(me);
  const col = pos(a.col, 3, 'healer');
  const healer = grid[0][col];
  if (healer?.suit !== 'H') fail('Pick a front-row ♥');
  if (healer.sick === g.turnNo) fail('A resurrected card acts from your next turn');
  const oi = pos(a.from?.player, g.players.length, 'stack owner');
  const owner = g.players[oi];
  if (!owner.alive) fail('That player is out');
  const holder = gridOf(owner)[pos(a.from.row, 2, 'stack row')][pos(a.from.col, 3, 'stack column')];
  if (!holder?.stack.length) fail('That card has no stack');

  const back = holder.stack.pop()!;
  back.sick = g.turnNo;
  back.limit = faceLimit(back);
  grid[0][col] = back;
  holder.stack.push(healer);
  holder.limit = Math.min(holder.limit, value(healer) - 1);
  g.log.push({ type: 'resurrect', player: pi, healer: name(healer), card: name(back), from: name(holder) });
}

function swap(g: Game, a: Extract<Action, { type: 'swap' }>) {
  const p = g.players[pos(a.player, g.players.length, 'player')];
  if (!p.alive) fail('That player is out');
  const grid = gridOf(p);
  const [r1, c1] = [pos(a.a?.[0], 2, 'row'), pos(a.a?.[1], 3, 'column')];
  const [r2, c2] = [pos(a.b?.[0], 2, 'row'), pos(a.b?.[1], 3, 'column')];
  if (!grid[r1][c1] || !grid[r2][c2]) fail('Swap two living cards');
  if (r1 === r2 && c1 === c2) fail('Pick two different cards');
  [grid[r1][c1], grid[r2][c2]] = [grid[r2][c2], grid[r1][c1]];
  g.log.push({ type: 'swap', player: g.turn, a: name(grid[r1][c1]!), b: name(grid[r2][c2]!) });
}

function eliminate(g: Game, ti: number) {
  const t = g.players[ti];
  t.alive = false;
  t.grid = emptyGrid(); // remaining cards leave the game
  g.log.push({ type: 'out', player: ti });
  const alive = g.players.filter((p) => p.alive);
  if (alive.length === 1) {
    g.phase = 'over';
    g.winner = alive[0].id;
    g.pending = null;
  }
}

function advance(g: Game) {
  if (g.phase !== 'play') return;
  if (g.half === 'action') { g.half = 'swap'; return; }
  nextTurn(g);
}

function nextTurn(g: Game) {
  g.half = 'action';
  g.turnNo++;
  do g.turn = (g.turn + 1) % g.players.length; while (!g.players[g.turn].alive);
}

/** A player leaves: they are out. Keeps the game moving if it was waiting on them. */
export function forfeit(g: Game, playerId: string) {
  const ti = g.players.findIndex((p) => p.id === playerId);
  if (ti < 0 || !g.players[ti].alive || g.phase === 'over') return;
  const wasTurn = g.phase === 'play' && g.turn === ti;
  const wasPending = g.pending?.defender === ti;
  if (wasTurn || wasPending) g.pending = null; // an attack fizzles only if its attacker (whose turn it is) or defender left
  eliminate(g, ti);
  if (startIfAllReady(g)) return;
  if (wasTurn) nextTurn(g);
  else if (wasPending) advance(g); // the defender left: the attacker moves on to the swap half
}

const LOG_TAIL = 30;

/** What one player may see: during setup, other players' hands and layouts are hidden. */
export function view(g: Game, playerId: string | undefined): GameView {
  const logStart = Math.max(0, g.log.length - LOG_TAIL);
  const v: GameView = { ...structuredClone({ ...g, log: g.log.slice(logStart) }), logStart };
  for (const p of v.players) {
    if (g.phase === 'setup' && p.id !== playerId) {
      p.hand = (p.hand as Card[]).length;
      p.grid = null;
    }
  }
  return v;
}
