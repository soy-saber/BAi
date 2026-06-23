import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AgentAdapter, RunOptions } from '../src/adapters/adapter.ts';
import { Orchestrator } from '../src/routing/orchestrator.ts';
import { auditPipeline, runPipeline, type Stage } from '../src/routing/pipeline.ts';
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

/** An adapter that completes with given text. */
function okAdapter(name: string, text: string): AgentAdapter {
  return fakeAdapter(name, [
    { type: 'text', agent: name, text },
    { type: 'result', agent: name, ok: true },
  ]);
}

/** An adapter that fails to run (e.g. spawn error / timeout). */
function failAdapter(name: string, error: string): AgentAdapter {
  return fakeAdapter(name, [{ type: 'result', agent: name, ok: false, error }]);
}

async function withStore<T>(fn: (store: ThreadStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'bai-test-'));
  try {
    return await fn(new ThreadStore(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('runs every stage in order, threading prior output into the next prompt', async () => {
  await withStore(async (store) => {
    const seenPrompts: string[] = [];
    const recording = (name: string, text: string): AgentAdapter => ({
      name,
      async *run(prompt: string): AsyncGenerator<AgentMessage> {
        seenPrompts.push(prompt);
        yield { type: 'text', agent: name, text };
        yield { type: 'result', agent: name, ok: true };
      },
    });
    const orch = new Orchestrator(store, {
      a: recording('a', 'output-A'),
      b: recording('b', 'output-B'),
    });
    const thread = await store.create('t');

    const stages: Stage[] = [
      { name: 's1', primary: 'a', buildPrompt: (task) => `S1:${task}` },
      {
        name: 's2',
        primary: 'b',
        buildPrompt: (_task, prior) => `S2 saw:${prior.map((r) => r.text).join(',')}`,
      },
    ];
    const results = await runPipeline(orch, thread.id, 'TASK', stages);

    assert.equal(results.length, 2);
    assert.equal(results[0]?.agent, 'a');
    assert.equal(results[1]?.agent, 'b');
    // Stage 2's prompt was built from stage 1's output.
    assert.ok(seenPrompts.some((p) => p.includes('S2 saw:output-A')));
  });
});

test('falls back to the next agent when the primary fails to run', async () => {
  await withStore(async (store) => {
    const orch = new Orchestrator(store, {
      primary: failAdapter('primary', 'spawn ENOENT'),
      backup: okAdapter('backup', 'I handled it'),
    });
    const thread = await store.create('t');

    const stages: Stage[] = [
      { name: 'only', primary: 'primary', fallbacks: ['backup'], buildPrompt: (task) => task },
    ];
    const results = await runPipeline(orch, thread.id, 'do it', stages);

    assert.equal(results.length, 1);
    const r = results[0];
    assert.equal(r?.ok, true);
    assert.equal(r?.agent, 'backup'); // the fallback ran
    assert.deepEqual(r?.failedOver, ['primary']); // and we recorded the failure
  });
});

test('a stage is exhausted (ok=false) only when primary and all fallbacks fail', async () => {
  await withStore(async (store) => {
    const orch = new Orchestrator(store, {
      a: failAdapter('a', 'down'),
      b: failAdapter('b', 'also down'),
    });
    const thread = await store.create('t');

    const stages: Stage[] = [
      { name: 'only', primary: 'a', fallbacks: ['b'], buildPrompt: (task) => task },
    ];
    const results = await runPipeline(orch, thread.id, 'x', stages);

    assert.equal(results.length, 1);
    assert.equal(results[0]?.ok, false);
    assert.deepEqual(results[0]?.failedOver, ['a', 'b']);
  });
});

test('a failed stage breaks the chain — later stages do not run', async () => {
  await withStore(async (store) => {
    let secondRan = false;
    const orch = new Orchestrator(store, {
      a: failAdapter('a', 'down'),
      b: {
        name: 'b',
        async *run(): AsyncGenerator<AgentMessage> {
          secondRan = true;
          yield { type: 'result', agent: 'b', ok: true };
        },
      },
    });
    const thread = await store.create('t');

    const stages: Stage[] = [
      { name: 's1', primary: 'a', buildPrompt: (task) => task },
      { name: 's2', primary: 'b', buildPrompt: (task) => task },
    ];
    const results = await runPipeline(orch, thread.id, 'x', stages);

    assert.equal(results.length, 1); // only s1 recorded
    assert.equal(results[0]?.ok, false);
    assert.equal(secondRan, false); // s2 never started
  });
});

test('a negative verdict is still a success — we fall back on broken agents, not bad news', async () => {
  await withStore(async (store) => {
    const orch = new Orchestrator(store, {
      // Completes fine, but the content is a "revise" verdict. ok=true.
      gate: okAdapter('gate', 'VERDICT: revise — the audit missed an injection bug'),
      backup: okAdapter('backup', 'should not run'),
    });
    const thread = await store.create('t');

    const stages: Stage[] = [
      { name: 'gatekeep', primary: 'gate', fallbacks: ['backup'], buildPrompt: (task) => task },
    ];
    const results = await runPipeline(orch, thread.id, 'x', stages);

    assert.equal(results[0]?.agent, 'gate'); // did NOT fall back
    assert.equal(results[0]?.ok, true);
    assert.deepEqual(results[0]?.failedOver, []);
    assert.match(results[0]?.text ?? '', /revise/);
  });
});

test('auditPipeline wires claude → codex with an opencode fallback', () => {
  const stages = auditPipeline();
  assert.equal(stages.length, 2);
  assert.equal(stages[0]?.name, 'audit');
  assert.equal(stages[0]?.primary, 'claude');
  assert.equal(stages[1]?.name, 'gatekeep');
  assert.equal(stages[1]?.primary, 'codex');
  assert.deepEqual(stages[1]?.fallbacks, ['opencode']);
  // The gatekeep prompt embeds the audit text it is reviewing.
  const prompt = stages[1]?.buildPrompt('TARGET', [
    { stage: 'audit', agent: 'claude', text: 'found a bug', ok: true, failedOver: [] },
  ]);
  assert.match(prompt ?? '', /found a bug/);
  assert.match(prompt ?? '', /VERDICT/);
});

test('emits stage_start, fallback, and stage_end events', async () => {
  await withStore(async (store) => {
    const orch = new Orchestrator(store, {
      primary: failAdapter('primary', 'boom'),
      backup: okAdapter('backup', 'ok'),
    });
    const thread = await store.create('t');

    const kinds: string[] = [];
    const stages: Stage[] = [
      { name: 'only', primary: 'primary', fallbacks: ['backup'], buildPrompt: (task) => task },
    ];
    await runPipeline(orch, thread.id, 'x', stages, {
      onPipelineEvent: (e) => {
        if (e.stage_start) kinds.push('start');
        if (e.fallback) kinds.push('fallback');
        if (e.stage_end) kinds.push('end');
      },
    });

    // start(primary) → fallback → start(backup) → end
    assert.deepEqual(kinds, ['start', 'fallback', 'start', 'end']);
  });
});
