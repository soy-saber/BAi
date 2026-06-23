import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyMove,
  type Board,
  emptyBoard,
  isFull,
  isLegal,
  legalMoves,
  outcome,
  winner,
} from '../src/game/tictactoe.ts';

test('emptyBoard is nine empty cells', () => {
  const b = emptyBoard();
  assert.equal(b.length, 9);
  assert.ok(b.every((c) => c === null));
  assert.deepEqual(legalMoves(b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('isLegal rejects out-of-range, occupied, and non-integer cells', () => {
  const b = applyMove(emptyBoard(), 4, 'X');
  assert.equal(isLegal(b, 4), false); // occupied
  assert.equal(isLegal(b, 0), true);
  assert.equal(isLegal(b, -1), false);
  assert.equal(isLegal(b, 9), false);
  assert.equal(isLegal(b, 1.5), false);
});

test('applyMove does not mutate the input board', () => {
  const b0 = emptyBoard();
  const b1 = applyMove(b0, 0, 'X');
  assert.equal(b0[0], null); // original untouched
  assert.equal(b1[0], 'X');
});

test('applyMove throws on an illegal move', () => {
  const b = applyMove(emptyBoard(), 0, 'X');
  assert.throws(() => applyMove(b, 0, 'O'), /illegal move/);
});

test('winner detects a row, a column, and a diagonal', () => {
  // top row X
  let b: Board = emptyBoard();
  b = applyMove(b, 0, 'X');
  b = applyMove(b, 1, 'X');
  b = applyMove(b, 2, 'X');
  assert.equal(winner(b), 'X');

  // left column O
  let c: Board = emptyBoard();
  c = applyMove(c, 0, 'O');
  c = applyMove(c, 3, 'O');
  c = applyMove(c, 6, 'O');
  assert.equal(winner(c), 'O');

  // diagonal X
  let d: Board = emptyBoard();
  d = applyMove(d, 0, 'X');
  d = applyMove(d, 4, 'X');
  d = applyMove(d, 8, 'X');
  assert.equal(winner(d), 'X');
});

test('winner is null with no three-in-a-row', () => {
  let b: Board = emptyBoard();
  b = applyMove(b, 0, 'X');
  b = applyMove(b, 1, 'O');
  assert.equal(winner(b), null);
});

test('outcome reports win, draw, and in-progress', () => {
  // in progress
  assert.equal(outcome(emptyBoard()), null);

  // X wins top row
  let w: Board = emptyBoard();
  w = applyMove(w, 0, 'X');
  w = applyMove(w, 1, 'X');
  w = applyMove(w, 2, 'X');
  assert.deepEqual(outcome(w), { kind: 'win', player: 'X' });

  // a full board with no winner is a draw:
  //  X | O | X
  //  X | O | O
  //  O | X | X
  const draw: Board = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
  assert.equal(isFull(draw), true);
  assert.equal(winner(draw), null);
  assert.deepEqual(outcome(draw), { kind: 'draw' });
});
