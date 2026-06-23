import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractMove } from '../src/game/move.ts';

test('extracts an explicit MOVE: marker', () => {
  const r = extractMove('I will play the center.\nMOVE: 4');
  assert.deepEqual(r, { ok: true, cell: 4 });
});

test('MOVE: marker is case-insensitive and tolerates spacing', () => {
  assert.deepEqual(extractMove('move:   7'), { ok: true, cell: 7 });
});

test('falls back to "cell/square/position" phrasing', () => {
  assert.deepEqual(extractMove("I'll take cell 2."), { ok: true, cell: 2 });
  assert.deepEqual(extractMove('Best square #6 here.'), { ok: true, cell: 6 });
  assert.deepEqual(extractMove('position 0 looks good'), { ok: true, cell: 0 });
});

test('falls back to a bare digit as a last resort', () => {
  assert.deepEqual(extractMove('go 8'), { ok: true, cell: 8 });
});

test('takes the LAST committed number, not earlier reasoning', () => {
  // Agent reasons aloud, then commits. The decision is the final number.
  const text = 'Not 0, and 1 is risky. I considered 3. MOVE: 5';
  assert.deepEqual(extractMove(text), { ok: true, cell: 5 });
});

test('MOVE: marker wins even when bare digits appear later in other forms', () => {
  // marker is tried before phrasing/bare, so it takes precedence as a tier
  const text = 'MOVE: 4 (that is the center, not 8)';
  assert.deepEqual(extractMove(text), { ok: true, cell: 4 });
});

test('returns ok:false when no 0-8 cell is present', () => {
  const r = extractMove('I have no idea what to do here.');
  assert.equal(r.ok, false);
});

test('ignores numbers outside 0-8', () => {
  // 42 contains no standalone 0-8 token; should not match.
  const r = extractMove('The answer is 42.');
  assert.equal(r.ok, false);
});
