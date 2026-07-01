# 0033 — Converge on two pipelines: independent-verify, not supervise-the-report

Status: accepted
Stage: S31
Agent: Claude

## Context

The project had grown three pipelines that all share one skeleton — a
two-stage "stage-1 produces, stage-2 checks stage-1's output" chain, defaults
claude → codex → opencode:

- `auditPipeline` — audit → **gatekeep** (a reviewer judges the audit report)
- `securityAuditPipeline` — find → **verify** (a second agent independently
  re-traces each vulnerability flow)
- `diffReviewPipeline` — review → **gatekeep** (a gatekeeper decides ship/hold
  on a concrete diff)

The original mental model was "A does the work, B supervises" — Claude writes,
GPT reviews. That is exactly right for *production* tasks: B is looking at a
real artifact (the code, the diff) and judging it. `diffReviewPipeline` fits
this cleanly — the gatekeeper reads the actual diff plus the review.

But it fits *auditing* badly, and that mismatch was the smell. Auditing is
*itself* the act of reviewing. Stacking "A audits → B supervises A's audit"
gives you a supervisor-of-a-supervisor: B reads A's **report**, not the code, so
B has less signal than A did and degrades into rubber-stamping "the report looks
reasonable." That is what `auditPipeline`'s gatekeep stage was — the weakest of
the three, a meta-review with the least grounding.

`securityAuditPipeline` had already solved this the right way: its second stage
does NOT judge the report, it independently re-traces each source→sink flow and
marks it confirmed / false-positive / uncertain. That is a different shape of
collaboration — cross-checking by an independent second pass, not supervision.

On top of the conceptual mismatch there was a naming collision: the CLI's
`audit` command ran the generic `auditPipeline`, but the server's `/audit`
endpoint and the web UI's audit button ran `securityAuditPipeline`. Same word,
two different pipelines, depending on where you invoked it.

## Decision

Keep the two pipelines whose collaboration shape matches their task, and remove
the one whose shape was wrong:

- **`diffReviewPipeline`** stays — the produce → supervise shape, correct for
  judging a concrete change (Claude reviews the diff, GPT gatekeeps ship/hold).
- **`securityAuditPipeline`** stays — the independent-verify shape, correct for
  auditing (Claude finds flows, GPT independently re-traces each). Auditing is
  already a review, so the sharper second pass is a second independent trace,
  not a supervisor reading the first one's notes.
- **`auditPipeline` is removed.** Its gatekeep-the-report shape was the weakest
  form of the three and conceptually the wrong tool for a review-of-a-review.

The naming collision is resolved by making "audit" mean one thing everywhere:
the CLI's `audit` command now runs `securityAuditPipeline` (matching the `/audit`
endpoint and the UI button), and the redundant `secaudit` command is dropped.
Across CLI, HTTP, and UI, "audit" = the independent-verify security pipeline and
"review" = the diff-review pipeline.

The pipeline module header now spells out the distinction that drove this, so
the next person sees *why* there are two shapes and not three: a second agent
that re-does the work independently (verify) is a different collaboration than
one that judges the first agent's output (gatekeep), and auditing wants the
former.

Agent roles stay parameterized (`finder`/`verifier`, `reviewer`/`gatekeeper`)
so the claude-writes / gpt-checks default is a convention, not a hard-wire — a
symmetric or swapped lineup is still one argument away.

## Consequences

- Two pipelines, each matched to its task's natural collaboration shape. The
  produce→supervise pattern is reserved for judging real artifacts (diffs); the
  independent-verify pattern is used where the task is itself a review (audits).
- "audit" is now unambiguous — the same pipeline whether invoked from the CLI,
  the HTTP API, or the web UI. The `secaudit` command is gone; `audit` is the
  security audit.
- The weakest link (a gatekeep stage reading a report instead of code) is gone,
  so the surviving pipelines are the two with the most grounding: one reads the
  diff, the other re-traces the flow.
- `test/pipeline.test.ts` traded its `auditPipeline` wiring test for wiring
  tests on the two survivors, which previously had no direct wiring coverage —
  net coverage of the kept code went up, not down.
- The UI and the `/audit` endpoint needed no change: they already ran
  `securityAuditPipeline`. The convergence was mostly deletion plus pointing the
  CLI at the pipeline the rest of the product already used.
