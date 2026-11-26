import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newLines } from '../client/log.ts';

test('newLines finds lines added since the last view, across the 30-line window', () => {
  assert.deepEqual(newLines([], ['a']), ['a']);
  assert.deepEqual(newLines(['a', 'b'], ['a', 'b']), []);
  assert.deepEqual(newLines(['a', 'b'], ['a', 'b', 'c']), ['c']);
  assert.deepEqual(newLines(['a', 'b', 'c'], ['b', 'c', 'd', 'e']), ['d', 'e']); // window slid
  assert.deepEqual(newLines(['x', 'x'], ['x', 'x', 'x']), ['x']); // repeated lines
});
