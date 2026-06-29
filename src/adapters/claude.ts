/**
 * Claude adapter — wraps the `claude` CLI.
 *
 * Native command:
 *   claude -p --output-format stream-json --verbose   (prompt on stdin)
 *
 * Each stdout line is one JSON event:
 *   { type: "system",    subtype: "init" | "api_retry", ... }   -> diagnostics
 *   { type: "assistant", message: { content: [ ... ] } }        -> text / tool_use
 *   { type: "result",    is_error, result }                     -> terminal
 */

import type { AgentMessage } from '../types.js';
import { type AgentAdapter, type CliSpec, type RunOptions, runCli } from './adapter.js';

/** Raw content block inside an `assistant` event. */
interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

const spec: CliSpec = {
  name: 'claude',
  bin: 'claude',
  buildArgs(permission) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (permission === 'bypass') {
      args.push('--dangerously-skip-permissions');
    } else if (permission === 'acceptEdits') {
      args.push('--permission-mode', 'acceptEdits');
    }
    return args;
  },
  mapEvent(event, agent): AgentMessage[] {
    if (event.type === 'assistant') {
      const message = event.message as { content?: ContentBlock[] } | undefined;
      const out: AgentMessage[] = [];
      for (const block of message?.content ?? []) {
        if (block.type === 'text' && typeof block.text === 'string') {
          out.push({ type: 'text', agent, text: block.text });
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          out.push({ type: 'tool_use', agent, tool: block.name, input: block.input });
        }
      }
      return out;
    }
    if (event.type === 'result') {
      const text = typeof event.result === 'string' ? event.result : undefined;
      // Claude's result event carries token usage and a rolled-up cost. Shape:
      //   { usage: { input_tokens, output_tokens, ... }, total_cost_usd }
      const u = event.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      const cost = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : undefined;
      const usage =
        u || cost !== undefined
          ? {
              ...(typeof u?.input_tokens === 'number' ? { inputTokens: u.input_tokens } : {}),
              ...(typeof u?.output_tokens === 'number' ? { outputTokens: u.output_tokens } : {}),
              ...(cost !== undefined ? { costUsd: cost } : {}),
            }
          : undefined;
      return [{ type: 'result', agent, ok: event.is_error !== true, text, usage }];
    }
    // system events (init, api_retry, ...) carry no user-facing payload.
    return [];
  },
};

export const claudeAdapter: AgentAdapter = {
  name: spec.name,
  run(prompt: string, options?: RunOptions) {
    return runCli(spec, prompt, options);
  },
};
