import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentAdapter, RunOptions } from '../src/adapters/adapter.ts';
import { playGame } from '../src/game/runner.ts';
import type { AgentMessage } from '../src/types.ts';

/**
 * A scripted player: yields `MOVE: <n>` for each cell in `moves`, one per turn.
 * When `moves` runs out it repeats the last, which the referee will reject as
 * illegal (cell already taken) — useful for forcing a forfeit.
 */
function scriptedPlayer(name: string, moves: number[]): AgentAdapter {
  let turn = 0;
  return {
    name,
    async *run(_prompt: string, _options?: RunOptions): AsyncGenerator<AgentMessage> {
      const cell = moves[Math.min(turn, moves.length - 1)];
      turn++;
      yield { type: 'text', agent: name, text: `I choose ${cell}. MOVE: ${cell}` };
      yield { type: 'result', agent: name, ok: true };
    },
  };
}

/** A player that never produces a parseable move. */
function muteplayer(name: string): AgentAdapter {
  return {
    name,
    async *run(): AsyncGenerator<AgentMessage> {
      yield { type: 'text', agent: name, text: 'hmm, I am not sure' };
      yield { type: 'result', agent: name, ok: true };
    },
  };
}

test('X wins along the top row', async () => {
  // X: 0,1,2  O: 3,4 — X completes the top row on its third move.
  const report = await playGame({
    X: scriptedPlayer('x', [0, 1, 2]),
    O: scriptedPlayer('o', [3, 4, 5]),
  });
  assert.equal(report.result.kind, 'win');
  if (report.result.kind === 'win') {
    assert.equal(report.result.player, 'X');
    assert.equal(report.result.agent, 'x');
  }
  // X moved 3 times, O moved 2 times before X won.
  assert.equal(report.moves.length, 5);
});

test('a full board with no line is a draw', async () => {
  // A classic drawn sequence:
  //  X O X
  //  X O O
  //  O X X
  // X: 0,2,3,7,8   O: 1,4,5,6
  const report = await playGame({
    X: scriptedPlayer('x', [0, 2, 3, 7, 8]),
    O: scriptedPlayer('o', [1, 4, 5, 6]),
  });
  assert.equal(report.result.kind, 'draw');
  assert.equal(report.moves.length, 9);
});

test('the engine, not the agent, owns the board: an illegal move is re-prompted', async () => {
  // O tries to play 0 (already taken by X), then settles on 4 on retry.
  let oTurn = 0;
  const stubbornO: AgentAdapter = {
    name: 'o',
    async *run(): AsyncGenerator<AgentMessage> {
      // First attempt of its first turn: collide with X's 0; then pick 4.
      const cell = oTurn === 0 ? 0 : 4;
      oTurn++;
      yield { type: 'text', agent: 'o', text: `MOVE: ${cell}` };
      yield { type: 'result', agent: 'o', ok: true };
    },
  };
  const report = await playGame(
    { X: scriptedPlayer('x', [0, 1, 2]), O: stubbornO },
    { retries: 2 },
  );
  // O's first legal move (4) should be recorded with retries: 1.
  const oMove = report.moves.find((m) => m.player === 'O');
  assert.equal(oMove?.cell, 4);
  assert.equal(oMove?.retries, 1);
});

test('a player who never produces a legal move forfeits', async () => {
  const report = await playGame(
    { X: muteplayer('x'), O: scriptedPlayer('o', [0]) },
    { retries: 1 },
  );
  assert.equal(report.result.kind, 'forfeit');
  if (report.result.kind === 'forfeit') {
    assert.equal(report.result.player, 'X');
    assert.equal(report.result.agent, 'x');
  }
});

test('emits turn_start, move, and game_end events', async () => {
  const kinds: string[] = [];
  await playGame(
    { X: scriptedPlayer('x', [0, 1, 2]), O: scriptedPlayer('o', [3, 4, 5]) },
    {
      onEvent: (e) => kinds.push(e.kind),
    },
  );
  assert.ok(kinds.includes('turn_start'));
  assert.ok(kinds.includes('move'));
  assert.equal(kinds[kinds.length - 1], 'game_end');
});
