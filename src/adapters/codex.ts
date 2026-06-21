/**
 * Codex adapter — wraps the `codex` CLI.
 *
 * Native command:
 *   codex exec --json --sandbox <mode> -        (prompt on stdin)
 *
 * Each stdout line is one JSON event (very different shape from Claude):
 *   { type: "thread.started" }                                  -> diagnostic
 *   { type: "turn.started" }                                    -> diagnostic
 *   { type: "item.completed", item: { type: "agent_message",
 *       text } }                                                -> text
 *   { type: "item.completed", item: { type: "file_change",
 *       changes: [{ path, kind }] } }                           -> tool_use
 *   { type: "turn.completed", usage }                           -> terminal
 *   { type: "turn.failed" | "error" }                           -> terminal (error)
 *
 * Note: codex emits item.started AND item.completed for the same item; we map
 * only item.completed so each action surfaces once.
 */

import type { AgentMessage } from '../types.js';
import { type AgentAdapter, type CliSpec, type RunOptions, runCli } from './adapter.js';

interface CodexItem {
  type: string;
  text?: string;
  changes?: Array<{ path: string; kind: string }>;
  command?: string;
}

const spec: CliSpec = {
  name: 'codex',
  bin: 'codex',
  buildArgs(permission) {
    // Map our unified permission levels onto codex's sandbox modes.
    const sandbox =
      permission === 'bypass'
        ? 'danger-full-access'
        : permission === 'acceptEdits'
          ? 'workspace-write'
          : 'read-only';
    return ['exec', '--json', '--sandbox', sandbox, '-'];
  },
  mapEvent(event, agent): AgentMessage[] {
    if (event.type === 'item.completed') {
      const item = event.item as CodexItem | undefined;
      if (!item) return [];
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        return [{ type: 'text', agent, text: item.text }];
      }
      if (item.type === 'file_change' && Array.isArray(item.changes)) {
        return [{ type: 'tool_use', agent, tool: 'file_change', input: item.changes }];
      }
      if (item.type === 'command_execution') {
        return [{ type: 'tool_use', agent, tool: 'command', input: item.command }];
      }
      return [];
    }
    if (event.type === 'turn.completed') {
      return [{ type: 'result', agent, ok: true }];
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      const message = typeof event.message === 'string' ? event.message : undefined;
      return [{ type: 'result', agent, ok: false, error: message }];
    }
    // thread.started / turn.started / item.started: no user-facing payload.
    return [];
  },
};

export const codexAdapter: AgentAdapter = {
  name: spec.name,
  run(prompt: string, options?: RunOptions) {
    return runCli(spec, prompt, options);
  },
};
