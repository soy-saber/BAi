import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AgentAdapter, RunOptions } from '../src/adapters/adapter.ts';
import { Orchestrator } from '../src/routing/orchestrator.ts';
import { ThreadStore } from '../src/store/thread-store.ts';
import type { AgentMessage } from '../src/types.ts';

/** A fake adapter that yields a scripted message stream — no CLI involved. */
function fakeAdapter(name: string, messages: AgentMessage[]): AgentAdapter {
  return {
    name,
    async *run(_prompt: string, _options?: RunOptions): AsyncGenerator<AgentMessage> {
      for (const m of messages) yield m;
    },
  };
}

async function withStore<T>(fn: (store: ThreadStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'bai-test-'));
  try {
    return await fn(new ThreadStore(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('routes a message to the mentioned agent and records the transcript', async () => {
  await withStore(async (store) => {
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'designing' },
        { type: 'tool_use', agent: 'claude', tool: 'Write', input: {} },
        { type: 'result', agent: 'claude', ok: true },
      ]),
    };
    const orch = new Orchestrator(store, adapters);
    const thread = await store.create('test');

    const result = await orch.dispatch(thread.id, '@claude design the API');
    assert.deepEqual(result.ran, ['claude']);
    assert.equal(result.noMatch, false);

    const saved = await store.get(thread.id);
    assert.equal(saved?.entries.length, 2);
    assert.equal(saved?.entries[0]?.role, 'user');
    assert.equal(saved?.entries[1]?.role, 'agent');
    assert.equal(saved?.entries[1]?.agent, 'claude');
    assert.match(saved?.entries[1]?.text ?? '', /designing/);
    assert.match(saved?.entries[1]?.text ?? '', /\[tool: Write\]/);
  });
});

test('runs multiple agents in mention order', async () => {
  await withStore(async (store) => {
    const adapters = {
      claude: fakeAdapter('claude', [{ type: 'result', agent: 'claude', ok: true, text: 'c' }]),
      codex: fakeAdapter('codex', [{ type: 'result', agent: 'codex', ok: true, text: 'x' }]),
    };
    const orch = new Orchestrator(store, adapters);
    const thread = await store.create('test');

    const result = await orch.dispatch(thread.id, '@codex review what @claude wrote');
    assert.deepEqual(result.ran, ['codex', 'claude']);
    const saved = await store.get(thread.id);
    assert.equal(saved?.entries.length, 3); // user + 2 agents
    assert.equal(saved?.entries[1]?.agent, 'codex');
    assert.equal(saved?.entries[2]?.agent, 'claude');
  });
});

test('records the user message but runs nothing when no agent is mentioned', async () => {
  await withStore(async (store) => {
    const orch = new Orchestrator(store, {});
    const thread = await store.create('test');

    const result = await orch.dispatch(thread.id, 'just thinking out loud');
    assert.equal(result.noMatch, true);
    assert.deepEqual(result.ran, []);
    const saved = await store.get(thread.id);
    assert.equal(saved?.entries.length, 1);
    assert.equal(saved?.entries[0]?.role, 'user');
  });
});
