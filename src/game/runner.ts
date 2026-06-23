/**
 * Game runner — the deterministic referee that makes two agents play.
 *
 * The engine (tictactoe.ts) owns the board and the rules; agents only *propose*
 * moves as free text, which we parse with extractMove. The referee:
 *   - prompts the player to move, given the current board
 *   - extracts a cell, validates it against the engine
 *   - on an illegal/unparseable move, re-prompts up to `retries` times
 *   - forfeits the game if a player still can't produce a legal move
 *   - never lets an agent mutate the board directly
 *
 * This is the "games stress-test the same machinery" idea from the roadmap: it
 * exercises adapters, per-turn timeout/cancel, and (above all) turning prose
 * into a structured decision — without any new privileged path for agents.
 */

import type { AgentAdapter, RunOptions } from '../adapters/adapter.js';
import { extractMove } from './move.js';
import {
  applyMove,
  type Board,
  emptyBoard,
  isLegal,
  legalMoves,
  outcome,
  type Player,
  render,
} from './tictactoe.js';

/** The two seats. */
export interface Players {
  X: AgentAdapter;
  O: AgentAdapter;
}

/** One recorded move in the game log. */
export interface MoveRecord {
  player: Player;
  agent: string;
  cell: number;
  /** How many illegal/unparseable attempts preceded this legal one. */
  retries: number;
}

/** How the game ended. */
export type GameResult =
  | { kind: 'win'; player: Player; agent: string }
  | { kind: 'draw' }
  | { kind: 'forfeit'; player: Player; agent: string; reason: string };

export interface GameReport {
  result: GameResult;
  moves: MoveRecord[];
  /** The final board, for display. */
  board: Board;
}

/** Events emitted as the game proceeds, so a CLI/UI can narrate it live. */
export type GameEvent =
  | { kind: 'turn_start'; player: Player; agent: string; board: Board }
  | { kind: 'illegal'; player: Player; agent: string; attempt: string; reason: string }
  | { kind: 'move'; player: Player; agent: string; cell: number }
  | { kind: 'game_end'; report: GameReport };

export type OnGameEvent = (event: GameEvent) => void;

export interface PlayOptions {
  /** Re-prompts allowed after an illegal/unparseable move, per turn. Default 2. */
  retries?: number;
  /** Forwarded to each agent turn (timeout, cancel, cwd, permission). */
  runOptions?: RunOptions;
  onEvent?: OnGameEvent;
}

/** Collect an agent's turn into one text string (we only need its prose here). */
async function collectText(
  adapter: AgentAdapter,
  prompt: string,
  options?: RunOptions,
): Promise<{ text: string; ok: boolean }> {
  const parts: string[] = [];
  let ok = true;
  for await (const message of adapter.run(prompt, options)) {
    if (message.type === 'text') parts.push(message.text);
    else if (message.type === 'result') ok = message.ok;
  }
  return { text: parts.join('\n').trim(), ok };
}

/** Build the per-turn prompt for a player. */
function movePrompt(board: Board, player: Player, retryNote?: string): string {
  const lines = [
    `You are playing tic-tac-toe as ${player}. Cells are numbered 0-8:`,
    '',
    render(emptyBoard()),
    '',
    'Current board:',
    '',
    render(board),
    '',
    `Legal moves (empty cells): ${legalMoves(board).join(', ')}.`,
    'Choose ONE empty cell. Think briefly if you like, then end your reply with a',
    'line exactly: `MOVE: <n>` where <n> is the cell number you choose.',
  ];
  if (retryNote) lines.push('', `NOTE: ${retryNote}`);
  return lines.join('\n');
}

/**
 * Play one full game and return a report. Deterministic except for whatever the
 * agents themselves do; the referee logic adds no randomness.
 */
export async function playGame(players: Players, options: PlayOptions = {}): Promise<GameReport> {
  const retries = options.retries ?? 2;
  let board = emptyBoard();
  const moves: MoveRecord[] = [];
  // X always starts, then alternate.
  let current: Player = 'X';

  const seat = (p: Player): AgentAdapter => (p === 'X' ? players.X : players.O);

  for (;;) {
    const adapter = seat(current);
    options.onEvent?.({ kind: 'turn_start', player: current, agent: adapter.name, board });

    let chosen: number | undefined;
    let attempts = 0;
    let lastReason = '';
    // First try + `retries` re-prompts.
    for (let attempt = 0; attempt <= retries; attempt++) {
      const note =
        attempt === 0
          ? undefined
          : `${lastReason} Pick one of these empty cells: ${legalMoves(board).join(', ')}.`;
      const { text } = await collectText(
        adapter,
        movePrompt(board, current, note),
        options.runOptions,
      );
      attempts = attempt;

      const parsed = extractMove(text);
      if (!parsed.ok) {
        lastReason = parsed.reason;
        options.onEvent?.({
          kind: 'illegal',
          player: current,
          agent: adapter.name,
          attempt: text.slice(0, 200),
          reason: parsed.reason,
        });
        continue;
      }
      if (!isLegal(board, parsed.cell)) {
        lastReason = `cell ${parsed.cell} is not empty or out of range.`;
        options.onEvent?.({
          kind: 'illegal',
          player: current,
          agent: adapter.name,
          attempt: text.slice(0, 200),
          reason: lastReason,
        });
        continue;
      }
      chosen = parsed.cell;
      break;
    }

    // Couldn't get a legal move within the retry budget: forfeit.
    if (chosen === undefined) {
      const report: GameReport = {
        result: {
          kind: 'forfeit',
          player: current,
          agent: adapter.name,
          reason: lastReason || 'no legal move produced',
        },
        moves,
        board,
      };
      options.onEvent?.({ kind: 'game_end', report });
      return report;
    }

    board = applyMove(board, chosen, current);
    moves.push({ player: current, agent: adapter.name, cell: chosen, retries: attempts });
    options.onEvent?.({ kind: 'move', player: current, agent: adapter.name, cell: chosen });

    const done = endReport(board, moves, players);
    if (done) {
      options.onEvent?.({ kind: 'game_end', report: done });
      return done;
    }

    current = current === 'X' ? 'O' : 'X';
  }
}

/** Build a final report if the board is terminal, else null (game continues). */
function endReport(board: Board, moves: MoveRecord[], players: Players): GameReport | null {
  const out = outcome(board);
  if (!out) return null;
  if (out.kind === 'draw') return { result: { kind: 'draw' }, moves, board };
  const agent = (out.player === 'X' ? players.X : players.O).name;
  return { result: { kind: 'win', player: out.player, agent }, moves, board };
}
