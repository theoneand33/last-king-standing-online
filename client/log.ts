// The view only carries the last 30 log lines, so the length alone can't say what's new:
// find the longest tail of `was` that `now` starts with, and return what follows it.
export function newLines(was: string[], now: string[]) {
  for (let keep = Math.min(was.length, now.length); keep > 0; keep--) {
    if (now.slice(0, keep).every((l, i) => l === was[was.length - keep + i])) return now.slice(keep);
  }
  return now;
}
