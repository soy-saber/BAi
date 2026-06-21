/**
 * The agent abstraction.
 *
 * Every agent CLI is wrapped as an `AgentAdapter`. Above this line, the rest of
 * BAi only deals in `AgentMessage`s and never needs to know which CLI ran.
 *
 * The spawn + NDJSON-parse + terminal-result-guarantee machinery is identical
 * across CLIs, so it lives here in `runCli`. Each adapter only supplies what
 * actually differs: the binary, its argv, and how to map one native event to
 * our unified messages.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentMessage } from '../types.js';

/** How much autonomy the agent gets over file/command actions. */
export type Permission = 'default' | 'acceptEdits' | 'bypass';

export interface RunOptions {
  /** Working directory for the agent. Defaults to process.cwd(). */
  cwd?: string;
  /**
   *   'default'     — CLI asks for approval (blocks in non-interactive use)
   *   'acceptEdits' — auto-approve file edits within the workspace
   *   'bypass'      — skip all sandboxing/prompts (trusted dirs only)
   * Defaults to 'bypass' so an unattended turn can actually do work.
   */
  permission?: Permission;
}

export interface AgentAdapter {
  /** Stable id used for routing and message tagging (e.g. "claude"). */
  readonly name: string;
  /** Run one turn, async-iterating normalized messages as the CLI streams. */
  run(prompt: string, options?: RunOptions): AsyncGenerator<AgentMessage>;
}

/** Everything that differs between one CLI and another. */
export interface CliSpec {
  /** Agent id; also tags every message this CLI produces. */
  name: string;
  /** Executable name (resolved on PATH). */
  bin: string;
  /** Build argv from the requested permission level. */
  buildArgs(permission: Permission): string[];
  /** Map one parsed NDJSON event to zero or more unified messages. */
  mapEvent(event: Record<string, unknown>, agent: string): AgentMessage[];
}

// On Windows the agent CLIs are `.cmd` shims, and Node 20+ refuses to spawn
// `.cmd` directly (EINVAL), so we fall back to `shell: true` there. Safe here
// because argv is all hard-coded constant flags; the only untrusted input (the
// prompt) goes on stdin, never the command line — no shell-injection surface.
const IS_WIN = process.platform === 'win32';

/**
 * Shared turn runner: spawn the CLI, feed the prompt on stdin, parse its NDJSON
 * stream into unified messages, and guarantee a terminal `result` message even
 * if the process dies without emitting one.
 */
export async function* runCli(
  spec: CliSpec,
  prompt: string,
  options: RunOptions = {},
): AsyncGenerator<AgentMessage> {
  const args = spec.buildArgs(options.permission ?? 'bypass');
  const child = spawn(spec.bin, args, {
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

  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
  let sawResult = false;

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed);
    } catch {
      // Non-JSON line: the CLI printed something unexpected. Skip it rather
      // than crashing the whole turn.
      continue;
    }
    for (const message of spec.mapEvent(event, spec.name)) {
      if (message.type === 'result') sawResult = true;
      yield message;
    }
  }

  const exitCode: number = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });

  // Guarantee callers always get a terminal message.
  if (!sawResult) {
    yield {
      type: 'result',
      agent: spec.name,
      ok: false,
      error: `${spec.bin} exited (code ${exitCode}) without a result${
        stderr ? `: ${stderr.trim()}` : ''
      }`,
    };
  }
}
