# 0008 — opencode adapter + live streaming UI

## Status

Accepted.

## Agent

Claude.

## Context

Two needs drove this stage:

1. The web UI only showed results after a full turn finished. Unlike the CLI,
   it gave no live sense of "which agent is working", what tools it was calling,
   or — critically — whether it had failed to connect at all. A turn that hung
   looked identical to one making progress.
2. The `codex` CLI proved unstable on this machine, so we needed a third adapter
   to keep testing the multi-agent flow. The user runs an `opencode` "go" plan.

## Decision

### opencode adapter (third adapter, same abstraction)

Added `src/adapters/opencode.ts` as a `CliSpec` — no changes to `runCli` or the
adapter interface. This is the third agent CLI (after Claude and Codex) to plug
in by writing only a spec, which is the strongest evidence so far that the
`AgentAdapter` abstraction holds.

opencode specifics learned from real output:

- Invocation: `opencode run --format json` (prompt on **stdin**, like the others).
- Events: `step_start` (ignore), `text` (with `part.type === 'reasoning'` tagged
  as `[thinking]`), `tool_use`, `error`, and `step_finish`.
- Terminal detection: a `step_finish` is terminal only when `part.reason` is one
  of `stop` / `length` / `content-filter` / `error` / `aborted`. A reason of
  `tool-calls` means more steps follow, so it is **not** terminal — getting this
  wrong would end a turn early, mid-tool-call.
- Model selection: opencode's configured default provider can be broken (returned
  404 here), so the model is read from the `OPENCODE_MODEL` env var
  (e.g. `opencode-go/deepseek-v4-flash`). No flag is hard-coded.
- No sandbox/permission flag like Claude/Codex, so the unified `permission`
  level is intentionally not mapped onto an argument for opencode.

### Live streaming via dispatch events

Replaced the orchestrator's per-message callback with a richer `DispatchEvent`
union: `agent_start`, `message`, `agent_end`, `done`. The orchestrator now emits
these at each lifecycle point. Both callers consume them:

- **CLI** (`index.ts`): prints `…working`, tool calls, and `✓/✗` per agent.
- **Web UI**: a new `POST /api/threads/:id/stream` endpoint writes each event as
  newline-delimited JSON and flushes immediately. The browser reads the
  `ReadableStream` and renders a live, animated status line per agent, replacing
  it with the final transcript entry on `agent_end`.

NDJSON over a plain `fetch` stream was chosen over Server-Sent Events because the
request needs a POST body (the message), which `EventSource` cannot send.

### Robustness: "never connected" is a normal failure

`runCli` now attaches a `child.on('error')` handler and guards the `stdin.write`,
so a missing binary (ENOENT) or unspawnable CLI yields a clean terminal
`result { ok: false }` with a clear message instead of hanging or throwing. This
is what makes the UI able to say "couldn't start / connect" rather than spinning
forever. Covered by `test/adapter.test.ts`.

## Consequences

- Three adapters now share one code path; adding a fourth is still just a spec.
- The UI and CLI share the exact same event stream, so they can never drift in
  what they report.
- `OPENCODE_MODEL` is required for opencode runs whenever the default provider
  is unset/broken; this is documented in the README and the adapter header.
- Secrets stay in the environment (`OPENCODE_MODEL`, provider API keys) and are
  never written to disk or committed.
