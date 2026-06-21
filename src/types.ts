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
}

/** An isolated conversation / task workspace. */
export interface Thread {
  id: string;
  title: string;
  entries: ThreadEntry[];
  createdAt: number;
  updatedAt: number;
}
