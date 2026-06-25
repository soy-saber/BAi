# 0025 — Diff-review pipeline: review → gatekeep on a change

Status: accepted
Stage: S23
Agent: Claude

## Context

Stages 21–22 (ADRs 0023, 0024) gave the operator a git inspector: see what the
agents changed, diff each file, stage/unstage, commit. That answers *"what
changed"* — but not *"is this change any good?"* Reading a diff and judging
whether it's safe to land is exactly the kind of work the pipeline engine
(Stage 15, ADR 0016) already structures: one agent produces, a second
adversarially checks.

We have two pipelines already — `auditPipeline` (grade an audit) and
`securityAuditPipeline` (confirm each vuln flow). Both audit *existing code*.
Neither is scoped to a **diff** — the lines that actually changed this session,
which is the unit a reviewer cares about before a commit lands.

## Decision

A third concrete pipeline, `diffReviewPipeline()` in `src/routing/pipeline.ts`,
reusing the same `runPipeline` engine (no new machinery):

- **review** (default `claude`): reads a unified diff and judges the *change* —
  correctness (off-by-one, wrong condition, missing await), regressions (removed
  guard, changed signature, broken caller), security (injection, missing
  validation, leaked secret), and missing tests/docs. It cites hunks, not whole
  files, and rates each finding `[blocker|major|minor|nit]`.
- **gatekeep** (default `codex`, falling back to `opencode`): decides whether the
  change is safe to LAND — drops overstated objections, adds anything the review
  missed, and ends with `VERDICT: ship` or `VERDICT: hold — <must-fix>`.

The diff is read **server-side / CLI-side** (via `gitDiff`) and travels in the
task text, not opened by the agents. This is deliberate: a chat-only reviewer
(e.g. a codex CLI bound to a tool-less model) sees the change inline without
needing file tools, exactly like the `@file:` feeding in Stage 18. A
tool-capable reviewer can still open the surrounding files for context.

Surfaced two ways:
- CLI: `bai review <threadId> [file]` — reviews the whole working-tree diff, or
  one file's diff. Refuses untracked files (no tracked baseline) and a clean
  tree (nothing to review).
- UI: a **👁 Review changes** button in the git panel, shown when there's a
  tracked change. It streams the pipeline into the log like a normal turn,
  sharing the one in-flight slot with send/audit.

## Consequences

- The git inspector stops being read-only-plus-commit and becomes a small review
  loop: see the change → have it reviewed → stage → commit. The operator never
  leaves the page.
- `diffReviewPipeline` is the third caller of `runPipeline` with zero engine
  changes — the Stage 15 abstraction keeps paying off. Each new "two agents,
  one checks the other" workflow is just a pair of prompts.
- Scope is the working tree, not arbitrary refs. Reviewing `HEAD~3..HEAD` or a
  branch range is a later stage if wanted; the value here is the uncommitted
  change an agent just made.
- Like the other pipelines, a negative result is still a *success*: a
  `VERDICT: hold` means the pipeline ran and the change shouldn't land, not that
  the pipeline failed. Fallback only fires when an agent can't run at all.
