import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer, type RoomView } from '../src/server.ts';

async function listen(t: { after: (fn: () => void) => void }, opts = {}) {
  const server = createServer(opts).listen(0);
  t.after(() => server.listening && server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: object, token = '') =>
    fetch(base + path, { method: 'POST', headers: { 'x-token': token }, body: JSON.stringify(body) })
      .then(async (r) => [r.status, await r.json()] as [number, any]);
  return { server, base, post };
}

test('create, browse, join, start and stream a game over HTTP', async (t) => {
  const { base, post } = await listen(t);
  const [, host] = await post('/api/rooms', { name: 'Ann', room: 'Test', max: 2 });
  const [, guest] = await post(`/api/rooms/${host.room}/join`, { name: 'Bob' });
  assert.equal((await post(`/api/rooms/${host.room}/join`, { name: 'Cy' }))[1].error, 'Room is full');
  const rooms = await fetch(`${base}/api/rooms`).then((r) => r.json());
  assert.deepEqual(rooms[0].players, ['Ann', 'Bob']);

  assert.equal((await post(`/api/rooms/${host.room}/start`, {}, guest.token))[0], 400, 'only host starts');
  const res = await fetch(`${base}/api/rooms/${host.room}/events?token=${guest.token}`);
  const reader = res.body!.getReader();
  await reader.read(); // initial lobby view
  assert.equal((await post(`/api/rooms/${host.room}/start`, {}, host.token))[0], 200);
  const { value } = await reader.read();
  const view: RoomView = JSON.parse(new TextDecoder().decode(value).replace(/^data: /, ''));
  assert.equal(view.game?.phase, 'setup');
  const me = view.game!.players.find((p) => p.id === view.you)!;
  assert.equal((me.hand as unknown[]).length, 7, 'own hand visible');
  assert.equal(view.game!.players.find((p) => p.id !== view.you)!.hand, 7, 'other hand hidden');

  const [status, err] = await post(`/api/rooms/${host.room}/action`, { action: { type: 'skip' } }, guest.token);
  assert.equal(status, 400);
  assert.match(err.error, /Lay out/);
  await reader.cancel();
});

test('rooms and games survive a server restart', async (t) => {
  const db = join(mkdtempSync(join(tmpdir(), 'lks-')), 'test.db');
  const first = await listen(t, { db });
  const [, host] = await first.post('/api/rooms', { name: 'Ann', room: 'Kept', max: 2 });
  await first.post(`/api/rooms/${host.room}/join`, { name: 'Bob' });
  await first.post(`/api/rooms/${host.room}/start`, {}, host.token);
  await new Promise((r) => first.server.close(r));

  const second = await listen(t, { db });
  const rooms = await fetch(`${second.base}/api/rooms`).then((r) => r.json());
  assert.deepEqual(rooms.map((r: { name: string; status: string }) => [r.name, r.status]), [['Kept', 'setup']]);
  const [status, err] = await second.post(`/api/rooms/${host.room}/action`, { action: { type: 'skip' } }, host.token);
  assert.equal(status, 400, 'the old token still works');
  assert.match(err.error, /Lay out/);
});

test('the host leaving the lobby hands over the room', async (t) => {
  const { base, post } = await listen(t);
  const [, host] = await post('/api/rooms', { name: 'Ann', room: 'Hand', max: 3 });
  const [, guest] = await post(`/api/rooms/${host.room}/join`, { name: 'Bob' });
  await post(`/api/rooms/${host.room}/join`, { name: 'Cy' });
  assert.equal((await post(`/api/rooms/${host.room}/leave`, {}, host.token))[0], 200);
  assert.equal((await post(`/api/rooms/${host.room}/start`, {}, guest.token))[0], 200, 'the guest is host now');
  await post(`/api/rooms/${host.room}/leave`, {}, guest.token);
  const rooms = await fetch(`${base}/api/rooms`).then((r) => r.json());
  assert.deepEqual(rooms[0].players, ['Cy']);
});

test('card images and sounds are cacheable', async (t) => {
  const { base } = await listen(t);
  const png = await fetch(`${base}/cards/AS.png`);
  assert.equal(png.headers.get('cache-control'), 'public, max-age=86400');
  const mp3 = await fetch(`${base}/sfx/kill.mp3`);
  assert.equal(mp3.headers.get('content-type'), 'audio/mpeg');
  assert.equal(mp3.headers.get('cache-control'), 'public, max-age=86400');
});
