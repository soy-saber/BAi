/**
 * Retry wrapper for agent adapters.
 *
 * Wraps any AgentAdapter so a turn that fails for a *transient* reason (rate
 * limit, temporary network error, a crash with no output) is retried a few
 * times with exponential backoff. Fatal reasons (missing CLI, cancellation,
 * timeout) are never retried — retrying them just wastes time.
 *
 * It works at the adapter boundary: it buffers one turn's messages, and only if
 * that turn ends in a retryable failure does it discard them and run again. A
 * successful or partially-streamed-then-failed-fatally turn is passed through.
 */

import type { AgentMessage } from '../types.js';
import type { AgentAdapter, RunOptions } from './adapter.js';

export interface RetryOptions {
  /** Max attempts total (including the first). Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms; attempt N waits baseDelayMs * 2^(N-1). Default 1000. */
  baseDelayMs?: number;
  /** Hook so callers can surface "retrying (2/3)" status. */
  onRetry?: (info: { agent: string; attempt: number; max: number; reason: string }) => void;
}

/** Patterns in an error message that mean "transient — worth retrying". */
const RETRYABLE = [
  /rate.?limit/i,
  /\b429\b/,
  /\b5\d\d\b/, // 5xx
  /timed?.?out/i, // network/server timeout reported by the CLI (not our own kill)
  /econnreset|econnrefused|etimedout|enotfound|socket hang up/i,
  /temporar|try again|overloaded|unavailable/i,
];

/** Reasons we must NOT retry, even if they also match a retryable pattern. */
const FATAL = [
  /could not start/i, // missing binary (ENOENT)
  /cancelled/i, // user/abort
  / timed out after \d+ms/i, // our own per-turn timeout kill
];

export function isRetryable(error: string | undefined): boolean {
  if (!error) return false;
  if (FATAL.some((re) => re.test(error))) return false;
  return RETRYABLE.some((re) => re.test(error));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Wrap an adapter so transient-failure turns are retried with backoff. */
export function withRetry(adapter: AgentAdapter, options: RetryOptions = {}): AgentAdapter {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;

  return {
    name: adapter.name,
    async *run(prompt: string, runOptions?: RunOptions): AsyncGenerator<AgentMessage> {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Buffer this attempt's messages; we only emit them once we know whether
        // the turn succeeded or failed retryably.
        const buffered: AgentMessage[] = [];
        let failure: string | undefined;
        for await (const message of adapter.run(prompt, runOptions)) {
          buffered.push(message);
          if (message.type === 'result' && !message.ok) failure = message.error ?? 'failed';
        }

        const canRetry =
          attempt < maxAttempts && isRetryable(failure) && !runOptions?.signal?.aborted;
        if (!canRetry) {
          // Final attempt, success, or fatal failure: emit what we have.
          yield* buffered;
          return;
        }

        // Retryable: tell the caller, back off, and try again. The notice is
        // yielded live (not buffered) so the UI shows it immediately; the failed
        // attempt's buffered messages are discarded.
        options.onRetry?.({
          agent: adapter.name,
          attempt,
          max: maxAttempts,
          reason: failure ?? 'failed',
        });
        yield {
          type: 'text',
          agent: adapter.name,
          text: `[retrying ${attempt + 1}/${maxAttempts} after error: ${failure}]`,
        };
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    },
  };
}
