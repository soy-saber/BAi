/**
 * Agent-to-agent (A2A) messaging.
 *
 * When an agent's reply @mentions another agent, that is a handoff: the next
 * agent should run with the previous agent's output as context. This is what
 * turns "route to one agent" into a team — e.g. claude finishes and writes
 * "@codex please review", and codex runs automatically on what claude produced.
 *
 * We model a handoff as a queued follow-up turn. The orchestrator drains the
 * queue, bounded by a hop limit so two agents can't @-loop forever.
 */

import { parseMentions } from './mentions.js';

export interface Handoff {
  /** Agent being handed to. */
  to: string;
  /** Agent that initiated the handoff. */
  from: string;
  /** The originating agent's output, used as context for `to`. */
  context: string;
  /** How many handoffs deep we are (0 = the original human turn). */
  hop: number;
}

/**
 * Find handoffs in an agent's output: known @mentions other than the author.
 * Returns one Handoff per distinct mentioned agent.
 */
export function detectHandoffs(
  from: string,
  output: string,
  known: Iterable<string>,
  hop: number,
): Handoff[] {
  const { agents } = parseMentions(output, known);
  return agents
    .filter((to) => to !== from)
    .map((to) => ({ to, from, context: output, hop: hop + 1 }));
}

/** Build the prompt for a handoff target from the initiating agent's output. */
export function handoffPrompt(handoff: Handoff, originalMessage: string): string {
  return [
    `## Handoff from @${handoff.from}`,
    `The original request was:\n${originalMessage}`,
    '',
    `@${handoff.from} produced the following and handed off to you:`,
    handoff.context,
    '',
    'Act on this handoff. If you are reviewing, be specific about what to change.',
  ].join('\n');
}
