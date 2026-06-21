import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMentions } from '../src/routing/mentions.ts';

const known = ['claude', 'codex', 'gemini'];

test('extracts a single known mention', () => {
  const { agents } = parseMentions('@claude design the API', known);
  assert.deepEqual(agents, ['claude']);
});

test('extracts multiple mentions in first-seen order', () => {
  const { agents } = parseMentions('@codex review what @claude wrote', known);
  assert.deepEqual(agents, ['codex', 'claude']);
});

test('collapses duplicate mentions', () => {
  const { agents } = parseMentions('@claude and again @claude', known);
  assert.deepEqual(agents, ['claude']);
});

test('ignores unknown mentions', () => {
  const { agents } = parseMentions('@nobody @claude @everyone', known);
  assert.deepEqual(agents, ['claude']);
});

test('is case-insensitive', () => {
  const { agents } = parseMentions('@Claude @CODEX', known);
  assert.deepEqual(agents, ['claude', 'codex']);
});

test('does not treat email addresses as mentions', () => {
  const { agents } = parseMentions('mail me at bob@codex.com', known);
  assert.deepEqual(agents, []);
});

test('returns empty when no mentions', () => {
  const { agents } = parseMentions('just a plain message', known);
  assert.deepEqual(agents, []);
});
