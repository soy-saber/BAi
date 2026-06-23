# 0015 — Capability routing

Status: accepted
Stage: S14

## Context

Until now a message reached an agent only through an explicit `@mention`. If you
wrote "fix the failing test in parser.ts" with no `@`, nothing ran — the
orchestrator recorded the user turn and stopped (`noMatch: true`). That's a poor
default: the system knows each agent's `strengths` (see Identity), so it should
be able to send an un-addressed task to the most suitable agent instead of
dropping it.

## Decision

A new module `src/routing/capability.ts` scores agents against a task and the
orchestrator consults it **only when there is no `@mention`**.

### Scoring (`rankAgents` / `pickAgent`)

Mirrors memory recall on purpose — same primitive, same mental model:

- Tokenize the task with the shared `src/text/tokenize.ts` (stopwords and
  1-char tokens dropped).
- Tokenize each agent's `strengths` into a haystack.
- Count distinct task terms that appear as **whole words** in the strengths
  (`\bterm\b`, so "test" doesn't hit "latest").
- `rankAgents` returns every agent best-first (ties broken by agent id, so the
  order is stable and the same task always routes the same way).
- `pickAgent` returns the single best **only if score ≥ 1**. No keyword overlap
  → `undefined`, so we never guess.

### Orchestrator wiring

- `dispatch` parses mentions first. If there are mentions, nothing changes — an
  explicit `@mention` is always authoritative.
- With zero mentions and `autoRoute` on (default), it ranks only the
  **registered** agents (an identity with no adapter behind it can't be picked)
  and, on a hit, runs that one agent. A new `routed` lifecycle event is emitted
  so the CLI and web UI can show "routed to X by capability".
- With zero mentions and no keyword hit, behavior is unchanged: `noMatch: true`,
  nobody runs.
- `autoRoute: false` restores the pre-S14 behavior exactly (no-mention → no-op),
  so the change is opt-out.

### Shared tokenizer

`tokenize` / `STOPWORDS` / `escapeRegExp` moved out of `memory-store.ts` into
`src/text/tokenize.ts`. Recall and routing now share one definition of "what
counts as a meaningful word", so they can't drift apart.

## Why keyword overlap, not an LLM classifier

Routing has to be cheap, instant, and predictable — it runs before any agent
spawns, on every un-addressed message. A keyword match against declared
strengths is transparent (you can see exactly why an agent was picked) and free.
An LLM-based router would add a full turn of latency and cost just to decide who
should take the turn. Semantic routing waits for embeddings, same as recall.

## Why a suggestion, never an override

The `@mention` is the user's explicit intent; routing only fills the silence
when they didn't state one. Keeping routing strictly to the zero-mention case
means it can never surprise a user who *did* address someone — the worst failure
mode for an auto-router.

## Verification

- Unit: `test/capability.test.ts` (scoring, tie stability, stopword/whole-word
  behavior, no-match → undefined).
- Integration: `test/orchestrator.test.ts` — no-mention routes to the best
  agent, an explicit mention overrides routing, no keyword match dispatches
  nobody, and `autoRoute:false` restores the old behavior. Full suite 73 pass.

## Consequences

- Un-addressed tasks now reach someone sensible instead of vanishing.
- Routing quality is only as good as each agent's hand-written `strengths`.
  That's fine for a small fixed roster; it gets revisited when identities become
  config-driven (a later stage).
- Both recall and routing are now keyword-based and share one tokenizer — when
  embeddings land, there's a single place to upgrade the matching.
