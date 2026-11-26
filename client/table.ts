import type { RoomView } from '../src/server.ts';

/** Wraps a handler so a thrown Error shows to the player instead of escaping. */
export type Run = <A extends unknown[]>(fn: (...args: A) => unknown) => (...args: A) => Promise<void>;
/** What every screen inside a room gets from the App. */
export type TableProps = { data: RoomView; run: Run; send: (path: string, body?: object) => Promise<unknown>; onLeave: () => void };
