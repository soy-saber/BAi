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
import type { ThreadStore } from '../store/thread-store.js';
import type { AgentMessage } from '../types.js';
import { parseMentions } from './mentions.js';

export type AdapterRegistry = Record<string, AgentAdapter>;

/** Reported as each agent's stream is consumed. */
export type OnMessage = (message: AgentMessage) => void;

export interface DispatchResult {
  /** Agents that were actually run, in order. */
  ran: string[];
  /** True if the message contained no known @mention. */
  noMatch: boolean;
}

export class Orchestrator {
  constructor(
    private readonly store: ThreadStore,
    private readonly adapters: AdapterRegistry,
    private readonly runOptions: RunOptions = {},
  ) {}

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

  async dispatch(
    threadId: string,
    message: string,
    onMessage?: OnMessage,
  ): Promise<DispatchResult> {
    const { agents } = parseMentions(message, Object.keys(this.adapters));
    await this.store.append(threadId, { role: 'user', text: message, ts: Date.now() });

    if (agents.length === 0) return { ran: [], noMatch: true };

    for (const name of agents) {
      const adapter = this.adapters[name];
      if (!adapter) continue;
      const { text } = await this.consume(adapter, message, onMessage);
      await this.store.append(threadId, {
        role: 'agent',
        agent: name,
        text: text || '(no output)',
        ts: Date.now(),
      });
    }
    return { ran: agents, noMatch: false };
  }
}
