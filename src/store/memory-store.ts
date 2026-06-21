/**
 * Memory store — shared institutional knowledge that persists and grows.
 *
 * Two kinds of memory:
 *   - 'decision' — a choice the team made and why (a decision log)
 *   - 'lesson'   — something learned, often from a mistake
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

export type MemoryKind = 'decision' | 'lesson';

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
   * Recall up to `limit` memories relevant to `query`, most recent first.
   * Scores by how many query words appear in the memory text; ties broken by
   * recency. An empty query returns the most recent memories.
   */
  async recall(query: string, limit = 5): Promise<Memory[]> {
    const memories = await this.all();
    const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const scored = memories.map((m) => {
      const text = m.text.toLowerCase();
      const score = words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0);
      return { m, score };
    });
    return scored
      .filter((s) => words.length === 0 || s.score > 0)
      .sort((a, b) => b.score - a.score || b.m.ts - a.m.ts)
      .slice(0, limit)
      .map((s) => s.m);
  }
}

/** Render recalled memories as a prompt block (empty string if none). */
export function memoryBlock(memories: Memory[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m) => `  - (${m.kind}) ${m.text}`).join('\n');
  return `## Relevant team memory\n${lines}`;
}
