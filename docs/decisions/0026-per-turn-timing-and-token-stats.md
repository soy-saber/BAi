# 0026 — Per-turn timing and token stats

Status: accepted
Stage: S24
Agent: Claude

## Context

Every turn already streams *what* an agent did — its text, tool calls, and
whether it connected. What it never showed was the *cost* of that turn: how long
it took and how many tokens (or dollars) it burned. Once threads run several
agents across audit/security/review pipelines, "which step is slow or expensive"
becomes a real question, and the answer was nowhere in the transcript or the UI.

The friction is that each CLI reports usage differently, and some don't report
it at all:
- Claude emits `usage.{input_tokens,output_tokens}` plus `total_cost_usd` on its
  result event.
- codex emits `usage.{input_tokens,output_tokens}` on `turn.completed`.
- gemini emits a `stats` blob whose shape has drifted across versions
  (prompt/input/promptTokenCount, etc.).
- opencode emits `tokens.{input,output,total}` on `step_finish`.

So token/cost numbers are *best-effort* — present when the CLI gave them, absent
otherwise — but wall-clock time is something we can always measure ourselves.

## Decision

A `Usage` interface in `src/types.ts` with **all-optional** fields
(`inputTokens?`, `outputTokens?`, `totalTokens?`, `costUsd?`), carried on
`ResultMessage` and persisted on `ThreadEntry` alongside a new `ms?` field.

Two sources of truth, split by what's reliable:
- **`ms` is measured in the orchestrator**, CLI-agnostically: `Date.now()` around
  the `consume` call in `runTurn`. Always present.
- **`usage` is extracted per-adapter** from each CLI's terminal event, and
  **conditionally spread** (`...(usage ? { usage } : {})`) so an adapter that has
  nothing to report emits no `usage` key at all — rather than `usage: undefined`,
  which would break the `deepStrictEqual` shape the adapter tests assert.

Surfaced three ways, all reading the same persisted numbers:
- A new dispatch event `{ kind: 'turn_stats', agent, ms, usage? }`, emitted right
  before `agent_end`, so a live UI can show the cost the instant a turn ends.
- CLI: `render()` prints `· 12.3s · 1.2k tok · $0.04` under each turn.
- UI: `app.js` stashes `turn_stats` per agent and appends a `.stats` footer to the
  entry; `renderEntries` shows the persisted stats on reload.

`formatStats(ms, usage)` is the one formatter (duplicated CLI/UI side): seconds
with one decimal, tokens with a `k` suffix at ≥1000 (preferring `totalTokens`,
else `input+output`), cost as `$X.XX` (or `$X.XXXX` under a cent). Each piece is
omitted when its number is missing, so a CLI that only gives time shows just the
time.

## Consequences

- The transcript and UI now carry a cost signal per turn without a second pass —
  the orchestrator already had the result message in hand; this just reads two
  more fields off it and times the call it was already awaiting.
- Token/cost coverage tracks whatever each CLI chooses to report. A turn from an
  agent that reports nothing still shows its wall-clock time; that's the floor.
- The conditional-spread discipline (no `undefined` keys) is now load-bearing
  across all four adapters — the message shape stays exact, so adapter tests keep
  asserting equality rather than loose matching.
- Per-thread or per-pipeline cost *rollups* are a later stage if wanted; this
  records the per-turn numbers that any rollup would sum.
