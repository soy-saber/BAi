# 0003 — The AgentAdapter abstraction (proven across two CLIs)

- **Date:** 2026-06-21
- **Status:** accepted

## Context

Stage 2 adds a second agent (`codex`) next to `claude`. The point isn't "support
two agents" — it's to force the unified layer to be a *real* abstraction rather
than something secretly shaped around Claude. If a second, differently-shaped
CLI slots in cleanly, the abstraction holds.

## How different the two CLIs actually are

| | Claude | Codex |
|---|---|---|
| Invocation | `claude -p --output-format stream-json --verbose` | `codex exec --json --sandbox <mode> -` |
| Text | `assistant` event, `message.content[]` `text` blocks | `item.completed`, `item.type=agent_message`, `item.text` |
| Tool use | `tool_use` content block (`name`, `input`) | `item.completed`, `item.type=file_change`/`command_execution` |
| Terminal | single `result` event (`is_error`, `result`) | `turn.completed` / `turn.failed` |
| Permission | `--permission-mode` / `--dangerously-skip-permissions` | `--sandbox read-only|workspace-write|danger-full-access` |

Same surface format (one JSON per line), completely different schemas.

## Decision

Three pieces:

1. **`AgentAdapter`** — `{ name, run(prompt, options) }`, `run` async-iterates
   `AgentMessage`s. This is all the rest of BAi sees.
2. **`runCli`** — shared turn runner. Spawn + stdin prompt + line-by-line NDJSON
   parse + guaranteed terminal `result` are identical across CLIs, so they live
   here once.
3. **`CliSpec`** — the only per-CLI surface: `bin`, `buildArgs(permission)`, and
   `mapEvent(event, agent)`. An adapter is now ~50 lines of pure mapping.

Unified `permission` levels (`default` / `acceptEdits` / `bypass`) map onto each
CLI's native mechanism in `buildArgs`, so callers never learn CLI-specific flags.

## Why this split

The spawn/parse/terminal-guarantee logic was about to be copy-pasted into the
codex adapter verbatim. Extracting `runCli` keeps it in one place; adding a
third CLI (Gemini, opencode, ...) now means writing only a `CliSpec`.

## Consequences / pitfalls

- **Codex emits both `item.started` and `item.completed`** for the same item;
  we map only `item.completed` so each action surfaces exactly once.
- **Latency / rate limits are real.** A Claude turn was SIGTERM-killed at a 120s
  timeout (hit a 429 retry, see ADR 0002); it succeeded with a longer budget.
  Turn timeouts will need to be generous and configurable, not hard-coded.
- `tool_use.input` is intentionally `unknown` — its shape differs per CLI and
  per tool (Claude: tool args object; codex: a `changes[]` array). Consumers
  that care must narrow it.
