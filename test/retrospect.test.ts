import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AgentAdapter, RunOptions } from '../src/adapters/adapter.ts';
import { parseInsights, runRetrospect } from '../src/identity/retrospect.ts';
import { MemoryStore } from '../src/store/memory-store.ts';
import type { AgentMessage } from '../src/types.ts';

/** A fake adapter that yields a fixed block of text. */
function fakeAgent(name: string, text: string): AgentAdapter {
  return {
    name,
    async *run(_prompt: string, _options?: RunOptions): AsyncGenerator<AgentMessage> {
      yield { type: 'text', agent: name, text };
      yield { type: 'result', agent: name, ok: true };
    },
  };
}

async function withMemory<T>(fn: (m: MemoryStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'bai-retro-'));
  try {
    return await fn(new MemoryStore(join(dir, 'memory.jsonl')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('parseInsights extracts INSIGHT: lines and strips quotes/punctuation', () => {
  const out = parseInsights(
    'INSIGHT: prefer stdin over argv for long prompts\nnoise line\nINSIGHT: "kill the whole process tree on Windows."',
  );
  assert.deepEqual(out, [
    'prefer stdin over argv for long prompts',
    'kill the whole process tree on Windows',
  ]);
});

test('parseInsights returns nothing for NONE', () => {
  assert.deepEqual(parseInsights('NONE'), []);
});

test('runRetrospect reviews recent memories and stores distilled insights', async () => {
  await withMemory(async (memory) => {
    await memory.record('decision', 'claude', 'store threads as JSON files');
    await memory.record('lesson', 'codex', 'shell:true mangles redirection on Windows');

    const agent = fakeAgent(
      'claude',
      'INSIGHT: keep persistence simple and inspectable\nINSIGHT: test platform-specific process handling',
    );
    const result = await runRetrospect(agent, memory);

    assert.equal(result.reviewed, 2);
    assert.equal(result.insights.length, 2);
    const insights = (await memory.all()).filter((m) => m.kind === 'insight');
    assert.equal(insights.length, 2);
  });
});

test('runRetrospect does not duplicate insights it already stored', async () => {
  await withMemory(async (memory) => {
    await memory.record('decision', 'claude', 'store threads as JSON files');
    const agent = fakeAgent('claude', 'INSIGHT: keep persistence simple and inspectable');

    const first = await runRetrospect(agent, memory);
    assert.equal(first.insights.length, 1);

    // Same insight again → skipped, nothing new stored.
    const second = await runRetrospect(agent, memory);
    assert.equal(second.insights.length, 0);

    const insights = (await memory.all()).filter((m) => m.kind === 'insight');
    assert.equal(insights.length, 1);
  });
});

test('runRetrospect with no source memories is a no-op', async () => {
  await withMemory(async (memory) => {
    const agent = fakeAgent('claude', 'INSIGHT: should not run');
    const result = await runRetrospect(agent, memory);
    assert.equal(result.reviewed, 0);
    assert.equal(result.insights.length, 0);
  });
});

test('runRetrospect ignores prior insights as source material', async () => {
  await withMemory(async (memory) => {
    await memory.record('insight', 'claude', 'an old distilled insight');
    const agent = fakeAgent('claude', 'INSIGHT: brand new');
    const result = await runRetrospect(agent, memory);
    // Only the insight existed, which is not valid source material.
    assert.equal(result.reviewed, 0);
  });
});
