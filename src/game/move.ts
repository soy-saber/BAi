/**
 * Move extraction — turn a free-text agent turn into a structured cell number.
 *
 * This is the genuinely reusable capability the game forces us to build: an
 * agent replies in prose ("I'll take the center, cell 4"), and we need one
 * integer out of it, robustly, or a clear "no move found". The same shape of
 * problem shows up anywhere an agent's decision must drive code (the audit
 * pipeline's VERDICT line is a cousin).
 *
 * Strategy, most-explicit first:
 *   1. an explicit `MOVE: <n>` marker (what we ask the agent to emit)
 *   2. "cell/square/position <n>" phrasing
 *   3. a bare integer 0–8 as a last resort
 * We take the LAST such hit, not the first: agents often reason aloud ("not 0,
 * not 1…") before committing, so the final number is the decision.
 */

/** A parsed move, or why we couldn't parse one. */
export type MoveParse = { ok: true; cell: number } | { ok: false; reason: string };

const MOVE_MARKER = /MOVE:\s*([0-8])\b/gi;
const PHRASE = /\b(?:cell|square|position|spot)\s*#?\s*([0-8])\b/gi;
const BARE = /\b([0-8])\b/g;

/** Last capture-group-1 match of a global regex over text, or null. */
function lastMatch(re: RegExp, text: string): string | null {
  let last: string | null = null;
  for (const m of text.matchAll(re)) last = m[1] ?? last;
  return last;
}

/**
 * Extract a 0–8 cell from agent text. Tries the explicit marker first, then
 * common phrasings, then a bare digit. Returns the parsed cell or a reason.
 */
export function extractMove(text: string): MoveParse {
  for (const re of [MOVE_MARKER, PHRASE, BARE]) {
    const hit = lastMatch(re, text);
    if (hit !== null) return { ok: true, cell: Number(hit) };
  }
  return { ok: false, reason: 'no cell number (0-8) found in the reply' };
}
