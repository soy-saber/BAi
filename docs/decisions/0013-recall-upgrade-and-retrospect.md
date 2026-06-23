# 0013 — Recall upgrade + team retrospective

Status: accepted
Stage: S12

## Context

Two gaps after S11 (memory sedimentation):

1. **Recall was naive.** Scoring counted raw substring hits of every query
   word, including stopwords. "the" or "use" matched almost everything, so a
   long query surfaced noise and ties were broken arbitrarily.
2. **Memory only accumulated — it never got sharper.** The store grew with
   raw decisions and lessons, but nothing ever reviewed them to find patterns.
   A real team reflects: "we keep tripping on X", "Y is our convention now".

## Decision

### Recall scoring

`MemoryStore.recall` now:

- **Tokenizes with a stopword filter** and drops 1-char tokens, so only
  meaningful terms score.
- **Matches on word boundaries** (`\bterm\b`) instead of substrings, so
  "cat" no longer matches "concatenate".
- **Adds a recency bonus** in `[0, 0.5)` that breaks ties toward newer
  memories but can never outweigh a real keyword hit.
- **Adds a small `insight` bonus** (`+0.25`) so distilled takeaways edge out
  raw entries of equal keyword relevance.
- **Requires score ≥ 1** (at least one real keyword hit) for non-empty
  queries; the recency/insight bonuses alone (< 1) never surface noise.

### Team retrospective (`src/identity/retrospect.ts`)

A new memory kind, **`insight`**, plus `runRetrospect(agent, memory)`:

- Pulls the most recent **non-insight** memories (raw material, not prior
  distillations) — default batch 20.
- Hands them to an agent with a prompt asking for up to 3 durable, general
  takeaways, each on an `INSIGHT:` line (or `NONE`).
- Parses the markers, **dedupes against existing insights** (case-insensitive
  exact text), and records the rest as `insight` memories.
- Runs through the normal `AgentAdapter`, so it inherits streaming, timeout,
  cancellation, and retry for free.

Exposed as `bai retrospect [agent] [batch]`.

## Why an agent, not code

Distilling "what's the pattern across these 20 notes" is exactly what an LLM
is good at and code is bad at. Keeping the distillation in an agent turn (vs.
a hand-written heuristic) is the point: the team reflects on itself using the
same machinery it uses for everything else.

## Why dedupe by exact text

Cheap and predictable. Two retrospectives over overlapping material will
re-propose the same insight; exact-match dedupe stops the store from filling
with near-identical lines without needing similarity thresholds yet. Semantic
dedupe waits for embeddings (a later stage), same as recall.

## Verification

- Unit: `test/memory-store.test.ts` (recall scoring), `test/retrospect.test.ts`
  (parse + run + dedupe + no-op + insight-exclusion). Full suite 52 pass.
- Real machine: seeded 4 memories, ran `bai retrospect opencode`, which
  distilled 3 insights (e.g. "classify failures retryable vs fatal before
  deciding retry policy") from concrete decisions/lessons. Closed loop:
  raw memory → reflection → insight stored → recallable next turn.

## Consequences

- The team's knowledge now compresses, not just grows. This is the seed of
  self-evolution (a full epoch-two goal).
- Retrospect is on-demand for now (a CLI command). Scheduling it (e.g. every
  N turns, or nightly) is a later stage.
- Exact-text dedupe and keyword recall are both deliberately simple; both get
  replaced by embeddings when scale demands it.
