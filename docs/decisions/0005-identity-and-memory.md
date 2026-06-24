# 0005 — Persistent identity + shared memory via prompt re-injection

- **Date:** 2026-06-21
- **Status:** accepted
- **Agent:** Claude

## Context

Stage 4 gives each agent a durable self (role, persona) and the team a shared,
growing knowledge base — both surviving across sessions and context compaction.

The hard question: a model has no long-term memory of its own, and each CLI
manages (and compacts) its own context differently. How do we make "who you are"
and "what the team knows" persist without depending on any one CLI's memory?

## Decision

**Re-inject everything as a prompt preamble on every turn.** Don't assume
anything persists inside the model. Before each turn `composePrompt` assembles:

1. **Identity block** — who the agent is (`src/identity/identity.ts`).
2. **Iron Laws block** — the non-negotiable constraints, always present
   (`src/identity/iron-laws.ts`).
3. **Relevant memory block** — memories recalled for this message (may be empty).
4. **The message** itself.

Because this happens every turn, a context reset or a fresh session changes
nothing: the agent is re-told who it is and what matters, every time.

### Memory: append-only JSONL + keyword recall

`MemoryStore` writes to `data/memory.jsonl` (append-only — cheap, human-
readable, and aligned with the Iron Law against deleting stores). Two kinds:
`decision` (a choice + why) and `lesson` (something learned). Recall is
keyword-overlap scored, recency as tiebreak — deliberately simple and
transparent before reaching for embeddings.

### Iron Laws are first-class

The four laws (data sanctuary, process self-preservation, config immutability,
network boundary) are code, not just docs — injected into every prompt. This is
the Stage 4 commitment from the roadmap: add guardrails as soon as agents can
touch files.

## Consequences / pitfalls

- Every turn pays a token cost for the preamble. Acceptable now; if it grows,
  identity/laws can be cached or moved to a real system-prompt flag per CLI.
- Recall is lexical, so it misses synonyms. Fine as a first cut; the `recall`
  method is the single place to upgrade to embeddings later.
- Identity injection is CLI-agnostic (it's just prompt text), so it worked
  without per-adapter changes — the same reason the adapter abstraction paid off.
