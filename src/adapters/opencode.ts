/**
 * opencode adapter — wraps the `opencode` CLI.
 *
 * Native command:
 *   opencode run --format json [-m <provider/model>]    (prompt on stdin)
 *
 * Each stdout line is one JSON event:
 *   { type: "step_start",  ... }                              -> diagnostic
 *   { type: "text",   part: { type, text } }                  -> text (or reasoning)
 *   { type: "tool_use", part: { tool, state: { input } } }    -> tool_use
 *   { type: "error",  error: { data: { message } } }          -> terminal (error)
 *   { type: "step_finish", part: { reason } }                 -> terminal when
 *       reason is 'stop'/'length'/'content-filter'; 'tool-calls' means more
 *       steps follow, so it is NOT terminal.
 *
 * Model selection: opencode's configured default provider may be unset or
 * broken, so the model is taken from OPENCODE_MODEL (e.g. "deepseek/deepseek-chat")
 * when present. Without it, opencode uses its own default.
 */

import type { AgentMessage } from '../types.js';
import { type AgentAdapter, type CliSpec, type RunOptions, runCli } from './adapter.js';

interface OpenCodePart {
  type?: string;
  text?: string;
  tool?: string;
  reason?: string;
  state?: { input?: unknown };
  /** step_finish may carry token usage; shape varies, so all fields optional. */
  tokens?: { input?: number; output?: number; total?: number };
}

/** step_finish reasons that end the turn (anything but more tool calls). */
const TERMINAL_REASONS = new Set(['stop', 'length', 'content-filter', 'error', 'aborted']);

const spec: CliSpec = {
  name: 'opencode',
  bin: 'opencode',
  buildArgs(_permission) {
    // opencode `run` executes in its own permission model; we don't map our
    // levels onto a flag here (it has no sandbox flag like claude/codex).
    const args = ['run', '--format', 'json'];
    const model = process.env.OPENCODE_MODEL;
    if (model) args.push('-m', model);
    return args;
  },
  mapEvent(event, agent): AgentMessage[] {
    const part = event.part as OpenCodePart | undefined;

    if (event.type === 'text') {
      const text = part?.text;
      if (typeof text !== 'string' || text.length === 0) return [];
      // Reasoning/thinking comes through as a text event with part.type
      // 'reasoning'; treat it as text too (tagged), don't drop it.
      const prefix = part?.type === 'reasoning' ? '[thinking] ' : '';
      return [{ type: 'text', agent, text: `${prefix}${text}` }];
    }

    if (event.type === 'tool_use') {
      return [
        { type: 'tool_use', agent, tool: part?.tool ?? 'unknown', input: part?.state?.input },
      ];
    }

    if (event.type === 'error') {
      const err = event.error as { name?: string; data?: { message?: string } } | undefined;
      const message = err?.data?.message ?? err?.name ?? 'opencode error';
      return [{ type: 'result', agent, ok: false, error: message }];
    }

    if (event.type === 'step_finish') {
      const reason = part?.reason;
      // Only a terminal reason ends the turn; 'tool-calls' means keep going.
      if (typeof reason === 'string' && TERMINAL_REASONS.has(reason)) {
        // step_finish may carry token counts; surface whatever it has.
        const t = part?.tokens;
        const usage =
          t &&
          (typeof t.input === 'number' ||
            typeof t.output === 'number' ||
            typeof t.total === 'number')
            ? {
                ...(typeof t.input === 'number' ? { inputTokens: t.input } : {}),
                ...(typeof t.output === 'number' ? { outputTokens: t.output } : {}),
                ...(typeof t.total === 'number' ? { totalTokens: t.total } : {}),
              }
            : undefined;
        return [{ type: 'result', agent, ok: reason !== 'error' && reason !== 'aborted', usage }];
      }
      return [];
    }

    // step_start and anything else: no user-facing payload.
    return [];
  },
};

export const opencodeAdapter: AgentAdapter = {
  name: spec.name,
  run(prompt: string, options?: RunOptions) {
    return runCli(spec, prompt, options);
  },
};
