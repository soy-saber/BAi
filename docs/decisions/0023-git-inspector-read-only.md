# 0023 — Git inspector: a read-only window onto the working tree

Status: accepted
Stage: S21
Agent: Claude

## Context

BAi's agents edit files in the working directory directly (permission defaults to
`bypass` so an unattended turn can actually do work — see ADR 0003). That makes
the single most useful piece of operator visibility "what did the agents just
change?" Until now the only way to see that was to leave the UI and run `git`
in a terminal.

The clear next step the user asked for is a git control surface in the sidebar,
in the spirit of an editor's source-control panel. This stage delivers the
*read-only* half: see the changed files and their diffs. Mutating operations
(stage / unstage / commit) are deliberately deferred to a later stage, because
they cross from "observe" into "act on the repo" and warrant their own design
and user-gated affordances.

## Decision

A small, dependency-free git layer plus two read-only endpoints and a sidebar
panel.

- **`src/git.ts`** spawns `git` directly (no shell). Unlike the npm-shim agent
  CLIs in `adapters/` that need `shell:true` on Windows, `git` is a real `.exe`,
  so `CreateProcess` resolves it without PATHEXT help — and with no shell, file
  paths handed to `git diff` carry zero shell-injection surface even for odd
  filenames.
  - `parseStatus(raw)` is **pure and exported**: it turns
    `git status --porcelain=v1 --branch` output into `{ branch, upstream, ahead,
    behind, files[] }`, where each file decomposes the two porcelain status
    chars (index/worktree) into `staged` / `unstaged` / `untracked` flags and
    keeps both paths for renames. Being pure, it's unit-tested against fixed
    fixtures with no process spawn.
  - `gitStatus()` / `gitDiff()` are thin spawn wrappers. They **never throw** —
    outside a git repo or with git absent they resolve to `{ repo: false }` /
    `{ diff: '' }`, so the UI degrades to "no panel" rather than erroring.
  - `gitDiff(file)` validates `file` against the current `git status` set before
    diffing, so the endpoint can't be coaxed into reading an arbitrary path: only
    files git already reports as changed are diffable. Untracked files report
    `untracked: true` (no tracked baseline to diff).

- **`GET /api/git/status`** and **`GET /api/git/diff?file=`** on the existing
  localhost server. Both are read-only; they inherit the server's existing
  "localhost, no-auth, do not expose" posture (ADR 0007) and add no new write
  surface.

- **Sidebar panel** (`#gitPanel`): a collapsible "Changes" section listing each
  changed file with a colored status glyph (green staged / amber unstaged /
  muted untracked) and the branch + count. Clicking a file opens a diff overlay
  with add/del/hunk line coloring. The panel refreshes when a thread opens and
  after every turn/audit finishes — exactly when agents may have moved files.

## Why read-only first, separately

Reversibility and blast radius. Reading status/diff can't damage the repo;
staging and committing can. Splitting the stage keeps this one trivially safe to
ship and lets the write stage (S22) own the harder questions — what to stage,
who authors the commit message, how to honor the Iron Law that runtime config is
read-only — without holding up the visibility win the user actually asked to see
first.

## Consequences

- The operator can watch agent file changes accumulate live, and inspect any
  diff, without leaving the page.
- `parseStatus` is the tested core; the spawn wrappers are deliberately thin and
  untested (they'd require a real repo fixture for little marginal confidence).
- No write path exists yet — staging/committing is Stage 22, building on this
  same `src/git.ts` module.
