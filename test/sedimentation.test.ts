import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AgentAdapter, RunOptions } from '../src/adapters/adapter.ts';
import { Orchestrator } from '../src/routing/orchestrator.ts';
import { MemoryStore } from '../src/store/memory-store.ts';
import { ThreadStore } from '../src/store/thread-store.ts';
import type { AgentMessage } from '../src/types.ts';

function fakeAdapter(name: string, messages: AgentMessage[]): AgentAdapter {
  return {
    name,
    async *run(_p: string, _o?: RunOptions): AsyncGenerator<AgentMessage> {
      for (const m of messages) yield m;
    },
  };
}

async function withStores<T>(
  fn: (threads: ThreadStore, memory: MemoryStore) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'bai-sed-'));
  try {
    return await fn(new ThreadStore(join(dir, 'threads')), new MemoryStore(join(dir, 'mem.jsonl')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a successful turn sediments DECISION/LESSON markers into memory', async () => {
  await withStores(async (threads, memory) => {
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'Built it.\nDECISION: use NDJSON for streaming' },
        { type: 'result', agent: 'claude', ok: true },
      ]),
    };
    const orch = new Orchestrator(threads, adapters, { memory });
    const thread = await threads.create('t');
    await orch.dispatch(thread.id, '@claude build streaming');

    const all = await memory.all();
    assert.equal(all.length, 1);
    assert.equal(all[0]?.kind, 'decision');
    assert.equal(all[0]?.agent, 'claude');
    assert.match(all[0]?.text ?? '', /NDJSON/);
  });
});

test('a failed turn does not sediment memory', async () => {
  await withStores(async (threads, memory) => {
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'DECISION: this should not be saved' },
        { type: 'result', agent: 'claude', ok: false, error: 'boom' },
      ]),
    };
    const orch = new Orchestrator(threads, adapters, { memory });
    const thread = await threads.create('t');
    await orch.dispatch(thread.id, '@claude do it');

    assert.deepEqual(await memory.all(), []);
  });
});

test('sedimented memory is recalled into a later turn prompt', async () => {
  await withStores(async (threads, memory) => {
    let secondPrompt = '';
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'DECISION: prefer SQLite for the store' },
        { type: 'result', agent: 'claude', ok: true },
      ]),
      codex: {
        name: 'codex',
        async *run(prompt: string): AsyncGenerator<AgentMessage> {
          secondPrompt = prompt;
          yield { type: 'result', agent: 'codex', ok: true };
        },
      } as AgentAdapter,
    };
    const orch = new Orchestrator(threads, adapters, { memory });
    const thread = await threads.create('t');

    await orch.dispatch(thread.id, '@claude pick a store for SQLite work');
    await orch.dispatch(thread.id, '@codex review the SQLite store choice');

    // codex's composed prompt should carry the recalled decision.
    assert.match(secondPrompt, /prefer SQLite for the store/);
  });
});
