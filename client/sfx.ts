// Sound effects: short clips made in SoundCraft (public/sfx), played through Web Audio so pitch can climb
// with each pick and kill. Browsers only allow audio after a user gesture, so the context starts on the first one.
const NAMES = ['select', 'place', 'swap', 'kill', 'shield', 'resurrect', 'turn', 'out', 'win', 'error'] as const;
export type Sfx = (typeof NAMES)[number];

let ctx: AudioContext | null = null;
let out: GainNode;
const buffers = new Map<Sfx, AudioBuffer>();
export const sound = {
  on: (() => { try { return localStorage.getItem('lks-sound') !== 'off'; } catch { return true; } })(),
  set(on: boolean) {
    this.on = on;
    try { localStorage.setItem('lks-sound', on ? 'on' : 'off'); } catch {}
  },
};

function start() {
  if (ctx) return void ctx.resume();
  ctx = new AudioContext();
  out = ctx.createGain();
  out.gain.value = 0.5;
  out.connect(ctx.destination);
  for (const n of NAMES) {
    fetch(`/sfx/${n}.mp3`).then((r) => r.arrayBuffer()).then((b) => ctx!.decodeAudioData(b)).then((a) => buffers.set(n, a), () => {});
  }
}
for (const e of ['pointerdown', 'keydown']) addEventListener(e, start, { capture: true });

// `semis` shifts the pitch (and speed, tape style); a little random detune keeps repeats from sounding canned.
export function sfx(name: Sfx, semis = 0) {
  const buf = buffers.get(name);
  if (!sound.on || !ctx || !buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 2 ** ((semis + (Math.random() - 0.5) * 0.3) / 12);
  src.connect(out);
  src.start();
}
