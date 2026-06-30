# 0028 — A turn budget for A2A handoffs

Status: accepted
Stage: S26
Agent: Claude

## Context

A2A handoffs (ADR for Stage with `a2a.ts`) let an agent's reply @mention another
agent, queuing it as a follow-up turn. The orchestrator drains that queue, so a
team can self-organize: claude builds, @-mentions codex, codex reviews, and may
hand back to claude.

The only guard on that queue was `maxHops` — a cap on the *depth* of a single
handoff chain. That stops a straight A→B→A→B ping-pong, but it does not bound the
*total* work, because each turn can @-mention several agents at once. With three
agents each handing off to the other two, depth `d` permits on the order of
`2^d` turns: the chain is shallow but the fan-out is exponential. A handful of
hops can mean dozens of CLI invocations — real time, real tokens, real money —
with nothing saying "enough."

Depth and breadth are different failure modes. `maxHops` only addresses one.

## Decision

Add a second, orthogonal cap: `maxTurns` — a hard ceiling on the total number of
agent turns in one dispatch, across every handoff, regardless of depth. Default
12. The drain loop checks `ran.length >= maxTurns` before running each queued
handoff; when the budget is spent it stops, drops whatever is still queued, and
emits a `budget_exhausted` event carrying how many ran and which agents were
dropped (the current handoff plus the distinct agents still in the queue).

`maxHops` stays as-is and keeps its job — bounding chain depth so one lineage
can't run forever. `maxTurns` is the breadth/total guard layered on top: depth
caps how *deep* a chain goes, the turn budget caps how *much* runs in all.

Two things considered and rejected:

- **Per-dispatch agent dedup** (run each agent at most once) was prototyped and
  pulled back out. It would break the existing, *wanted* behavior where claude →
  codex → claude is a legitimate build → review → revise iteration, and the
  existing hop-cap test asserts exactly that `['claude','codex','claude','codex']`
  chain. Dedup solves a problem we don't have (the loop is already bounded) at
  the cost of one we do (iterative collaboration). The total budget is the right
  lever: it bounds cost without forbidding an agent from being revisited.
- **Counting tokens instead of turns.** Turns are the unit the operator reasons
  about ("don't run more than a dozen agents on one message"), they're known
  before a turn runs (tokens aren't), and per-turn usage is already best-effort
  (ADR 0026) — some CLIs report nothing. A turn count is the honest, predictable
  budget; a token budget can come later as a refinement if wanted.

`budget_exhausted` is surfaced in both UIs the same way every other dispatch
event is: the CLI prints a one-line notice naming the dropped agents, and the web
UI adds a status line. It is deliberately distinct from `done` — a chain that
finishes naturally and one that got capped are different outcomes, and the
operator should be able to tell which happened.

## Consequences

- A runaway fan-out is now bounded by total work, not just chain depth. The
  worst case is `maxTurns` agent runs per dispatch, full stop — a number the
  operator sets and can predict, independent of how the agents @-mention.
- Existing behavior is unchanged for any normal conversation: 12 is well above a
  typical build→review→revise chain, so real workflows finish naturally and
  never see a `budget_exhausted` event. The cap only bites pathological fan-out.
- Two independent knobs (`maxHops`, `maxTurns`) cover the two distinct ways a
  handoff graph can blow up — depth and breadth — and either can be tuned without
  touching the other.
- The "we capped it" signal is explicit and visible, so a truncated chain reads
  as a deliberate budget decision in the transcript, not a silent stop or a bug.
- A token-based budget remains a clean future refinement: it would layer onto the
  same drain-loop check, reading the per-turn usage Stage 24 already records.
