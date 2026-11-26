import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, forfeit, view, newDeck, type Game, type Grid } from '../src/game.ts';

// Build a game in play phase. layouts: per player, 6 ids, front row first; 'K' = that player's King.
function game(...layouts: string[][]) {
  const used = new Set(layouts.flat());
  const filler = newDeck().filter((c) => !used.has(c.id));
  const byId = Object.fromEntries(newDeck().map((c) => [c.id, c]));
  const deck = layouts.flatMap((l) => [...l.filter((id) => id !== 'K').map((id) => byId[id]), filler.pop()!, filler.pop()!]);
  const players = layouts.map((_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const g = createGame(players, { deck });
  g.players.forEach((p, i) => {
    const discard = p.hand.slice(5).map((c) => c.id);
    act(g, p.id, { type: 'setup', discard, layout: layouts[i].map((id) => (id === 'K' ? p.king.id : id)) });
  });
  return g;
}
const at = (g: Game, pi: number, r: number, c: number) => (g.players[pi].grid as Grid)[r][c]!;
const attack = (g: Game, pid: string, col: number, player: number, row: number, tcol: number) => act(g, pid, { type: 'attack', col, target: { player, row, col: tcol } });
const skip = (g: Game, pid: string) => act(g, pid, { type: 'skip' });

test('setup hides other hands, then starts play', () => {
  const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  assert.equal(g.players[0].hand.length, 7);
  assert.equal(view(g, 'a').players[1].hand, 7);
  assert.throws(() => act(g, 'a', { type: 'setup', discard: [g.players[0].hand[0].id], layout: [] }), /Discard exactly 2/);
  for (const p of g.players) {
    act(g, p.id, { type: 'setup', discard: p.hand.slice(0, 2).map((c) => c.id), layout: [p.king.id, ...p.hand.slice(2).map((c) => c.id)] });
  }
  assert.equal(g.phase, 'play');
  assert.equal(at(g, 0, 0, 0).kingOf, 'a');
});

test('attacks, limits and row movement', () => {
  const g = game(['9C', '7H', '2H', 'K', '3H', '4H'], ['9S', '5D', '2D', 'K', '8D', '3D']);
  assert.throws(() => attack(g, 'p0', 1, 1, 0, 1), /Healers cannot attack/);
  attack(g, 'p0', 0, 1, 0, 0); // 9♣ (limit 18) kills 9♠ → limit 8
  assert.equal(at(g, 0, 0, 0).limit, 8);
  assert.deepEqual(g.log, [{ type: 'kill', player: 0, card: { rank: '9', suit: 'C' }, kills: 1, owner: 1, victim: { rank: '9', suit: 'S' } }]);
  assert.equal(at(g, 1, 0, 0).kingOf, 'p1', 'King moved up');
  assert.equal(at(g, 1, 1, 0), null);
  assert.equal(g.half, 'swap');
  skip(g, 'p0');
  assert.equal(g.turn, 1);
  skip(g, 'p1'); skip(g, 'p1');
  attack(g, 'p0', 0, 1, 0, 1); // kills 5♦ → limit 4
  assert.equal(at(g, 0, 0, 0).limit, 4);
  assert.equal(at(g, 1, 0, 1).id, '8D');
  skip(g, 'p0'); skip(g, 'p1'); skip(g, 'p1');
  assert.throws(() => attack(g, 'p0', 0, 1, 0, 1), /Above this card's limit/);
});

test('archers hit the back row, front only when back is empty', () => {
  const g = game(['5D', '2H', '3H', 'K', '4H', '6H'], ['2C', '3C', '4C', 'K', '5H', '3S']);
  assert.throws(() => attack(g, 'p0', 0, 1, 0, 0), /Archers/);
  attack(g, 'p0', 0, 1, 1, 2); // 3♠ in back row, no other ♠ in that row
  assert.equal(at(g, 1, 1, 2), null, 'back-row spot stays empty');
});

test('a ♠ in the same row can take the hit, even from the back row', () => {
  const g = game(['9S', '2H', '3H', 'K', '4H', '6H'], ['5C', '3C', 'QS', 'K', '7D', '8D']);
  attack(g, 'p0', 0, 1, 0, 0); // 9 attacks 5♣ (limit check uses value 5)
  assert.deepEqual(g.pending?.shields, [2]);
  assert.throws(() => skip(g, 'p0'), /Waiting for a shield/);
  act(g, 'p1', { type: 'shield', col: 2 });
  assert.equal(at(g, 0, 0, 0).stack[0].id, 'QS');
  assert.equal(at(g, 0, 0, 0).limit, 9, 'Q♠ worth 12 leaves limit 9');
  assert.equal(at(g, 1, 0, 2).id, '8D', 'card behind the shield moves up');
  assert.equal(g.half, 'swap');
});

test('King protection, capture and win', () => {
  const g = game(['KS', '2H', '3H', '4H', '5H', 'K'], ['K', 'QC', 'JC', '2D', '10D', '9D']);
  assert.throws(() => attack(g, 'p0', 0, 1, 0, 0), /King is protected/);
  for (const col of [1, 2, 1]) { // Q♣, J♣, then 10♦ which moved up
    attack(g, 'p0', 0, 1, 0, col);
    skip(g, 'p0'); skip(g, 'p1'); skip(g, 'p1');
  }
  assert.equal(at(g, 0, 0, 0).stack.length, 3);
  attack(g, 'p0', 0, 1, 0, 0); // 3+ kills → may hit the King
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p0');
  assert.equal(at(g, 0, 0, 0).limit, 0);
});

test('resurrect brings a card back on your side and keeps the stack holder lower limit', () => {
  const g = game(['KC', '9H', '2H', 'K', '3H', '4H'], ['7S', '5D', '2D', 'K', '8D', '3D']);
  attack(g, 'p0', 0, 1, 0, 0); // K♣ kills 7♠ → limit 6
  skip(g, 'p0');
  skip(g, 'p1'); skip(g, 'p1');
  act(g, 'p0', { type: 'resurrect', col: 1, from: { player: 0, row: 0, col: 0 } }); // 9♥ ↔ 7♠
  assert.equal(at(g, 0, 0, 1).id, '7S');
  assert.equal(at(g, 0, 0, 1).limit, 7, 'returns with its face number as its limit');
  assert.equal(at(g, 0, 0, 0).stack.at(-1)?.id, '9H');
  assert.equal(at(g, 0, 0, 0).limit, 6, '9♥ − 1 = 8 is higher, limit stays 6');
  assert.equal(g.half, 'swap');
});

test('swap within one grid, either player, during either half', () => {
  const g = game(['KC', '9H', '2H', 'K', '3H', '4H'], ['7S', '5D', '2D', 'K', '8D', '3D']);
  act(g, 'p0', { type: 'swap', player: 1, a: [0, 0], b: [1, 0] });
  assert.equal(at(g, 1, 0, 0).kingOf, 'p1');
  act(g, 'p0', { type: 'swap', player: 0, a: [0, 0], b: [0, 1] });
  assert.equal(at(g, 0, 0, 1).id, 'KC');
  assert.equal(g.turn, 1);
  assert.throws(() => act(g, 'p1', { type: 'swap', player: 1, a: [0, 0], b: [0, 0] }), /different/);
});

test('forfeit ends the game for the last opponent', () => {
  const g = game(['KC', '9H', '2H', 'K', '3H', '4H'], ['7S', '5D', '2D', 'K', '8D', '3D']);
  forfeit(g, 'p0');
  assert.equal(g.winner, 'p1');
});

test('only the attacker or defender leaving cancels a pending attack', () => {
  const layouts = [['9S', '2H', '3H', 'K', '4H', '6H'], ['5C', '3C', 'QS', 'K', '7D', '8D'], ['2C', '2D', '2S', 'K', '3D', '4D']];
  const g = game(...layouts);
  attack(g, 'p0', 0, 1, 0, 0);
  forfeit(g, 'p2');
  assert.ok(g.pending, 'a bystander leaving keeps the attack');
  act(g, 'p1', { type: 'shield', col: null });
  assert.equal(at(g, 0, 0, 0).stack[0].id, '5C');

  const h = game(...layouts);
  attack(h, 'p0', 0, 1, 0, 0);
  forfeit(h, 'p0');
  assert.equal(h.pending, null, 'the attacker leaving cancels it');
  assert.equal(h.turn, 1);
});

test('a resurrected King comes back with limit 1', () => {
  const g = game(['KS', '2H', '3H', '4H', '5H', 'K'], ['K', 'QC', 'JC', '2D', '10D', '9D'], ['9H', '3C', '4C', 'K', '5C', '6C']);
  for (const col of [1, 2, 1]) {
    attack(g, 'p0', 0, 1, 0, col);
    skip(g, 'p0'); skip(g, 'p1'); skip(g, 'p1'); skip(g, 'p2'); skip(g, 'p2');
  }
  attack(g, 'p0', 0, 1, 0, 0); // K♠ captures p1's King
  skip(g, 'p0');
  act(g, 'p2', { type: 'resurrect', col: 0, from: { player: 0, row: 0, col: 0 } });
  assert.equal(at(g, 2, 0, 0).id, 'AD');
  assert.equal(at(g, 2, 0, 0).limit, 1);
});

test('up to 10 players, using a second deck past 6', () => {
  const players = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const g = createGame(players);
  const ids = g.players.flatMap((p) => [p.king.id, ...p.hand.map((c) => c.id)]);
  assert.equal(new Set(ids).size, 80, 'all card ids unique');
  assert.deepEqual(g.players.slice(4, 8).map((p) => p.king.rank), ['A', 'A', 'A', 'A']);
  assert.equal(g.players[9].king.rank, 'JK');
  assert.throws(() => createGame([...players, { id: 'x', name: 'X' }]), /2–10/);
});

test('a resurrected ♣ comes back with a fresh doubled limit', () => {
  const g = game(['9S', '9H', '3D', 'K', '2H', '4H'], ['5C', '6D', '2D', 'K', '8D', '3S']);
  skip(g, 'p0'); skip(g, 'p0');
  attack(g, 'p1', 0, 0, 0, 2); // 5♣ attacks 3♦
  act(g, 'p0', { type: 'shield', col: null });
  assert.equal(at(g, 1, 0, 0).limit, 2);
  skip(g, 'p1');
  attack(g, 'p0', 0, 1, 0, 0); // 9♠ kills 5♣
  skip(g, 'p0'); skip(g, 'p1'); skip(g, 'p1');
  act(g, 'p0', { type: 'resurrect', col: 1, from: { player: 0, row: 0, col: 0 } });
  assert.equal(at(g, 0, 0, 1).id, '5C');
  assert.equal(at(g, 0, 0, 1).limit, 10);
});

test('a view carries the log tail and where it starts', () => {
  const g = game(['KC', '9H', '2H', 'K', '3H', '4H'], ['7S', '5D', '2D', 'K', '8D', '3D']);
  for (let i = 0; i < 32; i++) act(g, g.players[g.turn].id, { type: 'swap', player: 0, a: [0, 0], b: [0, 1] });
  const v = view(g, 'p0');
  assert.equal(v.logStart + v.log.length, 32);
  assert.ok(v.log.length < 32, 'the view trims the log');
  assert.deepEqual(v.log.at(-1), g.log.at(-1));
});
