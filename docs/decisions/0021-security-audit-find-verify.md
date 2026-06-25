# 0021 — Security audit: find → verify (adversarial)

Status: accepted
Stage: S19
Agent: Claude

## Context

Stage 15 (ADR 0016) shipped a generic `auditPipeline`: Claude audits code, then
codex/GPT "gatekeeps" the audit (is it sound, did it miss anything), falling back
to opencode. That answers *"is the audit any good"* — a review of the review.

The requested workflow is sharper and is the one teams actually want: **one agent
does a first-pass audit and finds the vulnerabilities; a second agent verifies
whether each reported vulnerability's whole flow truly exists** — is the source
really attacker-controlled, does the taint reach the sink unsanitized, is it
exploitable in practice, or is it a false positive. The value is not "grade the
audit," it's *adversarial confirmation of each finding's end-to-end flow*.

## Decision

A second concrete pipeline, `securityAuditPipeline()` in `src/routing/pipeline.ts`,
reusing the same `runPipeline` engine (no new machinery):

- **find** (default `claude`, tool-capable): finds real vulnerabilities and, for
  *each*, lays out the complete data-flow — Source (where untrusted input enters,
  file:line), Sink (the dangerous op), Flow (how it travels and why nothing
  sanitizes it), Trigger (a concrete exploit input), Fix. The structure exists so
  each finding is *independently checkable* by the next stage. The prompt forbids
  reporting a vuln whose flow can't be traced end to end.
- **verify** (default `codex`/GPT, fallback `opencode`): explicitly told **not to
  redo the audit**. For each finding it decides whether the entire flow exists and
  is exploitable, emitting one line per finding —
  `#N — CONFIRMED | FALSE POSITIVE | UNCERTAIN(need: …) — why` — then notes
  anything missed, and ends with `VERDICT: <#confirmed / #false-positive /
  #uncertain — overall risk>`.

Agent ids are parameterized (`finder` / `verifier` / `verifierFallback`), so the
flow isn't hard-bound to specific adapters.

Exposed three ways:
- CLI: `bai secaudit <threadId> "<target>"` (the generic `bai audit` is kept).
- Web UI: a 🛡 Audit button beside Send posts the composer text to a streaming
  `POST /api/threads/:id/audit`; the live log renders the new `pipeline`
  (stage_start / fallback / stage_end) events alongside the per-agent stream.

## Why this composes with chat-mode + @file: (Stage 18)

The verifier is often a chat-only model (your `codex` CLI bound to a tool-less
model like gemini-3.1-pro). It can't read the workspace itself — but the audit
target is given as `@file:` references, and the orchestrator already inlines those
contents for chat-mode agents (ADR 0020). So the verifier *sees the actual code*
it's asked to confirm the flow against, fed by BAi rather than read by the model.
The tool-capable finder opens files itself. Each side gets the code by the right
mechanism, automatically — no special-casing in the pipeline.

## Why a second pipeline, not a flag on the first

The generic audit ("review this audit") and the security find→verify ("confirm
each vuln flow") have genuinely different prompts and different success criteria.
Folding them into one with a mode flag would tangle two prompt sets behind a
conditional for no gain. They share everything that matters — the `runPipeline`
engine, fallback semantics, streaming, persistence — so the duplication is just
two `Stage` definitions, which is exactly the unit ADR 0016 said new workflows
should be.

## Why fallback only on failure-to-run still holds

Same crux as ADR 0016: "the verifier says finding #2 is a false positive" is the
*result we want*; "the verifier couldn't start" is an outage. Fallback triggers
strictly on `ok: false` (spawn error / timeout / crash), never on a verdict, so we
never shop a sound rejection around to a different model until one rubber-stamps
it.

## Verification

- Unit (`test/security-audit.test.ts`, 5 cases): the find→verify→fallback wiring,
  id overridability, the find prompt demanding a full source→sink flow per
  finding, the verify prompt embedding the first-pass findings + classification
  labels + verdict (and *not* redoing the audit), and graceful degradation when
  the find stage produced nothing. The shared engine's fallback/exhaustion/
  chain-break/negative-verdict behavior is already covered by `pipeline.test.ts`.
- Full suite: 116 pass, tsc clean.
- Real machine: the find leg runs on Claude (tool-capable, available). The verify
  leg on codex/gemini is subject to the same CLI/key caveats as ADR 0014/0016; the
  pipeline + fallback logic itself is fully covered by fakes.

## Consequences

- BAi now has a real, adversarial security-audit workflow, not just a review of a
  review — and it's wired into the actual UI, not CLI-only.
- Adding more verification stages (e.g. a third "exploit PoC" stage) is one more
  `Stage` definition.
- Both audit pipelines coexist; `bai audit` for general code-quality auditing,
  `bai secaudit` / 🛡 Audit for vulnerability find→verify.
