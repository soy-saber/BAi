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

test('chat mode adds the no-tools note; agent mode does not', () => {
  const chat = composePrompt(IDENTITIES.gemini, [], 'analyze it', { mode: 'chat' });
  assert.match(chat, /NO ability to read files/);
  const agent = composePrompt(IDENTITIES.claude, [], 'build it', { mode: 'agent' });
  assert.doesNotMatch(agent, /NO ability to read files/);
});

test('file context is inlined when provided', () => {
  const fileContext = '## Referenced files\n### a.ts\n```\nconst x = 1;\n```';
  const prompt = composePrompt(IDENTITIES.gemini, [], 'explain @file:a.ts', {
    mode: 'chat',
    fileContext,
  });
  assert.match(prompt, /Referenced files/);
  assert.match(prompt, /const x = 1;/);
});
