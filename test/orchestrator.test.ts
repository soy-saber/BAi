import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AgentAdapter, RunOptions } from '../src/adapters/adapter.ts';
import { Orchestrator, orchestratorEnvOptions } from '../src/routing/orchestrator.ts';
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

test('A2A: an agent handoff runs the mentioned agent automatically', async () => {
  await withStore(async (store) => {
    const adapters = {
      // claude finishes and hands off to codex inside its output
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'wrote the parser. @codex please review.' },
        { type: 'result', agent: 'claude', ok: true },
      ]),
      codex: fakeAdapter('codex', [
        { type: 'text', agent: 'codex', text: 'reviewed: looks correct' },
        { type: 'result', agent: 'codex', ok: true },
      ]),
    };
    const orch = new Orchestrator(store, adapters);
    const thread = await store.create('test');

    // Human only mentions claude; codex runs via handoff.
    const result = await orch.dispatch(thread.id, '@claude build a parser');
    assert.deepEqual(result.ran, ['claude', 'codex']);

    const saved = await store.get(thread.id);
    assert.equal(saved?.entries.length, 3); // user + claude + codex
    assert.equal(saved?.entries[2]?.agent, 'codex');
    assert.match(saved?.entries[2]?.text ?? '', /reviewed/);
  });
});

test('capability routing: no @mention routes to the best agent by strengths', async () => {
  await withStore(async (store) => {
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'refactoring it' },
        { type: 'result', agent: 'claude', ok: true },
      ]),
      codex: fakeAdapter('codex', [
        { type: 'text', agent: 'codex', text: 'reviewing it' },
        { type: 'result', agent: 'codex', ok: true },
      ]),
    };
    const orch = new Orchestrator(store, adapters);
    const thread = await store.create('test');

    // "review" + "bugs" hit codex's strengths; no @mention given.
    const result = await orch.dispatch(thread.id, 'please review this code for bugs');
    assert.equal(result.noMatch, false);
    assert.equal(result.routed, 'codex');
    assert.deepEqual(result.ran, ['codex']);
  });
});

test('capability routing: an explicit @mention always wins over routing', async () => {
  await withStore(async (store) => {
    const adapters = {
      claude: fakeAdapter('claude', [{ type: 'result', agent: 'claude', ok: true }]),
      codex: fakeAdapter('codex', [{ type: 'result', agent: 'codex', ok: true }]),
    };
    const orch = new Orchestrator(store, adapters);
    const thread = await store.create('test');

    // Words lean toward codex (review/bugs), but @claude is explicit.
    const result = await orch.dispatch(thread.id, '@claude review this for bugs');
    assert.equal(result.routed, undefined);
    assert.deepEqual(result.ran, ['claude']);
  });
});

test('capability routing: no keyword match and no @mention dispatches nobody', async () => {
  await withStore(async (store) => {
    const adapters = {
      claude: fakeAdapter('claude', [{ type: 'result', agent: 'claude', ok: true }]),
      codex: fakeAdapter('codex', [{ type: 'result', agent: 'codex', ok: true }]),
    };
    const orch = new Orchestrator(store, adapters);
    const thread = await store.create('test');

    const result = await orch.dispatch(thread.id, 'hello there everyone');
    assert.equal(result.noMatch, true);
    assert.deepEqual(result.ran, []);
  });
});

test('capability routing: autoRoute:false restores the old no-dispatch behavior', async () => {
  await withStore(async (store) => {
    const adapters = {
      codex: fakeAdapter('codex', [{ type: 'result', agent: 'codex', ok: true }]),
    };
    const orch = new Orchestrator(store, adapters, { autoRoute: false });
    const thread = await store.create('test');

    const result = await orch.dispatch(thread.id, 'please review this code for bugs');
    assert.equal(result.noMatch, true);
    assert.deepEqual(result.ran, []);
  });
});

