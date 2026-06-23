# 0016 — Audit pipeline with agent fallback

Status: accepted
Stage: S15

## Context

Until now collaboration was either a human `@mention` or an agent-initiated A2A
handoff — both *reactive*. The requested workflow is *prescriptive*: a fixed
quality process where one agent does the work and another gatekeeps it, with a
backup agent ready if the gatekeeper can't be reached.

The concrete ask: **Claude audits code → GPT/Codex reviews that audit → if Codex
can't be pulled up, fall back to opencode.** This is a recurring shape (do →
verify, with redundancy), not a one-off.

## Decision

A small **pipeline** layer (`src/routing/pipeline.ts`) on top of the
orchestrator:

- A `Stage` names a `primary` agent, an ordered `fallbacks` list, and a
  `buildPrompt(task, prior)` that can read every earlier stage's output — so a
  later stage gatekeeps an earlier one.
- `runPipeline` runs stages in order. Within a stage it tries primary, then each
  fallback, **falling back only when an agent fails to *run*** (`ok: false` —
  spawn error, timeout, crash). A completed turn is a success even if its
  content is a negative verdict.
- A stage that exhausts every agent **breaks the chain**: later stages depend on
  its output, so a gatekeep with no audit to read is meaningless.
- `auditPipeline()` is the concrete claude → codex → (opencode) wiring, with the
  agent ids parameterized so it isn't hard-bound to specific adapters.

Exposed as `bai audit <threadId> "<target>"`. Stages run through a new public
`Orchestrator.runOne`, so they inherit identity, memory recall/sedimentation,
streaming, timeout, cancellation, and transcript persistence for free.

## Why fall back on failure-to-run, never on a verdict

This is the crux. "Codex says the audit is wrong" is a *result we want* — it's
the gatekeeper doing its job. "Codex couldn't start" is an *outage*. Conflating
them would make the pipeline retry a sound rejection on a different model until
someone rubber-stamps it — the opposite of a quality gate. So the fallback
trigger is strictly the same `ok: false` the adapter layer already uses for
"this agent didn't run," which retry (ADR 0011) classifies and the orchestrator
surfaces unchanged.

## Why a thin layer, not a new engine

The orchestrator already does the hard parts (spawn/parse/persist/recall). A
pipeline is just *which agent, in what order, with what prompt* — pure
sequencing. Keeping it a thin function over `runOne` means pipelines get every
future orchestrator improvement automatically, and stay trivially testable with
fake adapters (no CLI).

## Verification

- Unit (`test/pipeline.test.ts`, 7 cases): stage ordering + prompt threading,
  fallback on failure, exhaustion when all fail, chain-break on a failed stage,
  **negative-verdict-is-still-success** (no spurious fallback), the concrete
  `auditPipeline` wiring, and event emission. Full suite 80 pass.
- Real machine: deferred for the codex/gemini legs (codex unstable, gemini key
  403'd — see ADR 0014); the fallback logic itself is fully covered by fakes.

## Consequences

- BAi now has prescriptive workflows, not just reactive routing. More pipelines
  (e.g. design → implement → test) are now just more `Stage[]` definitions.
- Fallback is per-stage and config-driven, so swapping the gatekeeper or adding
  a third backup is a one-line change, no new code.
- Pipelines are linear for now. Branching/conditional stages (e.g. "only run
  stage 3 if the verdict was revise") wait until a real workflow needs them.
