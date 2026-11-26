import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Action, Cell, GameView, LogEvent } from '../src/game.ts';
import { Card, cls, label, useCardMotion } from './card.tsx';
import { Page } from './page.tsx';
import { sfx } from './sfx.ts';
import type { TableProps } from './table.ts';

function describe(e: LogEvent, g: GameView) {
  const who = (i: number) => g.players[i].name;
  switch (e.type) {
    case 'kill': return `${who(e.player)}'s ${label(e.card)} killed ${who(e.owner)}'s ${label(e.victim)}`;
    case 'resurrect': return `${who(e.player)}'s ${label(e.healer)} resurrected ${label(e.card)} from ${label(e.from)}`;
    case 'swap': return `${who(e.player)} swapped ${label(e.a)} and ${label(e.b)}`;
    case 'out': return `${who(e.player)} is out`;
  }
}

export function Play({ data, run, send, onLeave }: TableProps) {
  const [sel, setSel] = useState<Cell[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const board = useCardMotion();
  const g = data.game!;
  const meIdx = g.players.findIndex((p) => p.id === data.you);
  const me = g.players[meIdx];
  const myTurn = g.phase === 'play' && g.turn === meIdx && !g.pending;
  const isSel = (pi: number, r: number, c: number) => sel.some((s) => s.player === pi && s.row === r && s.col === c);
  const toggle = (player: number, row: number, col: number) => {
    const off = isSel(player, row, col);
    sfx('select', off ? -5 : sel.length ? 5 : 0); // second pick rings higher, a drop drops
    setSel(off ? sel.filter((s) => !(s.player === player && s.row === row && s.col === col))
      : [...sel.slice(-1), { player, row, col }]); // keep the last two picks
  };
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
          <ol>{g.log.length ? g.log.slice().reverse().map((e) => <li>{describe(e, g)}</li>) : <li>No moves yet.</li>}</ol>
          <p class="tiny">♣ Warrior kills up to double its value · ♦ Archer hits the back row · ♥ Healer revives a captured card · ♠ Shield blocks for its row</p></aside>
      </main>
    </Page>
  );
}
