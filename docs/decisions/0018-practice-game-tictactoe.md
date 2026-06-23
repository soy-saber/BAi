# 0018 — A practice build: agents playing tic-tac-toe

- **Date:** 2026-06-24
- **Status:** accepted
- **Stage:** S17

## Context

clowder-ai's README is candid that its game modes (Werewolf, Pixel Cat Brawl)
"aren't a gimmick — they stress-test the same A2A messaging, identity
persistence, and turn-based coordination that powers the work features." We
wanted the same: a small, self-contained build that exercises BAi's machinery
end to end and is fun to watch, as a learning artifact.

The crucial design note clowder calls out: **"the judge is deterministic code,
not LLM."** That is the whole lesson worth copying.

## Decision

A tic-tac-toe match where the two players are agents and the referee is code.

Three pieces, each independently testable:

1. **`src/game/tictactoe.ts`** — a pure engine. `emptyBoard`, `legalMoves`,
   `isLegal`, `applyMove` (returns a new board, never mutates), `winner`,
   `outcome`, `render`. No agents, no I/O, no randomness — just the rules.
2. **`src/game/move.ts`** — `extractMove(text)`: turn a free-text agent turn
   into a `{ ok: true; cell }` or `{ ok: false; reason }`. Tries an explicit
   `MOVE: <n>` marker, then "cell/square/position <n>" phrasing, then a bare
   0–8 digit; takes the **last** hit (agents reason aloud before committing).
3. **`src/game/runner.ts`** — `playGame(players)`: the deterministic referee.
   Prompts the player for the current board, extracts a move, validates it
   against the engine, re-prompts on illegal/unparseable moves up to a retry
   budget, and **forfeits** if a player still can't produce a legal move.

Exposed as `bai play <X-agent> <O-agent>`.

## Why this is a real test, not a toy

- **It reuses the adapter layer unchanged.** A game turn is just
  `adapter.run(prompt)` drained for text — the same path as everything else,
  so it inherits timeout, cancellation, and the spawn/parse machinery for free.
- **The engine owns the board; agents only *propose*.** An agent cannot mutate
  state, cannot cheat, and cannot wedge the game with a bad move — the worst it
  can do is forfeit. This is the same trust boundary the audit pipeline draws
  (agents produce text; code decides what happens).
- **It forces a genuinely reusable capability:** extracting a structured
  decision from prose. `extractMove` is a cousin of the pipeline's `VERDICT:`
  parsing and the memory layer's `DECISION:`/`INSIGHT:` markers — same shape of
  problem, and now we have a clean, tested instance of it.

## Why tic-tac-toe (not Werewolf)

Bounded and fully deterministic: at most 9 moves, a trivial win/draw check, and
no hidden information or multi-role bookkeeping. That keeps the *referee* simple
so the interesting part — driving LLM players through a code-judged loop — is
what gets exercised and tested. Werewolf is the same pattern with a heavier
judge; this proves the pattern first.

## Verification

- Unit: `test/tictactoe.test.ts` (engine: legality, immutability, win/draw),
  `test/move.test.ts` (marker > phrase > bare digit, last-wins, out-of-range
  rejection), `test/game-runner.test.ts` with fake adapters (a full win, a
  draw, illegal-move re-prompting, forfeit, and event emission). Full suite
  100 pass.
- The referee tests use scripted fake adapters, so the whole game loop is
  verified with no live CLI.

## Consequences

- We now have a reusable `extractMove`-style pattern and a clean example of the
  "code is the judge, agents are players" boundary, ready to generalize to a
  heavier game (Werewolf) later.
- The game is CLI-only for now; a web UI view of a live match is a later stage
  if it's worth it.
