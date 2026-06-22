# 0010 — Per-turn timeout and cancellation

## Status

Accepted.

## Context

A turn drives an external CLI we don't control. It can hang (network stall,
wedged process) or simply run longer than the user wants to wait. Before this
stage there was no way to bound a turn or stop one in flight — a hung CLI would
wedge the dispatch forever.

## Decision

Two controls on `runCli`, exposed through `RunOptions`:

- **`timeoutMs`** — after this long, the child is killed and the turn ends with a
  failed result (`… timed out after Nms`). Default is generous (10 min via
  `BAI_TURN_TIMEOUT_MS` in the server) because agent turns legitimately take
  minutes (rate-limit waits, long tool runs); the goal is to catch *hangs*, not
  to rush normal work.
- **`signal`** (`AbortSignal`) — external cancellation. The web UI's Send button
  becomes a **Stop** button during a turn; clicking it aborts the `fetch`, which
  closes the HTTP request; the server maps `req 'close'` to `AbortController`,
  and the orchestrator threads the signal down to `runCli`.

Both funnel into one `kill(reason)` that records why the turn ended so the
synthesized terminal result is accurate.

## Windows kill is not just `child.kill()`

Under `shell: true` (required on Windows, see ADR 0002) the child is `cmd.exe`,
and killing it can leave the real grandchild alive with the stdout pipe open —
which hangs the readline loop forever. Getting cancellation to actually work
took three fixes, each found by a test that hung:

1. **Kill the whole tree** — `taskkill /pid <pid> /t /f` on Windows, not just
   `child.kill()`.
2. **Close the readline interface** — destroying the stdout stream alone does
   *not* reliably end a `for await … of readline` loop; `lines.close()` does.
   `kill()` calls both.
3. **Short-circuit an already-aborted signal** — if the signal is aborted before
   the turn starts, don't spawn at all; closing readline *after* creating it on a
   dead stream still hangs, so we yield the failure result and return early.

## Consequences

- Cancellation and timeout are covered by tests that would hang (not just fail)
  if regressed — a strong signal.
- The same `kill()` path serves both timeout and abort, so they can't diverge.
- The dispatch loop also checks `signal.aborted` between handoffs, so cancelling
  stops the whole A2A chain, not just the current agent.
