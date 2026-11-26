import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { sfx, sound } from './sfx.ts';
import { store } from './store.ts';

const Crown = () => (
  <svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2 13h14v2H5z" /></svg>
);

// Follows the system until the player picks; the pick is stored and set on <html data-theme>.
const applyTheme = (t: string | null) => { if (t) document.documentElement.dataset.theme = t; };
applyTheme(store.get('lks-theme'));
function ThemeToggle() {
  const [dark, setDark] = useState(() => (document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark');
  const flip = () => { const t = dark ? 'light' : 'dark'; applyTheme(t); store.set('lks-theme', t); setDark(!dark); };
  return (
    <button id="theme" type="button" class="btn line icon" aria-label="Dark theme" title="Dark theme" aria-pressed={dark} onClick={flip}>
      {/* Lucide icons (ISC licence): sun while dark, moon while light */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>
          : <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />}
      </svg>
    </button>
  );
}

function SoundToggle() {
  const [on, setOn] = useState(sound.on);
  const flip = () => { sound.set(!on); setOn(!on); if (!on) sfx('select'); };
  return (
    <button id="sound" type="button" class="btn line icon" aria-label="Sound" title="Sound" aria-pressed={on} onClick={flip}>
      {/* Lucide icons (ISC licence): volume-2 / volume-x */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z" />
        {on ? <path d="M16 9a5 5 0 0 1 0 6m3.4 2.7a9 9 0 0 0 0-11.4" /> : <path d="m22 9-6 6m0-6 6 6" />}
      </svg>
    </button>
  );
}

export function Page({ title, right, onLeave, children }: { title: string; right?: ComponentChildren; onLeave?: () => void; children: ComponentChildren }) {
  useEffect(() => { document.title = title; }, [title]);
  return (
    <>
      <header class="top">
        <div class="brand"><span class="logo"><Crown /></span><h1>{title}</h1></div>
        <div class="top-r">{right}<SoundToggle /><ThemeToggle />{onLeave && <button id="leave" class="btn line" onClick={onLeave}>Leave game</button>}</div>
      </header>
      {children}
    </>
  );
}
