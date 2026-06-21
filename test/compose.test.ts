import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composePrompt } from '../src/identity/compose.ts';
import { IDENTITIES } from '../src/identity/identity.ts';
import type { Memory } from '../src/store/memory-store.ts';

test('composed prompt includes identity, iron laws, and the message', () => {
  const prompt = composePrompt(IDENTITIES.claude, [], 'design the API');
  assert.match(prompt, /Ragdoll/);
  assert.match(prompt, /Iron Laws/);
  assert.match(prompt, /Data Storage Sanctuary/);
  assert.match(prompt, /## Message\ndesign the API/);
});

test('composed prompt includes recalled memory when present', () => {
  const memories: Memory[] = [
    { id: 'a1', kind: 'decision', agent: 'claude', text: 'use CLI subprocess', ts: 1 },
  ];
  const prompt = composePrompt(IDENTITIES.claude, memories, 'continue the work');
  assert.match(prompt, /Relevant team memory/);
  assert.match(prompt, /use CLI subprocess/);
});

test('composed prompt still works without an identity', () => {
  const prompt = composePrompt(undefined, [], 'hello');
  assert.doesNotMatch(prompt, /Who you are/);
  assert.match(prompt, /Iron Laws/);
  assert.match(prompt, /## Message\nhello/);
});

test('iron laws appear on every turn regardless of memory', () => {
  const prompt = composePrompt(IDENTITIES.codex, [], 'review this');
  assert.match(prompt, /Maine Coon/);
  assert.match(prompt, /Network Boundary/);
});
