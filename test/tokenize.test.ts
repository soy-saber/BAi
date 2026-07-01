import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeRegExp, STOPWORDS, tokenize } from '../src/text/tokenize.ts';

// tokenize is the one keyword primitive shared by memory recall and capability
// routing. These tests pin exactly what counts as a meaningful word, so the two
// features can't drift apart on it (the reason the primitive lives in one place).

test('tokenize lowercases and splits on non-alphanumerics', () => {
  assert.deepEqual(tokenize('Design the API-layer, then REVIEW it.'), [
    'design',
    'api',
    'layer',
    'review',
  ]);
});

test('tokenize drops stopwords and one-character tokens', () => {
  // "the", "a", "to" are stopwords; "x" is a 1-char token — all dropped.
  assert.deepEqual(tokenize('a x to the moon'), ['moon']);
});

test('tokenize keeps multi-digit numbers but drops single digits', () => {
  // Numbers are alphanumeric, so 42 survives; a lone 7 is a 1-char token.
  assert.deepEqual(tokenize('port 8080 vs 7'), ['port', '8080', 'vs']);
});

test('tokenize returns an empty array for empty or all-stopword input', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('the and or but'), []);
  assert.deepEqual(tokenize('!!! --- ...'), []);
});

test('tokenize does not dedupe — repeats are preserved', () => {
  // Callers that want distinct terms wrap in a Set themselves (capability.ts,
  // memory-store.ts both do). The primitive stays faithful to the input.
  assert.deepEqual(tokenize('bug bug bug'), ['bug', 'bug', 'bug']);
});

test('STOPWORDS is a non-empty set of common words', () => {
  assert.ok(STOPWORDS.has('the'));
  assert.ok(STOPWORDS.has('using'));
  assert.ok(!STOPWORDS.has('architecture'));
});

test('escapeRegExp escapes regex metacharacters so a string matches literally', () => {
  const raw = 'a.b*c+d?(e)[f]';
  const escaped = escapeRegExp(raw);
  // The escaped form, used as a pattern, matches the raw string verbatim and
  // nothing cleverer (the metachars are now literal).
  assert.match(raw, new RegExp(escaped));
  assert.doesNotMatch('aXbc', new RegExp(escapeRegExp('a.b')));
});

test('escapeRegExp leaves plain alphanumerics untouched', () => {
  assert.equal(escapeRegExp('plain text 123'), 'plain text 123');
});
