/**
 * Orchestrator — the core loop that turns a user message into agent work.
 *
 * Given a thread and a message, it: parses @mentions, records the user entry,
 * runs each mentioned agent (in mention order), drains each agent's message
 * stream into a single transcript entry, and persists everything.
 *
 * Adapters are injected as a registry so this is fully testable with fakes —
 * no live CLI needed.
 */

import type { AgentAdapter, RunOptions } from '../adapters/adapter.js';
import { composePrompt } from '../identity/compose.js';
import { IDENTITIES } from '../identity/identity.js';
import type { MemoryStore } from '../store/memory-store.js';
import type { ThreadStore } from '../store/thread-store.js';
import type { AgentMessage } from '../types.js';
import { detectHandoffs, type Handoff, handoffPrompt } from './a2a.js';
import { parseMentions } from './mentions.js';

export type AdapterRegistry = Record<string, AgentAdapter>;

/** Reported as each agent's stream is consumed. */
export type OnMessage = (message: AgentMessage) => void;

export interface DispatchResult {
  /** Agents that were actually run, in order (includes A2A handoffs). */
  ran: string[];
  /** True if the message contained no known @mention. */
  noMatch: boolean;
}

export interface OrchestratorOptions {
  runOptions?: RunOptions;
  memory?: MemoryStore;
  /** Max A2A handoff depth before we stop, to prevent @-loops. Default 3. */
  maxHops?: number;
}

export class Orchestrator {
  private readonly runOptions: RunOptions;
  private readonly memory?: MemoryStore;
  private readonly maxHops: number;

  constructor(
    private readonly store: ThreadStore,
    private readonly adapters: AdapterRegistry,
    options: OrchestratorOptions = {},
  ) {
    this.runOptions = options.runOptions ?? {};
    this.memory = options.memory;
    this.maxHops = options.maxHops ?? 3;
  }

  /** Collapse an agent's message stream into one transcript text + success flag. */
  private async consume(
    adapter: AgentAdapter,
    prompt: string,
    onMessage?: OnMessage,
  ): Promise<{ text: string; ok: boolean }> {
    const parts: string[] = [];
    let ok = true;
    for await (const message of adapter.run(prompt, this.runOptions)) {
      onMessage?.(message);
      if (message.type === 'text') {
        parts.push(message.text);
      } else if (message.type === 'tool_use') {
        parts.push(`[tool: ${message.tool}]`);
      } else if (message.type === 'result') {
        ok = message.ok;
        if (!message.ok && message.error) parts.push(`[error: ${message.error}]`);
      }
    }
    return { text: parts.join('\n').trim(), ok };
  }

  /** Run one agent on a prompt, persist its reply, and return its output text. */
  private async runTurn(
    threadId: string,
    name: string,
    recallKey: string,
    prompt: string,
    onMessage?: OnMessage,
  ): Promise<string> {
    const adapter = this.adapters[name];
    if (!adapter) return '';
    const memories = this.memory ? await this.memory.recall(recallKey) : [];
    const composed = composePrompt(IDENTITIES[name], memories, prompt);
    const { text } = await this.consume(adapter, composed, onMessage);
    await this.store.append(threadId, {
      role: 'agent',
      agent: name,
      text: text || '(no output)',
      ts: Date.now(),
    });
    return text;
  }

  async dispatch(
    threadId: string,
    message: string,
    onMessage?: OnMessage,
  ): Promise<DispatchResult> {
    const known = Object.keys(this.adapters);
    const { agents } = parseMentions(message, known);
    await this.store.append(threadId, { role: 'user', text: message, ts: Date.now() });

    if (agents.length === 0) return { ran: [], noMatch: true };

    const ran: string[] = [];
    // Seed the queue with the human turn's mentions (hop 0), then drain it.
    const queue: Handoff[] = agents.map((to) => ({ to, from: 'user', context: message, hop: 0 }));

    while (queue.length > 0) {
      const handoff = queue.shift();
      if (!handoff) break;
      if (!this.adapters[handoff.to]) continue;

      const prompt = handoff.from === 'user' ? message : handoffPrompt(handoff, message);
      const output = await this.runTurn(threadId, handoff.to, message, prompt, onMessage);
      ran.push(handoff.to);

      // An agent can hand off to others by @mentioning them — until the hop cap.
      if (handoff.hop < this.maxHops) {
        queue.push(...detectHandoffs(handoff.to, output, known, handoff.hop));
      }
    }
    return { ran, noMatch: false };
  }
}
