/**
 * Pipelines — ordered multi-agent workflows with fallback.
 *
 * A pipeline is a fixed sequence of stages. Each stage names a primary agent
 * and an ordered list of fallbacks; the runner tries the primary, and if it
 * *fails to run* (spawn error, timeout, crash — `ok: false`) moves to the next
 * fallback. A stage that produces output (even a negative verdict) is a
 * success: we fall back on broken agents, never on bad news.
 *
 * Each stage builds its prompt from the original task plus every prior stage's
 * output, so a later stage can "gatekeep" an earlier one (read what it produced
 * and judge it). The whole thing runs on Orchestrator.runOne, so stages inherit
 * identity, memory, streaming, timeout/cancel, and transcript persistence.
 *
 * The audit pipeline (`auditPipeline`) is the motivating case:
 *   1. audit     — Claude audits the code
 *   2. gatekeep  — a reviewer checks Claude's audit; primary codex (GPT),
 *                  falling back to opencode if codex can't be reached
 */

import type { OnEvent, Orchestrator } from './orchestrator.js';

/** One step in a pipeline. */
export interface Stage {
  /** Display/label for this step (e.g. "audit", "gatekeep"). */
  name: string;
  /** Preferred agent id. */
  primary: string;
  /** Agents to try, in order, if the primary fails to run. */
  fallbacks?: string[];
  /**
   * Build this stage's prompt from the original task and all prior stage
   * results (in order). Lets a later stage read and judge earlier output.
   */
  buildPrompt(task: string, prior: StageResult[]): string;
}

/** What one stage produced. */
export interface StageResult {
  stage: string;
  /** The agent that actually ran (may be a fallback, not the primary). */
  agent: string;
  text: string;
  /** Did some agent complete the stage? False only if primary + all fallbacks failed. */
  ok: boolean;
  /** Agents that were tried and failed before the one that ran (or all, if none ran). */
  failedOver: string[];
}

export interface PipelineEvent {
  /** A stage is starting (before any agent runs). */
  stage_start?: { stage: string; agent: string };
  /** An agent failed to run; the pipeline is falling back to the next. */
  fallback?: { stage: string; from: string; to: string; reason: string };
  /** A stage finished (ok or exhausted). */
  stage_end?: StageResult;
}

export type OnPipelineEvent = (event: PipelineEvent) => void;

export interface RunPipelineOptions {
  onPipelineEvent?: OnPipelineEvent;
  /** Forwarded to each agent turn so the UI sees streaming/agent lifecycle. */
  onEvent?: OnEvent;
  signal?: AbortSignal;
}

/**
 * Run a pipeline to completion (or until a stage exhausts every agent).
 *
 * Stops early and returns what it has if a stage fails outright (no agent could
 * run it): a gatekeep step is meaningless if the audit it depends on never
 * happened. The caller sees the partial results and the failed stage.
 */
export async function runPipeline(
  orch: Orchestrator,
  threadId: string,
  task: string,
  stages: Stage[],
  options: RunPipelineOptions = {},
): Promise<StageResult[]> {
  const results: StageResult[] = [];

  for (const stage of stages) {
    if (options.signal?.aborted) break;

    const candidates = [stage.primary, ...(stage.fallbacks ?? [])];
    const prompt = stage.buildPrompt(task, results);
    const failedOver: string[] = [];
    let settled: StageResult | undefined;

    for (let i = 0; i < candidates.length; i++) {
      const agent = candidates[i];
      if (!agent) continue;
      options.onPipelineEvent?.({ stage_start: { stage: stage.name, agent } });

      const { text, ok } = await orch.runOne(threadId, agent, prompt, {
        recallKey: task,
        onEvent: options.onEvent,
        signal: options.signal,
      });

      if (ok) {
        settled = { stage: stage.name, agent, text, ok: true, failedOver: [...failedOver] };
        break;
      }

      // This agent couldn't run the stage. Record it and fall back if we can.
      failedOver.push(agent);
      const next = candidates[i + 1];
      if (next) {
        options.onPipelineEvent?.({
          fallback: { stage: stage.name, from: agent, to: next, reason: text || 'failed to run' },
        });
      } else {
        // No more fallbacks: the stage is exhausted.
        settled = { stage: stage.name, agent, text, ok: false, failedOver: [...failedOver] };
      }
    }

    // settled is always assigned (loop body sets it on success or on the last
    // exhausted candidate); guard for the empty-candidates edge anyway.
    const result =
      settled ??
      ({ stage: stage.name, agent: stage.primary, text: '', ok: false, failedOver } as StageResult);
    results.push(result);
    options.onPipelineEvent?.({ stage_end: result });

    // A failed stage breaks the chain: later stages depend on this output.
    if (!result.ok) break;
  }

  return results;
}

/**
 * The audit pipeline: Claude audits, then a gatekeeper (GPT/codex, falling back
 * to opencode) reviews that audit.
 *
 * Agent ids are parameterized so this isn't hard-wired to specific adapters,
 * but the defaults match the requested flow: claude → codex → opencode.
 */
