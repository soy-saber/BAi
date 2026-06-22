import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractMemories } from '../src/identity/memory-extract.ts';

test('extracts explicit DECISION and LESSON markers', () => {
  const out = extractMemories(
    'Did the work.\nDECISION: use SQLite over Redis for now\nLESSON: opencode needs a model flag',
  );
  assert.deepEqual(out, [
    { kind: 'decision', text: 'use SQLite over Redis for now' },
    { kind: 'lesson', text: 'opencode needs a model flag' },
  ]);
});

test('markers are case-insensitive and trim markdown/punctuation', () => {
  const out = extractMemories('lesson:  **always pin versions**.');
  assert.deepEqual(out, [{ kind: 'lesson', text: 'always pin versions' }]);
});

test('extracts a few natural phrasings', () => {
  const out = extractMemories(
    'We decided to cache the registry.\nLesson learned: shell:true mangles `>`.',
  );
  assert.deepEqual(out, [
    { kind: 'decision', text: 'cache the registry' },
    { kind: 'lesson', text: 'shell:true mangles >' },
  ]);
});

test('deduplicates identical takeaways', () => {
  const out = extractMemories('DECISION: ship it\nDECISION: ship it');
  assert.equal(out.length, 1);
});

test('ignores prose with no takeaway markers', () => {
  const out = extractMemories('I read the file and it looks fine. Here is a summary of things.');
  assert.deepEqual(out, []);
});

test('drops too-short fragments', () => {
  const out = extractMemories('DECISION: ok');
  assert.deepEqual(out, []); // "ok" is < 4 chars after cleaning
});
