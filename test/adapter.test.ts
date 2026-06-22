import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type CliSpec, runCli } from '../src/adapters/adapter.ts';
import type { AgentMessage } from '../src/types.ts';

/** A spec pointing at a binary that does not exist anywhere on PATH. */
const missingBinSpec: CliSpec = {
  name: 'ghost',
  bin: 'definitely-not-a-real-cli-xyzzy',
  buildArgs: () => [],
  mapEvent: () => [],
};

async function drain(gen: AsyncGenerator<AgentMessage>): Promise<AgentMessage[]> {
  const out: AgentMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

test('a missing CLI fails cleanly with a terminal result instead of hanging', async () => {
  const messages = await drain(runCli(missingBinSpec, 'hello'));

  // Exactly one terminal message, and it reports failure — not a hang, not a throw.
  const results = messages.filter((m) => m.type === 'result');
  assert.equal(results.length, 1);
  const result = results[0];
  assert.equal(result?.type, 'result');
  if (result?.type === 'result') {
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /ghost|could not start|definitely-not-a-real-cli/i);
  }
});

test('a CLI whose output is all non-JSON still yields a terminal result', async () => {
  // `node -e` prints plain text (not NDJSON); the parser should skip every line
  // and the run should still end with a synthesized failure result.
  const noisySpec: CliSpec = {
    name: 'noisy',
    bin: process.execPath, // node itself
    buildArgs: () => ['-e', 'console.log("not json"); console.log("still not json")'],
    mapEvent: () => [],
  };

  const messages = await drain(runCli(noisySpec, ''));
  const results = messages.filter((m) => m.type === 'result');
  assert.equal(results.length, 1);
  if (results[0]?.type === 'result') {
    assert.equal(results[0].ok, false);
  }
});

// A spec that runs node looping far longer than the test's timeout, so we can
// verify the per-turn timeout kills it and fails cleanly. Avoids `>` (a shell
// redirect under the Windows shell:true path) — no arrow functions.
const slowSpec: CliSpec = {
  name: 'slow',
  bin: process.execPath,
  buildArgs: () => ['-e', 'setInterval(Object,1000000000)'],
  mapEvent: () => [],
};

test('a turn that exceeds timeoutMs is killed and fails with a timeout result', async () => {
  const messages = await drain(runCli(slowSpec, '', { timeoutMs: 300 }));
  const results = messages.filter((m) => m.type === 'result');
  assert.equal(results.length, 1);
  if (results[0]?.type === 'result') {
    assert.equal(results[0].ok, false);
    assert.match(results[0].error ?? '', /timed out/i);
  }
});

test('an aborted signal cancels the turn and fails cleanly', async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 200);
  const messages = await drain(runCli(slowSpec, '', { signal: ac.signal }));
  const results = messages.filter((m) => m.type === 'result');
  assert.equal(results.length, 1);
  if (results[0]?.type === 'result') {
    assert.equal(results[0].ok, false);
    assert.match(results[0].error ?? '', /cancelled/i);
  }
});

test('an already-aborted signal fails the turn immediately', async () => {
  const messages = await drain(runCli(slowSpec, '', { signal: AbortSignal.abort() }));
  const results = messages.filter((m) => m.type === 'result');
  assert.equal(results.length, 1);
  if (results[0]?.type === 'result') {
    assert.equal(results[0].ok, false);
    assert.match(results[0].error ?? '', /cancelled/i);
  }
});
