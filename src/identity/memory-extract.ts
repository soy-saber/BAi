/**
 * Memory extraction.
 *
 * After an agent finishes a turn, we scan its output for things worth keeping in
 * the team's shared memory (see MemoryStore): decisions made and lessons
 * learned. This closes the loop with recall — what one turn writes, a later
 * turn's prompt can surface.
 *
 * Two signals, in priority order:
 *  1. Explicit markers — a line starting `DECISION:` or `LESSON:`. Agents are
 *     told (via identity/prompt) they may tag takeaways this way; it's the
 *     reliable path.
 *  2. Natural phrasings — a few conservative lead-ins ("we decided to …",
 *     "lesson learned: …") so unmarked but clearly-flagged takeaways still land.
 *
 * Conservative on purpose: better to miss a vague takeaway than to fill memory
 * with noise. One short line per memory.
 */

import type { MemoryKind } from '../store/memory-store.js';

export interface ExtractedMemory {
  kind: MemoryKind;
  text: string;
}

const MARKER = /^\s*(decision|lesson)\s*:\s*(.+)$/i;

const NATURAL: Array<{ kind: MemoryKind; re: RegExp }> = [
  { kind: 'decision', re: /^\s*(?:we|i)\s+decided\s+(?:to\s+)?(.+)$/i },
  { kind: 'decision', re: /^\s*decision\s+made\s*[:-]?\s*(.+)$/i },
  { kind: 'lesson', re: /^\s*lesson\s+learned\s*[:-]?\s*(.+)$/i },
  { kind: 'lesson', re: /^\s*(?:i|we)\s+learned\s+(?:that\s+)?(.+)$/i },
];

/** Trim trailing punctuation/markdown noise and cap length. */
function clean(text: string): string {
  return text
    .replace(/[*_`]+/g, '')
    .trim()
    .replace(/[.;,\s]+$/, '')
    .slice(0, 280);
}

/**
 * Extract zero or more memories from an agent's full turn output. Deduplicates
 * identical texts so a repeated marker doesn't store twice.
 */
export function extractMemories(output: string): ExtractedMemory[] {
  const out: ExtractedMemory[] = [];
  const seen = new Set<string>();

  const add = (kind: MemoryKind, raw: string): void => {
    const text = clean(raw);
    if (text.length < 4) return;
    const key = `${kind}:${text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, text });
  };

  for (const line of output.split('\n')) {
    const marked = line.match(MARKER);
    if (marked) {
      add(marked[1]?.toLowerCase() === 'lesson' ? 'lesson' : 'decision', marked[2] ?? '');
      continue;
    }
    for (const { kind, re } of NATURAL) {
      const m = line.match(re);
      if (m) {
        add(kind, m[1] ?? '');
        break;
      }
    }
  }
  return out;
}
