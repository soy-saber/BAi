/**
 * Prompt composition.
 *
 * Every turn the agent receives a preamble that re-establishes who it is, the
 * constraints it operates under, and any relevant team memory — followed by the
 * actual message. This is how identity and knowledge survive across sessions
 * and context compaction: they are re-injected every turn, not assumed to
 * persist inside the model.
 */

import { type Memory, memoryBlock } from '../store/memory-store.js';
import { type Identity, identityBlock } from './identity.js';
import { ironLawsBlock } from './iron-laws.js';

/** Tells agents how to tag takeaways so they get saved to shared memory. */
const MEMORY_HINT =
  '## Recording memory\nIf this turn produces a durable takeaway, end a line with ' +
  '`DECISION: <choice + why>` or `LESSON: <what you learned>`. These are saved to ' +
  'the team memory and surfaced in future turns. Only tag things worth keeping.';

export function composePrompt(
  identity: Identity | undefined,
  memories: Memory[],
  message: string,
): string {
  const blocks: string[] = [];
  if (identity) blocks.push(identityBlock(identity));
  blocks.push(ironLawsBlock());
  const mem = memoryBlock(memories);
  if (mem) blocks.push(mem);
  blocks.push(MEMORY_HINT);
  blocks.push(`## Message\n${message}`);
  return blocks.join('\n\n');
}
