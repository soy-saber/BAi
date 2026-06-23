/**
 * Team retrospective — the team reflecting on its own history.
 *
 * Periodically (or on demand) we hand an agent a batch of recent memories
 * (decisions + lessons) and ask it to distill a few higher-order takeaways.
 * Those are stored back as `insight` memories, which recall weights slightly
 * higher than raw entries. This is the seed of self-evolution: the team's
 * knowledge doesn't just accumulate, it gets compressed and sharpened.
 *
 * The distillation runs through the same AgentAdapter as any other turn, so it
 * inherits streaming, timeout, cancellation, and retry for free.
 */

import type { AgentAdapter, RunOptions } from '../adapters/adapter.js';
import type { Memory, MemoryStore } from '../store/memory-store.js';

/** Marker an agent emits per distilled takeaway, one per line. */
const INSIGHT_MARKER = /^\s*INSIGHT:\s*(.+)$/i;

/** Build the reflection prompt from a batch of memories. */
export function retrospectPrompt(memories: Memory[]): string {
  const list = memories.map((m) => `- (${m.kind}) ${m.text}`).join('\n');
  return [
    "You are reviewing the team's recent decisions and lessons to distill",
    'higher-order takeaways — patterns, recurring mistakes, principles worth',
    'remembering. Do not use any tools.',
    '',
    'Recent memories:',
    list,
    '',
    'Reply with up to 3 lines, each starting exactly with "INSIGHT:" and stating',
    'one durable, general takeaway. If there is nothing worth distilling, reply',
    'with a single line: NONE',
  ].join('\n');
}

/** Pull INSIGHT: lines out of an agent's reflection output. */
export function parseInsights(output: string): string[] {
  const out: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(INSIGHT_MARKER);
    if (!match) continue;
    const text = (match[1] ?? '')
      .trim()
      .replace(/^["'`]+|["'`.]+$/g, '')
      .trim();
    if (text) out.push(text);
  }
  return out;
}

export interface RetrospectResult {
  /** Memories that were reviewed. */
  reviewed: number;
  /** Insight texts that were distilled and stored. */
  insights: string[];
}

export interface RetrospectOptions {
  /** How many recent memories to review. Default 20. */
  batch?: number;
  /** Run options (timeout, signal) forwarded to the agent turn. */
  runOptions?: RunOptions;
}

/**
 * Run one retrospective: review recent memories with `agent`, store the
 * distilled insights, and return what happened. Insights already present
 * (exact text match, case-insensitive) are skipped so repeated runs don't
 * duplicate.
 */
export async function runRetrospect(
  agent: AgentAdapter,
  memory: MemoryStore,
  options: RetrospectOptions = {},
): Promise<RetrospectResult> {
  const batch = options.batch ?? 20;
  const all = await memory.all();
  // Review the most recent non-insight memories (raw material, not prior distillations).
  const source = all
    .filter((m) => m.kind !== 'insight')
    .sort((a, b) => b.ts - a.ts)
    .slice(0, batch);

  if (source.length === 0) return { reviewed: 0, insights: [] };

  const prompt = retrospectPrompt(source);
  let output = '';
  for await (const m of agent.run(prompt, options.runOptions)) {
    if (m.type === 'text') output += `${m.text}\n`;
  }

  const existing = new Set(
    all.filter((m) => m.kind === 'insight').map((m) => m.text.toLowerCase()),
  );
  const stored: string[] = [];
  for (const text of parseInsights(output)) {
    if (existing.has(text.toLowerCase())) continue;
    existing.add(text.toLowerCase());
    await memory.record('insight', agent.name, text);
    stored.push(text);
  }

  return { reviewed: source.length, insights: stored };
}
