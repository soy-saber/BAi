# 0027 — A testable HTTP layer

Status: accepted
Stage: S25
Agent: Claude

## Context

The HTTP server is the one layer in the project that had no test coverage. That
gap was not academic: twice across the build, edits to `server.ts` silently
failed to land — the file looked changed, the behavior didn't, and nothing
caught it because nothing exercised the routes. Every other layer (adapters,
orchestrator, pipeline, git, store) is tested; the server, which stitches them
all together behind a public HTTP contract, was flying blind.

The obstacle was the shape of the code. `route` was a module-private function
that reached straight for two things tests can't cheaply provide:

- A live `Orchestrator` wired to real CLI adapters — running a route would spawn
  `claude`/`codex` subprocesses.
- The process's own working directory for every git call — `gitStatus()`,
  `gitDiff(file)`, `gitStage(files)`, etc. — so a test of the stage/commit
  endpoints would mutate the *actual* BAi repo's index.

Either one makes the routes effectively untestable without a heavy, dangerous
fixture. So the routes stayed untested, and the one failure mode that bit us
twice had no guard.

## Decision

Make the router a pure function of its dependencies, and inject them.

- **Export `route`** and give it a single `deps` parameter instead of positional
  `store`/`orch` arguments:

  ```ts
  export interface RouteDeps {
    store: ThreadStore;
    orch: Orchestrator;
    gitCwd?: string;
  }
  export async function route(req, res, deps: RouteDeps): Promise<void>
  ```

- **`gitCwd` defaults to `process.cwd()`** and is threaded through all six git
  calls in the router (`gitStatus`, both `gitDiff`s, `gitStage`, `gitUnstage`,
  `gitCommit`). In production nothing changes — the default is exactly the old
  behavior. In a test, `gitCwd` points at a throwaway repo, so the git-write
  endpoints round-trip a real stage→commit without touching the project's tree.

- `startServer` now calls `route(req, res, { store, orch })` — the only
  production call site, and the place the real deps are constructed.

The test file (`test/server.test.ts`) drives the exported `route` directly with
fake `req`/`res` objects — a `Readable` carrying the JSON body, and a response
recorder that captures status, headers, and written chunks (so NDJSON streaming
is inspectable line by line). No socket is bound, no port is opened. The
orchestrator is constructed with **fake adapters** that yield a scripted message
stream, so `/send`, `/stream`, and the pipelines run end-to-end with zero
subprocesses. Live-git tests are guarded by `{ skip: !gitAvailable() }` and use
a per-test temp repo, cleaned up in `finally`.

## Consequences

- The HTTP contract is now under test: status codes, JSON error bodies, the
  `files: string[]` validation, the empty-message guards, NDJSON streaming, and
  the git stage→commit round-trip — 12 tests, the layer's first coverage. The
  exact failure mode that slipped through twice would now fail a test.
- Dependency injection stayed minimal and non-invasive: one exported interface,
  one defaulted field, no framework. Production wiring is a single literal at the
  one call site, and the default `gitCwd` means existing behavior is unchanged.
- Tests touch neither a real CLI nor the real working tree — they're fast (no
  process spawn) and safe (no chance of mutating the project's own git index).
- The pattern generalizes: any future route that reaches for an external
  dependency should take it through `RouteDeps` rather than reaching for a
  module-level singleton, keeping the layer testable as it grows.
