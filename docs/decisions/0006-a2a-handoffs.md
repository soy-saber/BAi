# 0006 — A2A handoffs: agents that call each other

- **Date:** 2026-06-21
- **Status:** accepted

## Context

Stage 5 is the payoff: agents working *together* without the human relaying
between them. The canonical flow is cross-model review — claude writes code,
finishes with "@codex please review", and codex runs automatically on what
claude produced.

## Decision

Model agent-to-agent (A2A) communication as **handoffs detected in agent
output**, drained by the orchestrator as a bounded queue.

- `detectHandoffs(from, output, known, hop)` — after an agent replies, scan its
  output for known @mentions (excluding itself). Each becomes a `Handoff` with
  an incremented hop count.
- The orchestrator seeds a queue with the human turn's mentions at `hop: 0`,
  then drains it: run the target, persist its reply, and enqueue any handoffs it
  in turn produced.
- `handoffPrompt` frames the next agent's input: the original request + the
  prior agent's output + an instruction to act on the handoff.

Reusing the same `@mention` parser for both human→agent routing (Stage 3) and
agent→agent handoffs keeps one mental model: *mentioning an agent runs it*,
whether you wrote the message or another agent did.

## The loop problem

Two agents can ping-pong forever (`@codex` ... `@claude` ... `@codex`). A
**hop cap** (`maxHops`, default 3) bounds the chain: once a handoff would exceed
the cap, it's dropped. The test `the hop cap stops a two-agent @-loop` pins this
behavior — without the cap that test would hang.

## Consequences / pitfalls

- Handoffs run **after** an agent fully completes (we need its output to detect
  the mention), so this is sequential, not interleaved. Fine for review flows;
  true concurrency is out of scope.
- The hop cap is a blunt instrument — it stops loops but also caps legitimate
  deep chains. A smarter guard (detect repetition, not just depth) is a future
  refinement; depth is the simplest thing that's provably safe.
- An agent's output is trusted as-is when scanning for mentions. A future
  hardening step: only honor handoffs in a designated section, so an agent
  quoting "@codex" in prose doesn't accidentally trigger a run.
