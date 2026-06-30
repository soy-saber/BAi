# 0030 — Tests for the pipeline endpoints

Status: accepted
Stage: S28
Agent: Claude

## Context

Stage 25 made the HTTP router testable and gave the thread and git endpoints
their first coverage, after edits to `server.ts` had twice failed to land with
nothing to catch it. But that first pass stopped at the simple endpoints. The
two *pipeline* endpoints — `POST /api/threads/:id/audit` (the security-audit
pipeline) and `POST /api/threads/:id/review` (the diff-review pipeline) — were
left untested.

Those are the most intricate routes in the server. Each:

- runs a multi-stage pipeline (`find → verify`, `review → gatekeep`) rather than
  a single agent turn,
- streams **NDJSON** rather than a single JSON body, and
- interleaves two kinds of events on the wire: per-turn dispatch lifecycle
  events and pipeline events wrapped as `{ kind: 'pipeline', ... }`.

That is exactly the kind of wiring that breaks silently — a stage that never
runs, a pipeline event that isn't wrapped, a stream that isn't flushed — and it
was the one part of the server with no test guarding it. `/review` had a single
400 test (clean tree) but nothing exercising the happy path where the pipeline
actually runs.

## Decision

Add three tests to `test/server.test.ts`, reusing the Stage 25 harness (the
exported `route`, fake req/res, injected `RouteDeps`, fake adapters, a temp git
repo for `gitCwd`):

1. **`/audit` rejects an empty target (400)** — the input guard, no pipeline.
2. **`/audit` streams both pipeline stages over NDJSON** — fake `claude` (find)
   and `codex` (verify) adapters let the whole security-audit pipeline run with
   no CLI. Asserts the response is NDJSON, that the wrapped pipeline
   `stage_start` events are exactly `['find', 'verify']` in order, and that
   per-turn dispatch events (`agent_start`) are interleaved alongside them.
3. **`/review` runs the pipeline over a dirty tree** — commits a baseline into
   the temp repo, then edits the file so `git diff` is non-empty, and asserts
   the diff-review pipeline's `stage_start` events are `['review', 'gatekeep']`.
   Complements the existing clean-tree 400 test: clean tree → 400, dirty tree →
   the pipeline runs.

The git-touching tests are guarded by `{ skip: !gitAvailable() }`, like the rest
of the live-git suite. Scripting both stages' agents is what makes the pipeline
runnable end-to-end in-process: each fake adapter yields a `text` then a `result`
message, so the pipeline sees a successful stage and advances to the next.

## Consequences

- The two pipeline endpoints now have happy-path coverage: NDJSON streaming, the
  dispatch-plus-pipeline event interleaving, and correct stage ordering for both
  pipelines. The server's most intricate routes are no longer the untested ones.
- The Stage 25 harness paid off again — three tests, no new scaffolding. The
  injected-deps design means a pipeline runs against scripted adapters and a
  throwaway repo, with no CLI spawned and no real working tree touched.
- The assertion is on the *observable wire format* (the NDJSON event stream a
  real client parses), not on internals, so it pins the contract a browser
  depends on rather than an implementation detail.
- Coverage of the pipeline *logic itself* (fallback on a failed stage, gatekeep
  reading the prior stage) still lives in `test/pipeline.test.ts` and the
  audit/security/diff-review suites; these new tests cover the HTTP *delivery*
  of that logic, which is the part that was blind.
