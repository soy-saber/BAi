# 0011 — Transient-failure retry as an adapter wrapper

## Status

Accepted.

## Agent

Claude.

## Context

Agent CLIs fail for two very different reasons:

- **Transient** — rate limits (429), upstream 5xx, dropped sockets, "overloaded
  / try again". Retrying after a short wait usually works. (codex in particular
  was flaky on this machine, which motivated the stage.)
- **Fatal** — the CLI isn't installed, the turn was cancelled, or our own
  per-turn timeout fired. Retrying is pointless and wastes the user's time.

We wanted automatic recovery for the first kind without retrying the second.

## Decision

Retry lives in a **wrapper adapter**, `withRetry(adapter, opts)`, not inside
`runCli`. Keeping it at the adapter boundary means it composes cleanly with
timeout/cancellation (ADR 0010) instead of tangling with them, and the same
wrapper works for every CLI.

How it works:

- It buffers one attempt's messages. Only if that attempt ends in a *retryable*
  failure does it discard them and run again, with exponential backoff
  (`baseDelayMs * 2^(n-1)`).
- Success, or a fatal failure, passes the buffered messages straight through.
- `isRetryable(error)` classifies by message: a FATAL list (missing binary,
  cancelled, our timeout) wins over the RETRYABLE patterns, so e.g. a CLI
  timeout is never retried even though "timed out" sounds transient.
- A cancelled signal short-circuits any further retries.

### Registry is the single wiring point

`buildRegistry()` (in `adapters/registry.ts`) constructs the standard registry
and wraps every adapter with `withRetry`. Both the CLI and the web server build
from it, so they can't drift in which agents exist or whether retries apply.

### Surfacing retries

On each retry the wrapper yields a live `text` message
(`[retrying 2/3 after error: …]`) and calls an optional `onRetry` hook. The text
shows up in the UI stream and the transcript with no new event type — the user
sees the recovery happening.

## Consequences

- Buffering means a retried attempt's partial output is discarded, not shown
  twice — at the cost of not streaming the *first* (failed) attempt live. For
  transient failures that's the right trade: the failed attempt's output is
  usually just an error.
- Defaults (3 attempts, 1s base) are conservative; tunable per `RetryOptions`.
- Classification is string-based, so a novel transient error phrased oddly won't
  be retried. The `RETRYABLE`/`FATAL` lists are the one place to extend.
