/**
 * Unified message types.
 *
 * Every agent adapter (Claude, Codex, Gemini, ...) normalizes its CLI's native
 * output into these types. This is the single format the rest of BAi works with,
 * so nothing above the adapter layer needs to know which CLI produced a message.
 */

/** A chunk of assistant-visible text. */
export interface TextMessage {
  type: 'text';
  /** Which agent produced this (e.g. "claude"). */
  agent: string;
  text: string;
}

/** The agent invoked a tool (file read/write, shell command, ...). */
export interface ToolUseMessage {
  type: 'tool_use';
  agent: string;
  /** Tool name as reported by the CLI (e.g. "Read", "Bash", "file_change"). */
  tool: string;
  /** Tool input, shape varies per tool — kept opaque on purpose. */
  input: unknown;
}

/**
 * Best-effort token/cost accounting for one turn. Every field is optional: the
 * CLIs report usage in different shapes (and some not at all), so an adapter
 * fills in whatever its terminal event carries and leaves the rest undefined.
 * Wall-clock duration is NOT here — the orchestrator measures that itself, so
 * it's available even for a CLI that reports no usage (see ThreadEntry.ms).
 */
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  /** Total tokens, when the CLI reports a single figure rather than a split. */
  totalTokens?: number;
  /** Cost in USD, when the CLI reports it (e.g. Claude's total_cost_usd). */
  costUsd?: number;
}

/** Terminal message: the agent finished (or errored) for this turn. */
export interface ResultMessage {
  type: 'result';
  agent: string;
  /** Did the turn complete successfully? */
  ok: boolean;
  /** Final text summary, if the CLI provided one. */
  text?: string;
  /** Error description when ok === false. */
  error?: string;
  /** Token/cost accounting, when the CLI's terminal event carries it. */
  usage?: Usage;
}

/** Anything the adapter emits as it processes a turn. */
export type AgentMessage = TextMessage | ToolUseMessage | ResultMessage;

/** Who authored a thread entry. */
export type Role = 'user' | 'agent';

/** One persisted turn in a thread's transcript. */
export interface ThreadEntry {
  role: Role;
  /** Agent id when role === 'agent'; omitted for user entries. */
  agent?: string;
  text: string;
  /** Epoch milliseconds. */
  ts: number;
  /** Wall-clock duration of an agent turn, in ms (orchestrator-measured). */
  ms?: number;
  /** Token/cost accounting for an agent turn, when the CLI reported it. */
  usage?: Usage;
}

/** An isolated conversation / task workspace. */
export interface Thread {
  id: string;
  title: string;
  entries: ThreadEntry[];
  createdAt: number;
  updatedAt: number;
}
