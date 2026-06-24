# 0012 — Automatic memory sedimentation

## Status

Accepted.

## Agent

Claude.

## Context

Stages 4–5 gave the team a memory store with keyword recall, but writing to it
was manual (`bai remember …`). For memory to actually grow on its own, an
agent's turn should deposit its durable takeaways automatically — closing the
loop with recall, which already reads memory into each prompt.

## Decision

After a turn **succeeds**, the orchestrator runs `extractMemories(output)` and
records each result to the `MemoryStore` under the agent's name. This is the
write side of the same loop whose read side is recall (ADR 0005).

Extraction uses two signals, in priority order:

1. **Explicit markers** — a line `DECISION: …` or `LESSON: …`. The prompt
   preamble (`composePrompt`) now tells agents they may tag takeaways this way,
   so this is the reliable, intended path.
2. **A few natural phrasings** — "we decided to …", "lesson learned: …" — so an
   untagged but clearly-flagged takeaway still lands.

Design choices:

- **Conservative by default.** Better to miss a vague takeaway than to pollute
  memory with noise. Fragments under 4 chars are dropped; markdown and trailing
  punctuation are stripped; identical texts dedupe.
- **Only on success.** A failed turn's output (often an error or an abandoned
  plan) is not sedimented — verified by a test.
- **Verified end-to-end** on a real agent: opencode emitting
  `DECISION: store threads as JSON files …` was extracted, stored, and recalled.

## Consequences

- Memory now grows passively as the team works; a decision made in one thread
  surfaces in a later, related turn's prompt.
- Recall quality is bounded by extraction quality. Keyword recall + marker-based
  extraction is deliberately simple; the upgrade path (embeddings for recall,
  smarter extraction) is isolated to `recall()` and `extractMemories()`.
- Agents that never tag takeaways still work — sedimentation just stays quiet.
  Whether to also auto-summarize untagged turns is left for later; it risks
  noise and was intentionally not done now.
