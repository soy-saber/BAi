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
  /**
   * Max milliseconds for one turn before the child is killed and the turn
   * fails. Omit or set 0 to disable. Kept generous by default because agent
   * turns legitimately take minutes (see ADR 0003 on rate-limit latency).
   */
  timeoutMs?: number;
  /**
   * Abort signal to cancel the turn early (e.g. a "stop" button). When aborted,
   * the child is killed and the turn ends with a failed result.
   */
  signal?: AbortSignal;
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
  // Already cancelled before we start: don't spawn at all, just fail the turn.
  if (options.signal?.aborted) {
    yield { type: 'result', agent: spec.name, ok: false, error: `${spec.bin} cancelled` };
    return;
  }

  const args = spec.buildArgs(options.permission ?? 'bypass');
  const child = spawn(spec.bin, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: IS_WIN,
  });

  // A missing or unspawnable binary emits 'error' (e.g. ENOENT) instead of
  // streaming output. Capture it so the turn fails cleanly with a clear message
  // rather than hanging or throwing — this is the "CLI isn't installed / can't
  // connect" case surfacing as a normal terminal result.
  let spawnError: Error | undefined;
  child.on('error', (err) => {
    spawnError = err;
  });

  // Reason the turn was forcibly ended, if any. Set when we kill the child due
  // to a timeout or an external abort, so the synthesized result is accurate.
  let killReason: string | undefined;
  // Assigned once the readline interface exists; closing it ends the for-await
  // loop immediately, which destroying the stream alone does not do reliably.
  let closeLines: () => void = () => {};
  const kill = (reason: string): void => {
    if (killReason) return;
    killReason = reason;
    // On Windows under shell:true the child is cmd.exe; killing it can leave the
    // real grandchild running with the stdout pipe open, which would hang the
    // readline loop below forever. Kill the whole tree, then close the readline
    // interface so the async iterator ends regardless of OS reaping timing.
    if (IS_WIN && child.pid !== undefined) {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
      } catch {
        child.kill();
      }
    } else {
      child.kill();
    }
    closeLines();
    child.stdout?.destroy();
  };

  // Per-turn timeout: kill the child and fail the turn if it runs too long.
  const timeoutMs = options.timeoutMs ?? 0;
  const timer =
    timeoutMs > 0 ? setTimeout(() => kill(`timed out after ${timeoutMs}ms`), timeoutMs) : undefined;
  if (timer && typeof timer.unref === 'function') timer.unref();

  // External cancellation (e.g. a "stop" button). Only attach the listener
  // here; an already-aborted signal is handled after the readline interface is
  // wired up, so kill() can actually end the iterator (see below).
  const onAbort = (): void => kill('cancelled');
  options.signal?.addEventListener('abort', onAbort, { once: true });

  // Writing to stdin of a process that failed to spawn throws EPIPE; guard it.
  try {
    child.stdin.write(prompt);
    child.stdin.end();
  } catch {
    // ignore — the 'error'/'close' path reports the real failure
  }

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
  closeLines = () => lines.close();
  let sawResult = false;

  try {
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
  } catch {
    // Destroying stdout on kill (timeout/abort) can reject the iterator; that's
    // expected — the killReason path below reports the real outcome.
  }

  const exitCode: number = await new Promise((resolve) => {
    let settled = false;
    const done = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    // 'close' fires once stdio is flushed; 'exit' fires on process exit. Resolve
    // on whichever comes first so a killed/reaped tree can't leave us hanging.
    child.on('close', (code) => done(code ?? 0));
    child.on('exit', (code) => done(code ?? 0));
  });

  if (timer) clearTimeout(timer);
  if (options.signal) options.signal.removeEventListener('abort', onAbort);

  // Guarantee callers always get a terminal message.
  if (!sawResult) {
    const reason = killReason
      ? `${spec.bin} ${killReason}`
      : spawnError
        ? `could not start '${spec.bin}': ${spawnError.message}`
        : `${spec.bin} exited (code ${exitCode}) without a result${
            stderr ? `: ${stderr.trim()}` : ''
          }`;
    yield { type: 'result', agent: spec.name, ok: false, error: reason };
  }
}
