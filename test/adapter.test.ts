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
