/**
 * Memory store — shared institutional knowledge that persists and grows.
 *
 * Kinds of memory:
 *   - 'decision' — a choice the team made and why (a decision log)
 *   - 'lesson'   — something learned, often from a mistake
 *   - 'insight'  — a higher-order takeaway distilled by reviewing many memories
 *                  (the team reflecting on its own history; see retrospect.ts)
 *
 * Stored as a single appended JSON-lines file (data/memory.jsonl) so writes are
 * cheap and the log is easy to read. Recall is keyword-based for now: simple,
 * transparent, and good enough before we need embeddings.
 *
 * Per the Iron Laws this store is never deleted or flushed by an agent.
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type MemoryKind = 'decision' | 'lesson' | 'insight';

export interface Memory {
  id: string;
  kind: MemoryKind;
  /** Who recorded it. */
  agent: string;
  text: string;
  ts: number;
}

export class MemoryStore {
  constructor(private readonly file = join(process.cwd(), 'data', 'memory.jsonl')) {}

  async record(kind: MemoryKind, agent: string, text: string): Promise<Memory> {
    await mkdir(dirname(this.file), { recursive: true });
    const memory: Memory = { id: randomUUID().slice(0, 8), kind, agent, text, ts: Date.now() };
    await appendFile(this.file, `${JSON.stringify(memory)}\n`, 'utf8');
    return memory;
  }

  async all(): Promise<Memory[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    const out: Memory[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as Memory);
      } catch {
        // skip a corrupt line rather than failing the whole recall
      }
    }
    return out;
  }

  /**
   * Recall up to `limit` memories relevant to `query`, best match first.
   *
   * Scoring, kept deliberately simple and transparent (no embeddings yet):
   *   - tokenize the query, drop stopwords and 1-char tokens
   *   - count distinct query terms that appear in the memory as whole words
   *     (word-boundary match, so "test" doesn't hit "latest")
   *   - add a small recency bonus so that, among similar matches, newer wins
   *   - 'insight' memories get a slight boost: they are distilled takeaways and
   *     usually the most useful thing to surface
   * An empty/stopword-only query returns the most recent memories.
   */
  async recall(query: string, limit = 5): Promise<Memory[]> {
    const memories = await this.all();
    const terms = [...new Set(tokenize(query))];
    const now = Date.now();

    const scored = memories.map((m) => {
      const text = m.text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (new RegExp(`\\b${escapeRegExp(term)}\\b`).test(text)) score += 1;
      }
      // Recency bonus in [0, 0.5): newer memories edge out older ties without
      // ever outweighing a real keyword match.
      const ageDays = (now - m.ts) / 86_400_000;
      score += 0.5 / (1 + ageDays);
      if (m.kind === 'insight') score += 0.25;
      return { m, score };
    });

    // With real query terms, require at least one keyword hit (score >= 1);
    // the recency/insight bonuses alone (< 1) are not enough to surface noise.
    const threshold = terms.length === 0 ? 0 : 1;
    return scored
      .filter((s) => s.score >= threshold)
      .sort((a, b) => b.score - a.score || b.m.ts - a.m.ts)
      .slice(0, limit)
      .map((s) => s.m);
  }
}

/** Words too common to carry meaning in keyword recall. */
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'for',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'with',
  'as',
  'we',
  'our',
  'you',
  'your',
  'i',
  'me',
  'my',
  'so',
  'if',
  'then',
  'than',
  'do',
  'does',
  'did',
  'can',
  'will',
  'would',
  'should',
  'use',
  'using',
  'used',
  'because',
]);

/** Lowercase, split on non-alphanumerics, drop stopwords and 1-char tokens. */
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length > 1 && !STOPWORDS.has(w),
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Render recalled memories as a prompt block (empty string if none). */
export function memoryBlock(memories: Memory[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m) => `  - (${m.kind}) ${m.text}`).join('\n');
  return `## Relevant team memory\n${lines}`;
}
