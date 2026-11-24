import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

test('create, browse, join, start and stream a game over HTTP', async (t) => {
  const server = createServer().listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, token = '') =>
    fetch(base + path, { method: 'POST', headers: { 'x-token': token }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);

  const [, host] = await post('/api/rooms', { name: 'Ann', room: 'Test', max: 2 });
  const [, guest] = await post(`/api/rooms/${host.room}/join`, { name: 'Bob' });
  assert.equal((await post(`/api/rooms/${host.room}/join`, { name: 'Cy' }))[1].error, 'Room is full');
  const rooms = await fetch(`${base}/api/rooms`).then((r) => r.json());
  assert.deepEqual(rooms[0].players, ['Ann', 'Bob']);

  assert.equal((await post(`/api/rooms/${host.room}/start`, {}, guest.token))[0], 400, 'only host starts');
  const res = await fetch(`${base}/api/rooms/${host.room}/events?token=${guest.token}`);
  const reader = res.body.getReader();
  await reader.read(); // initial lobby view
  assert.equal((await post(`/api/rooms/${host.room}/start`, {}, host.token))[0], 200);
  const { value } = await reader.read();
  const view = JSON.parse(new TextDecoder().decode(value).replace(/^data: /, ''));
  assert.equal(view.game.phase, 'setup');
  const me = view.game.players.find((p) => p.id === view.you);
  assert.equal(me.hand.length, 7, 'own hand visible');
  assert.equal(view.game.players.find((p) => p.id !== view.you).hand, 7, 'other hand hidden');

  const [status, err] = await post(`/api/rooms/${host.room}/action`, { action: { type: 'skip' } }, guest.token);
  assert.equal(status, 400);
  assert.match(err.error, /Lay out/);
  await reader.cancel();
});
