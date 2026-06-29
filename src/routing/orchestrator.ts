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
import { loadFileContext } from '../context/file-refs.js';
import { composePrompt } from '../identity/compose.js';
import { IDENTITIES, resolveMode } from '../identity/identity.js';
import { extractMemories } from '../identity/memory-extract.js';
import type { MemoryStore } from '../store/memory-store.js';
import type { ThreadStore } from '../store/thread-store.js';
import type { AgentMessage, Usage } from '../types.js';
import { detectHandoffs, type Handoff, handoffPrompt } from './a2a.js';
import { pickAgent } from './capability.js';
import { parseMentions } from './mentions.js';

export type AdapterRegistry = Record<string, AgentAdapter>;

/**
 * Lifecycle events emitted during a dispatch, so a UI can show real-time
 * status — which agent is working, its streaming output, and whether it
 * succeeded or failed (including "never connected").
 */
export type DispatchEvent =
  | { kind: 'agent_start'; agent: string; hop: number }
  | { kind: 'message'; agent: string; message: AgentMessage }
  | { kind: 'agent_end'; agent: string; ok: boolean; text: string }
  // No @mention: capability routing picked this agent from its strengths.
  | { kind: 'routed'; agent: string }
  // Files named with @file: were read and inlined for a chat-only agent.
  | { kind: 'file_context'; agent: string; refs: { ref: string; ok: boolean; reason?: string }[] }
  // An agent ran as 'agent' (tool-capable) but called no tools all turn — it may
  // actually be chat-only. Hint: downgrade it with BAI_CHAT_AGENTS=<agent>.
  | { kind: 'no_tools'; agent: string }
  // Per-turn accounting: always carries wall-clock ms; usage is best-effort
  // (present only when the CLI reported tokens/cost in its terminal event).
  | { kind: 'turn_stats'; agent: string; ms: number; usage?: Usage }
  | { kind: 'done'; ran: string[]; noMatch: boolean };

/** Reported for every lifecycle event during dispatch. */
export type OnEvent = (event: DispatchEvent) => void;

export interface DispatchResult {
  /** Agents that were actually run, in order (includes A2A handoffs). */
  ran: string[];
  /** True if the message had no @mention and capability routing found no match. */
  noMatch: boolean;
  /** Agent chosen by capability routing when the message had no @mention. */
  routed?: string;
}

export interface OrchestratorOptions {
  runOptions?: RunOptions;
  memory?: MemoryStore;
  /** Max A2A handoff depth before we stop, to prevent @-loops. Default 3. */
  maxHops?: number;
  /**
   * When a message names no agent, route it to the best match by strengths
   * instead of running nobody. An explicit @mention always wins; this only
   * applies to the zero-mention case. Default true.
   */
  autoRoute?: boolean;
}

export class Orchestrator {
  private readonly runOptions: RunOptions;
  private readonly memory?: MemoryStore;
  private readonly maxHops: number;
  private readonly autoRoute: boolean;

  constructor(
    private readonly store: ThreadStore,
    private readonly adapters: AdapterRegistry,
    options: OrchestratorOptions = {},
  ) {
    this.runOptions = options.runOptions ?? {};
    this.memory = options.memory;
    this.maxHops = options.maxHops ?? 3;
    this.autoRoute = options.autoRoute ?? true;
  }

  /** Collapse an agent's message stream into one transcript text + success flag. */
  private async consume(
    adapter: AgentAdapter,
    prompt: string,
    onEvent?: OnEvent,
    signal?: AbortSignal,
  ): Promise<{ text: string; ok: boolean; tools: number; usage?: Usage }> {
    const parts: string[] = [];
    let ok = true;
    let tools = 0;
    let usage: Usage | undefined;
    const runOptions = signal ? { ...this.runOptions, signal } : this.runOptions;
    for await (const message of adapter.run(prompt, runOptions)) {
      onEvent?.({ kind: 'message', agent: adapter.name, message });
      if (message.type === 'text') {
        parts.push(message.text);
      } else if (message.type === 'tool_use') {
        tools++;
        parts.push(`[tool: ${message.tool}]`);
      } else if (message.type === 'result') {
        ok = message.ok;
        if (message.usage) usage = message.usage;
        if (!message.ok && message.error) parts.push(`[error: ${message.error}]`);
      }
    }
    return { text: parts.join('\n').trim(), ok, tools, usage };
  }

