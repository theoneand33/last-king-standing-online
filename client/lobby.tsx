import { MIN_PLAYERS } from '../src/game.ts';
import { Page } from './page.tsx';
import type { TableProps } from './table.ts';

export function Lobby({ data, run, send, onLeave }: TableProps) {
  const { room, you } = data;
  const short = MIN_PLAYERS - room.players.length;
  return (
    <Page title={room.name} right={<span class="pill">{room.players.length}/{room.max} players</span>} onLeave={onLeave}>
      <main class="main center">
        <section class="lobby panel">
          <h2>Players</h2>
          <ul class="roster">{Array.from({ length: room.max }, (_, i) => room.players[i]
            ? <li><span class="av" aria-hidden="true">{room.players[i][0].toUpperCase()}</span>{room.players[i]}</li>
            : <li class="open"><span class="av" aria-hidden="true" />Open spot</li>)}</ul>
          {room.host === you ? <>
            <button id="start" class="btn gold big" disabled={short > 0} onClick={run(() => send('start', {}))}>Start game</button>
            <p class="whisper">{short > 0 ? `Needs ${short} more player${short > 1 ? 's' : ''}` : 'No one else can join once you start'}</p>
          </> : <p class="whisper">The host starts the game when everyone is in</p>}
        </section>
      </main>
    </Page>
  );
}
