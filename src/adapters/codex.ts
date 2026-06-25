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

export const codexSpec: CliSpec = {
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
    const args = ['exec', '--json', '--sandbox', sandbox];
    // Optional model override (Config Immutability: deployment differences live
    // in env, not source — and not by editing the user's ~/.codex/config.toml).
    // `BAI_CODEX_MODEL=gpt-5.5` makes codex run that model via `-m`, reusing the
    // provider/base_url already in config. Useful when config pins a chat-only
    // model (e.g. gemini-3.1-pro) but you want a tool-capable one for this run.
    const model = process.env.BAI_CODEX_MODEL?.trim();
    if (model) args.push('-m', model);
    args.push('-'); // prompt on stdin
    return args;
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
  name: codexSpec.name,
  run(prompt: string, options?: RunOptions) {
    return runCli(codexSpec, prompt, options);
  },
};