  /** Run one agent on a prompt, persist its reply, and return its output text. */
  private async runTurn(
    threadId: string,
    name: string,
    recallKey: string,
    prompt: string,
    hop: number,
    onEvent?: OnEvent,
    signal?: AbortSignal,
  ): Promise<{ text: string; ok: boolean }> {
    const adapter = this.adapters[name];
    if (!adapter) return { text: '', ok: false };
    onEvent?.({ kind: 'agent_start', agent: name, hop });
    const memories = this.memory ? await this.memory.recall(recallKey) : [];
    const identity = IDENTITIES[name];
    const mode = resolveMode(identity);
    // A chat-only agent can't read files itself, so inline any @file: contents.
    // A tool-capable agent is left to open them itself — no inlining needed.
    let fileContext = '';
    if (mode === 'chat') {
      const loaded = await loadFileContext(prompt);
      fileContext = loaded.block;
      if (loaded.refs.length > 0) {
        onEvent?.({ kind: 'file_context', agent: name, refs: loaded.refs });
      }
    }
    const composed = composePrompt(identity, memories, prompt, { mode, fileContext });
    const startedAt = Date.now();
    const { text, ok, tools, usage } = await this.consume(adapter, composed, onEvent, signal);
    const ms = Date.now() - startedAt;
    // We treated this agent as tool-capable, but it completed a turn without
    // calling any tool — a sign the backing model may actually be chat-only
    // (e.g. a custom-provider name that isn't really agentic). Surface it so the
    // operator can flip BAI_CHAT_AGENTS=<agent> to feed files instead of betting
    // the model can read them. Only when it succeeded: a failed turn ran nothing.
    if (ok && mode === 'agent' && tools === 0) {
      onEvent?.({ kind: 'no_tools', agent: name });
    }
    await this.store.append(threadId, {
      role: 'agent',
      agent: name,
      text: text || '(no output)',
      ts: Date.now(),
      ms,
      ...(usage ? { usage } : {}),
    });
    // Sediment any decisions/lessons from a successful turn into shared memory,
    // so a later turn's recall can surface them (the write side of recall).
    if (ok && this.memory && text) {
      for (const m of extractMemories(text)) {
        await this.memory.record(m.kind, name, m.text);
      }
    }
    // Surface timing/usage live so a UI can show "took 12.3s · 1.2k tok" without
    // re-reading the thread. ms is always present; usage only when the CLI gave it.
    onEvent?.({ kind: 'turn_stats', agent: name, ms, ...(usage ? { usage } : {}) });
    onEvent?.({ kind: 'agent_end', agent: name, ok, text: text || '(no output)' });
    return { text, ok };
  }

  /**
   * Run a single named agent on a prompt and persist it, outside the @mention
   * flow. Used by orchestration that picks agents itself (e.g. the audit
   * pipeline's stage runner), so those features inherit identity, memory,
   * streaming, timeout/cancel, and transcript persistence for free.
   *
   * `recallKey` is what memory recall matches on (usually the task text);
   * `hop` is only a display tag. Returns the turn's text and whether it
   * completed (ok=false means the agent failed to run — spawn error, timeout,
   * crash — not that it returned a negative verdict).
   */
  async runOne(
    threadId: string,
    agent: string,
    prompt: string,
    options: { recallKey?: string; hop?: number; onEvent?: OnEvent; signal?: AbortSignal } = {},
  ): Promise<{ text: string; ok: boolean }> {
    return this.runTurn(
      threadId,
      agent,
      options.recallKey ?? prompt,
      prompt,
      options.hop ?? 0,
      options.onEvent,
      options.signal,
    );
  }

  async dispatch(
    threadId: string,
    message: string,
    onEvent?: OnEvent,
    signal?: AbortSignal,
  ): Promise<DispatchResult> {
    const known = Object.keys(this.adapters);
    const { agents } = parseMentions(message, known);
    await this.store.append(threadId, { role: 'user', text: message, ts: Date.now() });

    // No explicit @mention: try capability routing (best match by strengths).
    // An @mention always wins; this only fills the zero-mention gap. We only
    // consider agents that are actually registered, so routing can't pick an
    // identity with no adapter behind it.
    let routed: string | undefined;
    let toRun = agents;
    if (agents.length === 0) {
      if (this.autoRoute) {
        const candidates = known.map((name) => IDENTITIES[name]).filter((id) => id !== undefined);
        routed = pickAgent(message, candidates);
      }
      if (!routed) {
        onEvent?.({ kind: 'done', ran: [], noMatch: true });
        return { ran: [], noMatch: true };
      }
      onEvent?.({ kind: 'routed', agent: routed });
      toRun = [routed];
    }

    const ran: string[] = [];
    // Seed the queue with the human turn's mentions (hop 0), then drain it.
    const queue: Handoff[] = toRun.map((to) => ({ to, from: 'user', context: message, hop: 0 }));

    while (queue.length > 0) {
      const handoff = queue.shift();
      if (!handoff) break;
      if (!this.adapters[handoff.to]) continue;
      // Stop draining the queue if the whole dispatch was cancelled.
      if (signal?.aborted) break;

      const prompt = handoff.from === 'user' ? message : handoffPrompt(handoff, message);
      const { text: output } = await this.runTurn(
        threadId,
        handoff.to,
        message,
        prompt,
        handoff.hop,
        onEvent,
        signal,
      );
      ran.push(handoff.to);

      // An agent can hand off to others by @mentioning them — until the hop cap.
      if (handoff.hop < this.maxHops) {
        queue.push(...detectHandoffs(handoff.to, output, known, handoff.hop));
      }
    }
    onEvent?.({ kind: 'done', ran, noMatch: false });
    return { ran, noMatch: false, routed };
  }
}
