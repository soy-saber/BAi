import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectHandoffs, handoffPrompt } from '../src/routing/a2a.ts';

const known = ['claude', 'codex', 'gemini'];

test('detects a handoff when output mentions another agent', () => {
  const handoffs = detectHandoffs('claude', 'Done. @codex please review.', known, 0);
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0]?.to, 'codex');
  assert.equal(handoffs[0]?.from, 'claude');
  assert.equal(handoffs[0]?.hop, 1);
});

test('an agent mentioning itself is not a handoff', () => {
  const handoffs = detectHandoffs('claude', 'I, @claude, will continue.', known, 0);
  assert.deepEqual(handoffs, []);
});

test('output with no known mention yields no handoff', () => {
  const handoffs = detectHandoffs('claude', 'all finished, looks good', known, 0);
  assert.deepEqual(handoffs, []);
});

test('multiple mentioned agents each become a handoff', () => {
  const handoffs = detectHandoffs('claude', '@codex and @gemini take a look', known, 2);
  assert.deepEqual(
    handoffs.map((h) => h.to),
    ['codex', 'gemini'],
  );
  assert.equal(handoffs[0]?.hop, 3);
});

test('handoff prompt carries the original request and the prior output', () => {
  const prompt = handoffPrompt(
    { to: 'codex', from: 'claude', context: 'wrote the parser', hop: 1 },
    'build a JSON parser',
  );
  assert.match(prompt, /Handoff from @claude/);
  assert.match(prompt, /build a JSON parser/);
  assert.match(prompt, /wrote the parser/);
});
