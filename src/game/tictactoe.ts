/**
 * Tic-tac-toe — a pure, deterministic game engine.
 *
 * No agents, no I/O, no randomness: just the rules. Cells are indexed 0–8,
 * left-to-right, top-to-bottom:
 *
 *     0 | 1 | 2
 *    ---+---+---
 *     3 | 4 | 5
 *    ---+---+---
 *     6 | 7 | 8
 *
 * This is the "deterministic referee" half of the game (see runner.ts): the
 * engine alone decides what is legal and who has won. Agents only *propose*
 * moves; they never get to mutate the board. That separation is the whole point
 * — it's how a game of LLM players can't cheat or wedge.
 */

export type Player = 'X' | 'O';
/** A cell is a player's mark or null when empty. */
export type Cell = Player | null;
/** The board is a fixed 9-cell array. */
export type Board = Cell[];

/** The eight winning lines (rows, columns, diagonals) as cell indices. */
const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** A fresh empty board. */
export function emptyBoard(): Board {
  return Array<Cell>(9).fill(null);
}

/** Cell indices that are still empty, in ascending order. */
export function legalMoves(board: Board): number[] {
  const moves: number[] = [];
  for (let i = 0; i < 9; i++) if (board[i] === null) moves.push(i);
  return moves;
}

/** Is `cell` a real, empty, in-range cell? */
export function isLegal(board: Board, cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < 9 && board[cell] === null;
}

/**
 * Apply a move, returning a NEW board (the input is never mutated). Throws on an
 * illegal move — callers must validate with `isLegal` first; the referee does.
 */
export function applyMove(board: Board, cell: number, player: Player): Board {
  if (!isLegal(board, cell)) throw new Error(`illegal move: cell ${cell}`);
  const next = board.slice();
  next[cell] = player;
  return next;
}

/** The winning player, or null if nobody has three in a row yet. */
export function winner(board: Board): Player | null {
  for (const [a, b, c] of LINES) {
    const v = board[a];
    if (v && v === board[b] && v === board[c]) return v;
  }
  return null;
}

/** Has every cell been filled? */
export function isFull(board: Board): boolean {
  return board.every((c) => c !== null);
}

/** Game outcome once it's over. */
export type Outcome = { kind: 'win'; player: Player } | { kind: 'draw' };

/** The outcome if the game has ended, else null (still in progress). */
export function outcome(board: Board): Outcome | null {
  const w = winner(board);
  if (w) return { kind: 'win', player: w };
  if (isFull(board)) return { kind: 'draw' };
  return null;
}

/** Render the board as a 3x3 grid, empty cells shown as their index. */
export function render(board: Board): string {
  const cellStr = (i: number): string => board[i] ?? String(i);
  const row = (a: number, b: number, c: number): string =>
    ` ${cellStr(a)} | ${cellStr(b)} | ${cellStr(c)} `;
  return [row(0, 1, 2), '---+---+---', row(3, 4, 5), '---+---+---', row(6, 7, 8)].join('\n');
}
