import { useEffect, useRef, useState } from 'preact/hooks';
import type { Card as CardT } from '../src/game.ts';
import { Card, cls } from './card.tsx';
import { Page } from './page.tsx';
import { sfx } from './sfx.ts';
import type { TableProps } from './table.ts';

export function Setup({ data, run, send, onLeave }: TableProps) {
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
    if (!placing && id === me.king.id) throw new Error('You can’t discard your King');
    // Each placed card lands a step higher up a pentatonic scale, Balatro style.
    if (placing) sfx('place', [0, 2, 4, 7, 9, 12][layout.length]); else sfx('select', discard.length * 3);
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
            : <Card key={c.id} c={c} style={{ '--i': i }} onClick={run(() => tap(c.id))} />)}</div>
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
