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
import { type AgentMode, type Identity, identityBlock } from './identity.js';
import { ironLawsBlock } from './iron-laws.js';

/** Tells agents how to tag takeaways so they get saved to shared memory. */
const MEMORY_HINT =
  '## Recording memory\nIf this turn produces a durable takeaway, end a line with ' +
  '`DECISION: <choice + why>` or `LESSON: <what you learned>`. These are saved to ' +
  'the team memory and surfaced in future turns. Only tag things worth keeping.';

/**
 * Levels a chat-only model with what it actually can't do, so it stops
 * pretending. GPT in particular will narrate running shell commands in an
 * imagined sandbox; this names that directly. Pairs with the file-context
 * block, which is the only way such a model sees the workspace.
 */
const CHAT_MODE_NOTE =
  '## Your tools (read this carefully)\nYou have NO ability to read files, write ' +
  'files, or run commands in this environment — none, regardless of what you may ' +
  'normally assume. Do not claim to have run anything, opened a sandbox, or edited ' +
  'a file; that output would be fiction. The only files you can see are the ones ' +
  'quoted under "Referenced files" below. To change a file, describe the precise ' +
  'old → new edit and a tool-capable teammate or human will apply it.';

export interface ComposeOptions {
  /** Backing model capability; 'chat' adds the no-tools note. Default 'agent'. */
  mode?: AgentMode;
  /** Pre-rendered `@file:` contents block to inline (see loadFileContext). */
  fileContext?: string;
}

export function composePrompt(
  identity: Identity | undefined,
  memories: Memory[],
  message: string,
  options: ComposeOptions = {},
): string {
  const blocks: string[] = [];
  if (identity) blocks.push(identityBlock(identity));
  blocks.push(ironLawsBlock());
  if (options.mode === 'chat') blocks.push(CHAT_MODE_NOTE);
  const mem = memoryBlock(memories);
  if (mem) blocks.push(mem);
  if (options.fileContext) blocks.push(options.fileContext);
  blocks.push(MEMORY_HINT);
  blocks.push(`## Message\n${message}`);
  return blocks.join('\n\n');
}
