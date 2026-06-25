# 0024 — Git write operations: stage / unstage / commit

Status: accepted
Stage: S22
Agent: Claude

## Context

Stage 21 (ADR 0023) added a read-only git inspector: the operator can see what
the agents changed and read each file's diff. The natural next question, once you
trust a change, is "commit it" — without leaving the UI to drop to a terminal.

The risk is obvious: a localhost server with no auth that can mutate a git repo.
The Iron Laws also forbid destructive moves. So the question isn't "can we shell
out to git" — Stage 21 already does — it's "which mutations are safe to expose,
and how do we keep the endpoints from being turned into an arbitrary-write
primitive."

## Decision

Expose exactly three mutations, each the *non-destructive* member of its family,
each triggered only by an explicit UI click:

- **stage** — `git add -- <paths>`
- **unstage** — `git reset -q -- <paths>` (not `git restore --staged`: reset also
  works before the first commit, when there is no HEAD to restore from)
- **commit** — `git commit -m <message>`, index only (no `-a`): the operator
  chooses exactly what lands by staging first.

Deliberately **not** exposed: push, reset --hard, clean, checkout/restore of file
contents, branch -D, amend, rebase — anything that discards work or rewrites
history. Those stay a manual, out-of-band decision (consistent with git_safety
and the Iron Laws).

### The guard that matters

`gitStage`/`gitUnstage` first call `gitStatus` and reject any path that git does
not already report as changed (`rejectUnknownPaths`). This is what stops a crafted
request body (`{"files":["../../etc/passwd"]}`) from being staged: the endpoint
can only ever act on the working tree's own change set. Renames are allowed by
either their old or new path. Commit takes no paths at all — it acts on the index,
which staging already constrained.

All argv is passed without a shell (`spawn('git', [...])`), so a path or commit
message with shell metacharacters is inert; `--` ends option parsing so a
leading-dash filename can't smuggle in a flag.

### UI

Each changed file gets a `+`/`−` button (stage if anything is unstaged/untracked,
else unstage); clicking the name still opens the diff. A commit footer appears
when anything is staged; the message survives panel re-renders (each stage/unstage
rebuilds the list), and Enter commits. Failures surface as a status line carrying
git's own stderr, so "nothing to commit" or a hook rejection is visible.

## Consequences

- The operator can review-and-commit an agent's work entirely in the UI, which is
  the whole point of the git panel sitting next to the conversation.
- The blast radius is bounded to add/reset/commit on already-changed paths. No
  endpoint here can lose committed work or rewrite history.
- Pushing remains manual — intentional. Sending commits to a remote is the
  outward-facing step, and the standing rule is to confirm those, not wire them to
  a button.
- Tests spawn real git in a temp repo (skipped if git is absent), so the argv,
  the path-validation guard, and exit-code handling are exercised for real, not
  just the pure parser.
