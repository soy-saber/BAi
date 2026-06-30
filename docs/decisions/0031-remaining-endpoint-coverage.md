# 0031 — Coverage for the last untested endpoints

Status: accepted
Stage: S29
Agent: Claude

## Context

Stage 25 made the HTTP router testable and covered the thread and write-side git
endpoints; Stage 28 covered the two pipeline endpoints. That left three routes
still untested — the last blind spots in the server:

- `GET /api/agents` — the agent list the UI's @mention autocomplete and legend
  are built from (id, display name, role, strengths).
- `GET /api/git/diff?file=` — the unified diff the UI renders per file.
- `POST /api/git/unstage` — the inverse of stage, with the same `files: string[]`
  validation; `/stage` and `/commit` were tested but `/unstage` was not.

None of these are intricate, but "not intricate" is exactly the code that gets
an edit that silently doesn't land — the failure mode Stage 25 exists to catch.
With these three done, every route in `route()` has at least one test.

## Decision

Add four tests to `test/server.test.ts`, on the Stage 25 harness (exported
`route`, fake req/res, injected `RouteDeps`, a temp git repo for `gitCwd`):

1. **`/api/agents` lists agents with identity** — asserts a 200 and that
   `claude` is present with the metadata shape the UI needs (string name/role,
   array of strengths). The endpoint reads the module-level registry, not the
   injected orchestrator, so the set is stable; `claude` carries a full identity
   and is the safe anchor.
2. **`/api/git/diff` returns a unified diff for one file** — commits a baseline
   into the temp repo, edits the file, and asserts the response carries the
   file name and a diff containing the added line (`+two`), with `untracked`
   not set.
3. **`/api/git/unstage` rejects a non-array body (400)** — the input guard,
   mirroring the existing `/stage` validation test.
4. **`/api/git/unstage` moves a staged file back out** — stages a file, unstages
   it, and asserts via `/status` that it's still a changed file but no longer
   staged. Exercises the stage→unstage round-trip through the endpoints.

The git-touching tests are guarded by `{ skip: !gitAvailable() }`, like the rest
of the live-git suite.

## Consequences

- Every route in the server now has test coverage. The three "too simple to
  break" endpoints are no longer the unguarded ones, closing the Stage 25 gap
  for good.
- The assertions pin observable contracts the UI depends on: the agent metadata
  shape its autocomplete reads, the diff body shape its per-file view renders,
  and the staged→unstaged status transition its git panel reflects.
- No new scaffolding — the injected-deps harness covered all three with the same
  fakes and temp-repo pattern, the fourth reuse of the Stage 25 design.
- The git endpoints (status, diff, stage, unstage, commit) now have a full
  read-and-write round-trip under test, so a regression in the no-shell git
  layer's wiring would surface here, not in production.