/**
 * The security-audit pipeline: a two-pass vulnerability review.
 *
 *   1. find    — the auditor (Claude, tool-capable: reads files itself) hunts
 *                vulnerabilities and, for each, spells out the complete
 *                data-flow (source → sink → path) so it can be checked.
 *   2. verify  — the verifier (GPT/codex, falling back to opencode) does NOT
 *                redo the audit; it independently checks whether each reported
 *                vulnerability's WHOLE flow actually exists and is exploitable,
 *                marking each confirmed / false-positive / uncertain.
 *
 * This is the sharper sibling of `auditPipeline`: instead of a generic "is this
 * audit sound" gatekeep, the second stage validates the vulnerability flow
 * itself — the difference between "the report looks reasonable" and "I traced
 * it and the bug is real / it's a false positive."
 *
 * Pair it with `@file:` references in the target: a chat-only verifier (e.g. a
 * codex CLI bound to a tool-less model) gets those files inlined automatically
 * (see file-refs / Identity.mode), so it can actually trace the flow; the
 * tool-capable auditor opens them itself.
 */
export function securityAuditPipeline(
  agents: { finder?: string; verifier?: string; verifierFallback?: string } = {},
): Stage[] {
  const finder = agents.finder ?? 'claude';
  const verifier = agents.verifier ?? 'codex';
  const verifierFallback = agents.verifierFallback ?? 'opencode';

  return [
    {
      name: 'find',
      primary: finder,
      buildPrompt: (task) =>
        [
          'You are a security auditor doing a FIRST-PASS code audit. Find real',
          'vulnerabilities — injection, auth/access-control gaps, path traversal,',
          'unsafe deserialization, secret exposure, SSRF, and the like — not style',
          'nits. For EACH finding, lay out the complete data-flow so a second',
          'reviewer can independently confirm or reject it:',
          '',
          '  #N — <short title>  [severity: critical|high|medium|low]',
          '  - Source:  where attacker-controlled / untrusted input enters (file:line).',
          '  - Sink:    the dangerous operation it reaches (file:line).',
          '  - Flow:    how the input travels source → sink, and why nothing',
          '             sanitizes, validates, or escapes it on the way.',
          '  - Trigger: a concrete example input/request that exploits it.',
          '  - Fix:     the specific change that closes it.',
          '',
          'Number findings, most severe first. Only report a vulnerability when you',
          'can trace the whole flow end to end; if you cannot, say so rather than',
          'guessing. If the code is clean, say so plainly.',
          '',
          '## Audit target',
          task,
        ].join('\n'),
    },
    {
      name: 'verify',
      primary: verifier,
      fallbacks: [verifierFallback],
      buildPrompt: (task, prior) => {
        const find = prior.find((r) => r.stage === 'find');
        return [
          'You are the VERIFIER. Another agent did a first-pass security audit',
          '(below). Your job is NOT to redo it — it is to validate each reported',
          'vulnerability by checking whether the ENTIRE flow actually exists and is',
          'exploitable:',
          '',
          '  - Is the source genuinely attacker-controlled and reachable in real use?',
          '  - Does the tainted data truly reach the sink WITHOUT being sanitized,',
          '    validated, or escaped somewhere on the path?',
          '  - Is it exploitable in practice, or blocked by something the audit missed?',
          '',
          'For each finding, give one line:',
          '  #N — CONFIRMED | FALSE POSITIVE | UNCERTAIN(need: <what>) — <one-sentence why>',
          '',
          'Then note anything the audit MISSED, in the same flow format. Do not',
          'rubber-stamp: a false positive caught is as valuable as a real bug found.',
          'End with a verdict line:',
          '  `VERDICT: <#confirmed / #false-positive / #uncertain — overall risk>`',
          '',
          '## Original audit target',
          task,
          '',
          `## First-pass audit to verify (by ${find?.agent ?? 'the auditor'})`,
          find?.text ?? '(no audit produced)',
        ].join('\n');
      },
    },
  ];
}

export function auditPipeline(
  agents: { auditor?: string; gatekeeper?: string; gatekeeperFallback?: string } = {},
): Stage[] {
  const auditor = agents.auditor ?? 'claude';
  const gatekeeper = agents.gatekeeper ?? 'codex';
  const gatekeeperFallback = agents.gatekeeperFallback ?? 'opencode';

  return [
    {
      name: 'audit',
      primary: auditor,
      buildPrompt: (task) =>
        [
          'You are performing a CODE AUDIT. Review the target below for bugs, security',
          'issues, and correctness problems. Be specific: cite locations and explain the',
          'risk. List findings as a numbered list, most severe first. If you find nothing',
          'serious, say so plainly.',
          '',
          `## Audit target`,
          task,
        ].join('\n'),
    },
    {
      name: 'gatekeep',
      primary: gatekeeper,
      fallbacks: [gatekeeperFallback],
      buildPrompt: (task, prior) => {
        const audit = prior.find((r) => r.stage === 'audit');
        return [
          'You are the GATEKEEPER reviewing another agent’s code audit. Your job is to',
          'check the audit itself: are the findings correct, are any overstated or wrong,',
          'and did it MISS anything important? Do not just agree. End with a verdict line:',
          '`VERDICT: pass` if the audit is sound, or `VERDICT: revise` with what to fix.',
          '',
          `## Original audit target`,
          task,
          '',
          `## The audit to review (by ${audit?.agent ?? 'the auditor'})`,
          audit?.text ?? '(no audit produced)',
        ].join('\n');
      },
    },
  ];
}