test('A2A: the hop cap stops a two-agent @-loop', async () => {
  await withStore(async (store) => {
    // Each agent always pings the other — without a cap this never ends.
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'ping @codex' },
        { type: 'result', agent: 'claude', ok: true },
      ]),
      codex: fakeAdapter('codex', [
        { type: 'text', agent: 'codex', text: 'ping @claude' },
        { type: 'result', agent: 'codex', ok: true },
      ]),
    };
    const orch = new Orchestrator(store, adapters, { maxHops: 3 });
    const thread = await store.create('test');

    const result = await orch.dispatch(thread.id, '@claude start');
    // hop0 claude, hop1 codex, hop2 claude, hop3 codex — then stop.
    assert.deepEqual(result.ran, ['claude', 'codex', 'claude', 'codex']);
  });
});

test('A2A: the turn budget caps total work below the hop depth', async () => {
  await withStore(async (store) => {
    // A ping-pong that the hop cap alone would let run for many turns. With a
    // generous maxHops but a tight maxTurns, the *total* budget stops it first.
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'ping @codex' },
        { type: 'result', agent: 'claude', ok: true },
      ]),
      codex: fakeAdapter('codex', [
        { type: 'text', agent: 'codex', text: 'ping @claude' },
        { type: 'result', agent: 'codex', ok: true },
      ]),
    };
    const orch = new Orchestrator(store, adapters, { maxHops: 99, maxTurns: 3 });
    const thread = await store.create('test');

    const events: string[] = [];
    const result = await orch.dispatch(thread.id, '@claude start', (e) => {
      if (e.kind === 'budget_exhausted') events.push(`budget:${e.ran}:${e.dropped.join(',')}`);
    });
    // Exactly maxTurns ran, then the budget stopped the chain.
    assert.deepEqual(result.ran, ['claude', 'codex', 'claude']);
    assert.deepEqual(events, ['budget:3:codex']);
  });
});

test('A2A: a chain shorter than the budget finishes without a budget event', async () => {
  await withStore(async (store) => {
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'done, @codex please review' },
        { type: 'result', agent: 'claude', ok: true },
      ]),
      codex: fakeAdapter('codex', [
        { type: 'text', agent: 'codex', text: 'looks good' },
        { type: 'result', agent: 'codex', ok: true },
      ]),
    };
    const orch = new Orchestrator(store, adapters, { maxTurns: 12 });
    const thread = await store.create('test');

    let budgetFired = false;
    const result = await orch.dispatch(thread.id, '@claude build it', (e) => {
      if (e.kind === 'budget_exhausted') budgetFired = true;
    });
    assert.deepEqual(result.ran, ['claude', 'codex']);
    assert.equal(budgetFired, false);
  });
});

test('emits no_tools when a tool-capable agent completes a turn calling no tools', async () => {
  await withStore(async (store) => {
    // claude is agent-mode by default; here it only talks, never calls a tool.
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'I would edit the file…' },
        { type: 'result', agent: 'claude', ok: true },
      ]),
    };
    const orch = new Orchestrator(store, adapters);
    const thread = await store.create('test');

    const seen: string[] = [];
    await orch.dispatch(thread.id, '@claude fix the bug', (e) => seen.push(e.kind));
    assert.ok(seen.includes('no_tools'), 'expected a no_tools hint for a zero-tool agent turn');
  });
});

test('does not emit no_tools when the agent actually used a tool', async () => {
  await withStore(async (store) => {
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'tool_use', agent: 'claude', tool: 'Write', input: {} },
        { type: 'result', agent: 'claude', ok: true },
      ]),
    };
    const orch = new Orchestrator(store, adapters);
    const thread = await store.create('test');

    const seen: string[] = [];
    await orch.dispatch(thread.id, '@claude fix the bug', (e) => seen.push(e.kind));
    assert.ok(!seen.includes('no_tools'), 'a tool-using turn must not be flagged');
  });
});

test('does not emit no_tools when the zero-tool turn failed (it ran nothing)', async () => {
  await withStore(async (store) => {
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'result', agent: 'claude', ok: false, error: 'boom' },
      ]),
    };
    const orch = new Orchestrator(store, adapters);
    const thread = await store.create('test');

    const seen: string[] = [];
    await orch.dispatch(thread.id, '@claude fix the bug', (e) => seen.push(e.kind));
    assert.ok(!seen.includes('no_tools'), 'a failed turn must not trigger the chat-only hint');
  });
});

