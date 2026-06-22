import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentAdapter, RunOptions } from '../src/adapters/adapter.ts';
import { isRetryable, withRetry } from '../src/adapters/retry.ts';
import type { AgentMessage } from '../src/types.ts';

/**
 * A fake adapter that fails (retryably or fatally) for its first `failCount`
 * turns, then succeeds. Records how many times it was actually run.
 */
function flakyAdapter(
  failCount: number,
  error = 'rate limit (429)',
): AgentAdapter & { runs: number } {
  const a = {
    name: 'flaky',
    runs: 0,
    async *run(_p: string, _o?: RunOptions): AsyncGenerator<AgentMessage> {
      a.runs++;
      if (a.runs <= failCount) {
        yield { type: 'result', agent: 'flaky', ok: false, error };
      } else {
        yield { type: 'text', agent: 'flaky', text: 'success' };
        yield { type: 'result', agent: 'flaky', ok: true };
      }
    },
  };
  return a;
}

async function drain(gen: AsyncGenerator<AgentMessage>): Promise<AgentMessage[]> {
  const out: AgentMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

test('isRetryable: transient errors retry, fatal ones do not', () => {
  assert.equal(isRetryable('rate limit hit'), true);
  assert.equal(isRetryable('HTTP 503 from upstream'), true);
  assert.equal(isRetryable('socket hang up'), true);
  assert.equal(isRetryable("could not start 'claude': ENOENT"), false);
  assert.equal(isRetryable('claude cancelled'), false);
  assert.equal(isRetryable('claude timed out after 600000ms'), false);
  assert.equal(isRetryable(undefined), false);
  assert.equal(isRetryable('some ordinary error'), false);
});

test('retries a transient failure then succeeds', async () => {
  const adapter = flakyAdapter(2);
  const wrapped = withRetry(adapter, { maxAttempts: 3, baseDelayMs: 1 });
  const messages = await drain(wrapped.run('hi'));
  assert.equal(adapter.runs, 3); // 2 failures + 1 success
  const last = messages.at(-1);
  assert.equal(last?.type === 'result' && last.ok, true);
});

test('gives up after maxAttempts and emits the final failure', async () => {
  const adapter = flakyAdapter(99); // always fails
  const wrapped = withRetry(adapter, { maxAttempts: 3, baseDelayMs: 1 });
  const messages = await drain(wrapped.run('hi'));
  assert.equal(adapter.runs, 3);
  const last = messages.at(-1);
  assert.equal(last?.type === 'result' && last.ok, false);
});

test('does not retry a fatal failure', async () => {
  const adapter = flakyAdapter(99, "could not start 'flaky': ENOENT");
  const wrapped = withRetry(adapter, { maxAttempts: 3, baseDelayMs: 1 });
  await drain(wrapped.run('hi'));
  assert.equal(adapter.runs, 1); // fatal → no retry
});

test('onRetry hook fires once per retry with attempt info', async () => {
  const adapter = flakyAdapter(2);
  const calls: number[] = [];
  const wrapped = withRetry(adapter, {
    maxAttempts: 3,
    baseDelayMs: 1,
    onRetry: (info) => calls.push(info.attempt),
  });
  await drain(wrapped.run('hi'));
  assert.deepEqual(calls, [1, 2]); // retried after attempt 1 and attempt 2
});

test('does not retry when the run was cancelled', async () => {
  const adapter = flakyAdapter(99);
  const wrapped = withRetry(adapter, { maxAttempts: 3, baseDelayMs: 1 });
  await drain(wrapped.run('hi', { signal: AbortSignal.abort() }));
  assert.equal(adapter.runs, 1); // aborted → no retry
});
