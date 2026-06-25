import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { codexSpec } from '../src/adapters/codex.ts';
import { type Identity, resolveMode } from '../src/identity/identity.ts';

// These tests cover the codex model-override path (Stage 20): the `-m` argv
// injection driven by BAI_CODEX_MODEL, and how that env var (plus the
// BAI_CHAT_AGENTS manual downgrade) resolves codex's effective agent/chat mode.
// They mutate process.env, so each restores the two vars afterward.

const SAVED = {
  model: process.env.BAI_CODEX_MODEL,
  chat: process.env.BAI_CHAT_AGENTS,
};

afterEach(() => {
  restore('BAI_CODEX_MODEL', SAVED.model);
  restore('BAI_CHAT_AGENTS', SAVED.chat);
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const CODEX: Identity = {
  agent: 'codex',
  name: 'Maine Coon',
  role: 'Reviewer',
  persona: '',
  strengths: [],
};

test('buildArgs has no -m by default (model comes from the user config)', () => {
  delete process.env.BAI_CODEX_MODEL;
  const args = codexSpec.buildArgs('bypass');
  assert.ok(!args.includes('-m'));
  // Still the core exec/json/sandbox shape, prompt on stdin.
  assert.deepEqual(args.slice(0, 4), ['exec', '--json', '--sandbox', 'danger-full-access']);
  assert.equal(args[args.length - 1], '-');
});

test('buildArgs injects -m <model> when BAI_CODEX_MODEL is set, before the stdin marker', () => {
  process.env.BAI_CODEX_MODEL = 'gpt-5.5';
  const args = codexSpec.buildArgs('bypass');
  const i = args.indexOf('-m');
  assert.ok(i >= 0, 'expected -m in argv');
  assert.equal(args[i + 1], 'gpt-5.5');
  // The stdin marker stays last so the model flag never swallows it.
  assert.equal(args[args.length - 1], '-');
});

test('an empty/whitespace BAI_CODEX_MODEL is ignored (no -m)', () => {
  process.env.BAI_CODEX_MODEL = '   ';
  assert.ok(!codexSpec.buildArgs('bypass').includes('-m'));
});

test('resolveMode: codex pointed at a tool-capable model is an agent (optimistic default)', () => {
  delete process.env.BAI_CHAT_AGENTS;
  process.env.BAI_CODEX_MODEL = 'gpt-5.5';
  assert.equal(resolveMode(CODEX), 'agent');
});

test('resolveMode: codex pointed at a known chat-only model auto-degrades to chat', () => {
  delete process.env.BAI_CHAT_AGENTS;
  process.env.BAI_CODEX_MODEL = 'gemini-3.1-pro';
  assert.equal(resolveMode(CODEX), 'chat');
});

test('resolveMode: BAI_CHAT_AGENTS wins even when the model looks tool-capable', () => {
  process.env.BAI_CODEX_MODEL = 'gpt-5.5';
  process.env.BAI_CHAT_AGENTS = 'codex';
  assert.equal(resolveMode(CODEX), 'chat');
});

test('resolveMode: with neither var set, codex falls back to its declared mode (agent)', () => {
  delete process.env.BAI_CHAT_AGENTS;
  delete process.env.BAI_CODEX_MODEL;
  assert.equal(resolveMode(CODEX), 'agent');
});