test('emits a turn_stats event with a wall-clock ms before agent_end', async () => {
  await withStore(async (store) => {
    const adapters = {
      claude: fakeAdapter('claude', [{ type: 'result', agent: 'claude', ok: true, text: 'done' }]),
    };
    const orch = new Orchestrator(store, adapters);
    const thread = await store.create('test');

    const events: { kind: string; ms?: number }[] = [];
    await orch.dispatch(thread.id, '@claude go', (e) =>
      events.push(e as { kind: string; ms?: number }),
    );

    const stats = events.find((e) => e.kind === 'turn_stats');
    assert.ok(stats, 'expected a turn_stats event');
    // ms is orchestrator-measured, so it is always present and non-negative
    // even when the CLI reports no usage of its own.
    assert.equal(typeof stats?.ms, 'number');
    assert.ok((stats?.ms ?? -1) >= 0, 'ms should be a non-negative wall-clock measurement');

    // It must arrive before agent_end so a UI can attach the footer to the turn.
    const statsIdx = events.findIndex((e) => e.kind === 'turn_stats');
    const endIdx = events.findIndex((e) => e.kind === 'agent_end');
    assert.ok(statsIdx >= 0 && endIdx >= 0 && statsIdx < endIdx, 'turn_stats precedes agent_end');

    // And it is persisted on the entry, so a reload still shows the timing.
    const saved = await store.get(thread.id);
    assert.equal(typeof saved?.entries[1]?.ms, 'number');
  });
});

test('passes the CLI-reported usage through to turn_stats and the saved entry', async () => {
  await withStore(async (store) => {
    const usage = { inputTokens: 100, outputTokens: 40, totalTokens: 140, costUsd: 0.012 };
    const adapters = {
      claude: fakeAdapter('claude', [
        { type: 'result', agent: 'claude', ok: true, text: 'done', usage },
      ]),
    };
    const orch = new Orchestrator(store, adapters);
    const thread = await store.create('test');

    let captured: typeof usage | undefined;
    await orch.dispatch(thread.id, '@claude go', (e) => {
      if (e.kind === 'turn_stats') captured = e.usage as typeof usage;
    });

    assert.deepEqual(captured, usage, 'turn_stats carries the adapter-reported usage verbatim');
    const saved = await store.get(thread.id);
    assert.deepEqual(saved?.entries[1]?.usage, usage, 'usage is persisted on the entry');
  });
});

// ---- env-configurable A2A guards ------------------------------------------
// orchestratorEnvOptions() reads BAI_MAX_HOPS / BAI_MAX_TURNS. We mutate the
// process env per case and restore it after, so the tests don't leak state.

/** Run fn with env[name] set to value (or deleted if undefined), then restore. */
function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const had = Object.hasOwn(process.env, name);
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    fn();
  } finally {
    if (had) process.env[name] = prev;
    else delete process.env[name];
  }
}

test('orchestratorEnvOptions: unset env yields an empty partial (defaults stand)', () => {
  withEnv('BAI_MAX_HOPS', undefined, () => {
    withEnv('BAI_MAX_TURNS', undefined, () => {
      assert.deepEqual(orchestratorEnvOptions(), {});
    });
  });
});

test('orchestratorEnvOptions: valid positive integers are read through', () => {
  withEnv('BAI_MAX_HOPS', '5', () => {
    withEnv('BAI_MAX_TURNS', '20', () => {
      assert.deepEqual(orchestratorEnvOptions(), { maxHops: 5, maxTurns: 20 });
    });
  });
});

test('orchestratorEnvOptions: invalid values are ignored, not coerced to 0', () => {
  // Each of these must leave the key absent so the Orchestrator default applies,
  // rather than clamping the guard to 0 (which would disable all handoffs).
  for (const bad of ['0', '-3', 'abc', '2.5', '', '  ']) {
    withEnv('BAI_MAX_HOPS', bad, () => {
      assert.deepEqual(orchestratorEnvOptions(), {}, `"${bad}" should be ignored`);
    });
  }
});

test('orchestratorEnvOptions: one valid, one invalid — only the valid one is set', () => {
  withEnv('BAI_MAX_HOPS', 'nope', () => {
    withEnv('BAI_MAX_TURNS', '8', () => {
      assert.deepEqual(orchestratorEnvOptions(), { maxTurns: 8 });
    });
  });
});
