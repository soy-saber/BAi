# 0004 — Threads, @mention routing, and a file-based store

- **Date:** 2026-06-21
- **Status:** accepted

## Context

Stage 3 turns BAi from a one-shot CLI into a stateful collaboration space:
isolated **threads** (each its own context) and **@mention routing** (a message
picks which agents run).

## Decisions

### Threads as plain JSON files

One file per thread under `data/threads/<id>.json`, behind a `ThreadStore`
class. No Redis, no SQLite yet — a thread is small, traffic is low, and files
are trivial to inspect and debug. The store exposes `create / get / list /
append`, so a different backend can drop in later without touching callers.
(`data/` is gitignored — it's local runtime state, not source.)

### @mention parsing rejects noise

`@name` routes to an agent, but only if `name` is a known adapter. The regex
`(?<![\w@])@([a-zA-Z][\w-]*)` deliberately:
- ignores unknown names (`@everyone`, `@nobody`) so typos don't spawn phantoms;
- won't match inside `bob@codex.com` (the lookbehind blocks a preceding word
  char), so email addresses aren't mistaken for mentions.

Mentions are returned in first-seen order with duplicates collapsed — that order
*is* the execution order, which matters for "design then review" flows.

### Orchestrator takes an injected adapter registry

`Orchestrator(store, adapters, runOptions)` — adapters are passed in, not
imported. That keeps the routing/transcript logic testable with **fake
adapters** that yield a scripted message stream, so Stage 3 is fully unit-tested
without spawning a real CLI (which is slow and rate-limited). The adapters
themselves were already verified live in Stages 1–2.

## Consequences

- An agent's whole message stream is collapsed into one transcript entry
  (text joined, tool calls noted as `[tool: X]`). Good enough for a transcript;
  richer per-message persistence can come later if the UI needs it.
- Sequential agent execution (mention order) is intentional for now — parallel
  fan-out is a later concern once A2A handoffs exist (Stage 5).
