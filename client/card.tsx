import { useLayoutEffect, useRef } from 'preact/hooks';
import { UNLIMITED, type Card as CardT, type CardName, type Suit } from '../src/game.ts';

const SYM: Record<Suit, string> = { C: '♣', D: '♦', H: '♥', S: '♠' };
const ROLE: Record<Suit, string> = { C: 'Warrior', D: 'Archer', H: 'Healer', S: 'Shield' };

export const label = (c: CardName) => (c.suit ? `${c.rank}${SYM[c.suit]}` : 'King');
const lim = (c: CardT) => (c.limit >= UNLIMITED ? '∞' : c.limit);
const red = (c: CardT) => c.suit === 'D' || c.suit === 'H';
export const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

type CardProps = { c: CardT | null; small?: boolean; extra?: string; disabled?: boolean; pressed?: boolean; onClick?: () => void; style?: Record<string, number>; where?: string };
export function Card({ c, small, extra, disabled, pressed, onClick, style, where }: CardProps) {
  if (!c) return <span class={cls('pc gap', small && 'sm')} aria-hidden="true" />;
  const kills = c.stack.length;
  const name = c.kingOf ? 'King' : `${c.rank} of ${ROLE[c.suit!]}s`;
  return (
    <button type="button" class={cls('pc', c.kingOf ? 'king' : red(c) && 'red', small && 'sm', extra)} disabled={disabled}
      aria-pressed={pressed} onClick={onClick} style={style} data-id={c.id} aria-label={`${where ? `${where}: ` : ''}${name}, kills up to ${lim(c)}, ${kills} kills`}>
      <img class="art" src={`/cards/${c.face}.png`} alt="" draggable={false} />
      <span class="role">{c.kingOf ? 'King' : ROLE[c.suit!]}</span>
      <span class="chips">
        <span class="chip" title={`Kills cards up to ${lim(c)}`}>≤{lim(c)}</span>
        {kills > 0 && <span key={kills} class="chip kill" title={`${kills} kill${kills > 1 ? 's' : ''}, last ${label(c.stack.at(-1)!)}`}>✕{kills}</span>}
      </span>
    </button>
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
export function useCardMotion() {
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
