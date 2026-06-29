/**
 * Gemini adapter — wraps Google's `gemini` CLI.
 *
 * Native command:
 *   gemini -o stream-json --skip-trust --yolo    (prompt on stdin)
 *
 * Flags:
 *   -o stream-json  emit one JSON event per line (NDJSON), like the others
 *   --skip-trust    don't downgrade out of YOLO just because the cwd is an
 *                   "untrusted" folder; without it autonomous file ops are
 *                   silently disabled even with --yolo
 *   --yolo          auto-approve every tool call (our 'bypass' permission)
 *
 * The prompt is fed on stdin (no -p needed). The CLI reads ~/.gemini/.env for
 * GEMINI_API_KEY / GEMINI_MODEL / GOOGLE_GEMINI_BASE_URL on its own.
 *
 * Each stdout line is one JSON event (non-JSON warning/error lines are skipped
 * by runCli):
 *   { type: "init",    model, session_id, ... }       -> diagnostic (skip)
 *   { type: "message", role: "user",   content }      -> prompt echo (skip)
 *   { type: "message", role: "assistant"|"model", content } -> text
 *   { type: "result",  status: "success"|"error", error?, stats } -> terminal
 *
 * Gemini has no separate tool_use event in stream-json output — tool activity is
 * folded into messages — so this adapter emits text + result only.
 */

import type { AgentMessage } from '../types.js';
import {
  type AgentAdapter,
  type CliSpec,
  type Permission,
  type RunOptions,
  runCli,
} from './adapter.js';

export const geminiSpec: CliSpec = {
  name: 'gemini',
  bin: 'gemini',
  buildArgs(permission: Permission) {
    const args = ['-o', 'stream-json', '--skip-trust'];
    // 'default' lets the CLI prompt for approval (blocks unattended); the other
    // two levels both mean "act without asking", which is --yolo for gemini.
    if (permission !== 'default') args.push('--yolo');
    return args;
  },
  mapEvent(event, agent): AgentMessage[] {
    if (event.type === 'message') {
      const role = event.role;
      // The CLI echoes our own prompt back as a user message; drop it.
      if (role === 'user') return [];
      const content = event.content;
      if (typeof content !== 'string' || content.length === 0) return [];
      return [{ type: 'text', agent, text: content }];
    }

    if (event.type === 'result') {
      if (event.status === 'success') {
        // gemini reports token counts under `stats`, but the exact shape has
        // shifted across CLI versions. Probe the common spots defensively and
        // emit whatever we can find; missing stats just means no usage line.
        const stats = event.stats as Record<string, unknown> | undefined;
        const tokens = (stats?.tokens ?? stats?.usage) as Record<string, unknown> | undefined;
        const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
        const input = num(tokens?.prompt ?? tokens?.input ?? tokens?.promptTokenCount);
        const output = num(tokens?.candidates ?? tokens?.output ?? tokens?.candidatesTokenCount);
        const total = num(tokens?.total ?? tokens?.totalTokenCount);
        const usage =
          input !== undefined || output !== undefined || total !== undefined
            ? {
                ...(input !== undefined ? { inputTokens: input } : {}),
                ...(output !== undefined ? { outputTokens: output } : {}),
                ...(total !== undefined ? { totalTokens: total } : {}),
              }
            : undefined;
        return [{ type: 'result', agent, ok: true, ...(usage ? { usage } : {}) }];
      }
      const err = event.error as { message?: string; type?: string } | undefined;
      const message = err?.message ?? err?.type ?? 'gemini error';
      return [{ type: 'result', agent, ok: false, error: message }];
    }

    // init and anything else: no user-facing payload.
    return [];
  },
};

export const geminiAdapter: AgentAdapter = {
  name: geminiSpec.name,
  run(prompt: string, options?: RunOptions) {
    return runCli(geminiSpec, prompt, options);
  },
};
