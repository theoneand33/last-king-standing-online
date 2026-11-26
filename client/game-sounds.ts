import type { GameView } from '../src/game.ts';
import { sfx } from './sfx.ts';

/** Sounds for what changed between two views of the game, for every player watching. */
export function playEvents(was: GameView, g: GameView, you: string | null) {
  const won = g.phase === 'over' && was.phase !== 'over';
  const seen = was.logStart + was.log.length;
  for (const e of g.log.slice(Math.max(0, seen - g.logStart))) {
    switch (e.type) {
      case 'out': if (!won || g.winner !== you) sfx('out'); break;
      case 'resurrect': sfx('resurrect'); break;
      case 'swap': sfx('swap'); break;
      case 'kill': sfx('kill', 2 * Math.min(e.kills - 1, 6)); break; // the killer's pitch climbs with its kills, like a combo
    }
  }
  if (g.pending && !was.pending) sfx('shield');
  const me = g.players.findIndex((p) => p.id === you);
  if (g.phase === 'play' && g.turn === me && (was.phase !== 'play' || was.turn !== me)) sfx('turn');
  if (won && g.winner === you) sfx('win');
}
