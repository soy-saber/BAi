/**
 * Claude adapter — spawns the `claude` CLI and normalizes its stream-json
 * (NDJSON) output into our unified AgentMessage type.
 *
 * Native command:
 *   claude -p "<prompt>" --output-format stream-json --verbose
 *
 * Each stdout line is one JSON event. The shapes we care about:
 *   { type: "system",    subtype: "init" | "api_retry", ... }   -> diagnostics
 *   { type: "assistant", message: { content: [ ... ] } }        -> text / tool_use
 *   { type: "result",    is_error, result }                     -> terminal
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentMessage } from '../types.js';

const AGENT = 'claude';

/** Raw content block inside an `assistant` event. */
interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

/** Translate one parsed NDJSON event into zero or more AgentMessages. */
function eventToMessages(event: Record<string, unknown>): AgentMessage[] {
  const type = event.type;

  if (type === 'assistant') {
    const message = event.message as { content?: ContentBlock[] } | undefined;
    const blocks = message?.content ?? [];
    const out: AgentMessage[] = [];
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        out.push({ type: 'text', agent: AGENT, text: block.text });
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        out.push({ type: 'tool_use', agent: AGENT, tool: block.name, input: block.input });
      }
    }
    return out;
  }

  if (type === 'result') {
    const isError = event.is_error === true;
    const text = typeof event.result === 'string' ? event.result : undefined;
    return [{ type: 'result', agent: AGENT, ok: !isError, text }];
  }

  // system events (init, api_retry, ...) carry no user-facing payload.
  return [];
}

export interface RunOptions {
  /** Working directory for the agent. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * How much autonomy the agent gets over file/command actions:
   *   'default'      — CLI asks for approval (blocks in non-interactive use)
   *   'acceptEdits'  — auto-approve file edits, still confirm risky commands
   *   'bypass'       — skip all permission prompts (use only in trusted dirs)
   * Defaults to 'bypass' so a non-interactive turn can fully do work.
   */
  permission?: 'default' | 'acceptEdits' | 'bypass';
}

// On Windows `claude` is a `.cmd` shim, and Node 20+ refuses to spawn `.cmd`
// directly (EINVAL), so we fall back to `shell: true` there. This is safe
// because every argv entry below is a hard-coded constant flag — the only
// untrusted input (the prompt) is passed on stdin, never on the command line,
// so there is no shell-injection surface.
const IS_WIN = process.platform === 'win32';
const CLAUDE_BIN = 'claude';

/**
 * Run one Claude turn. Async-iterates normalized messages as the CLI streams.
 *
 * The prompt is passed on stdin (not argv) to avoid the Windows CreateProcess
 * 32K command-line limit on long prompts.
 */
export async function* runClaude(
  prompt: string,
  options: RunOptions = {},
): AsyncGenerator<AgentMessage> {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  const permission = options.permission ?? 'bypass';
  if (permission === 'bypass') {
    args.push('--dangerously-skip-permissions');
  } else if (permission === 'acceptEdits') {
    args.push('--permission-mode', 'acceptEdits');
  }

  const child = spawn(CLAUDE_BIN, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: IS_WIN,
  });

  child.stdin.write(prompt);
  child.stdin.end();

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let sawResult = false;

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed);
    } catch {
      // A non-JSON line means the CLI printed something unexpected; skip it
      // rather than crashing the whole turn.
      continue;
    }
    for (const message of eventToMessages(event)) {
      if (message.type === 'result') sawResult = true;
      yield message;
    }
  }

  const exitCode: number = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });

  // If the CLI died without emitting a result event, surface that as a failed
  // turn so callers always get a terminal message.
  if (!sawResult) {
    yield {
      type: 'result',
      agent: AGENT,
      ok: false,
      error: `claude exited (code ${exitCode}) without a result${stderr ? `: ${stderr.trim()}` : ''}`,
    };
  }
}
