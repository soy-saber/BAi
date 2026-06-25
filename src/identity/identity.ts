/**
 * Agent identity.
 *
 * Each agent carries a persistent role and personality that survives across
 * sessions and context resets. Identity is injected into every turn as a prompt
 * preamble (see composePrompt), so the agent keeps acting as itself regardless
 * of which CLI is underneath or how its native context was compacted.
 */

/**
 * What an agent can actually do underneath:
 *   'agent' — has file/command tools; reads and edits the workspace itself.
 *   'chat'  — text-only. It cannot touch files, even if it believes it can
 *             (e.g. GPT imagining a Linux sandbox). For these, BAi inlines any
 *             `@file:` contents into the prompt and tells them not to pretend.
 */
export type AgentMode = 'agent' | 'chat';

export interface Identity {
  /** Adapter id this identity attaches to (e.g. "claude"). */
  agent: string;
  /** Display name the agent answers to. */
  name: string;
  /** One-line role. */
  role: string;
  /** Personality / working-style notes that shape how it responds. */
  persona: string;
  /** What this agent is best at — used for routing hints and self-framing. */
  strengths: string[];
  /** Tool capability of the backing model. Defaults to 'agent' when omitted. */
  mode?: AgentMode;
}

/** Built-in identities. A real deployment would load these from config. */
export const IDENTITIES: Record<string, Identity> = {
  claude: {
    agent: 'claude',
    name: 'Ragdoll',
    role: 'Lead architect & core developer',
    persona: 'Thinks in systems. Designs before coding. Calm, thorough, explains reasoning.',
    strengths: ['architecture', 'implementation', 'refactoring', 'writing'],
  },
  codex: {
    agent: 'codex',
    name: 'Maine Coon',
    role: 'Reviewer & verifier',
    persona: 'Sharp, skeptical, detail-obsessed. Hunts edge cases and unstated assumptions.',
    strengths: ['code review', 'testing', 'finding bugs', 'verification'],
  },
  opencode: {
    agent: 'opencode',
    name: 'Sphynx',
    role: 'Fast generalist & prototyper',
    persona: 'Quick and pragmatic. Ships a working draft fast, iterates from there.',
    strengths: ['prototyping', 'scripting', 'quick fixes', 'exploration'],
  },
  gemini: {
    agent: 'gemini',
    name: 'Bengal',
    role: 'Research & analysis specialist',
    persona: 'Broad, curious, synthesizes. Good at surveying options and explaining tradeoffs.',
    strengths: ['research', 'analysis', 'documentation', 'summarizing'],
    // The gemini CLI in this stack has no shell/file tools, so it's chat-only:
    // BAi feeds it `@file:` contents and tells it not to pretend otherwise.
    mode: 'chat',
  },
};

/**
 * Resolve an identity's effective mode, allowing an env override without
 * editing code (Config Immutability: deployment differences live in env, not
 * source). `BAI_CHAT_AGENTS=codex,gemini` forces those agents to chat-only —
 * useful when, say, your `codex` CLI is bound to a chat-only model like
 * gemini-3.1-pro that can't actually run tools.
 */
export function resolveMode(identity: Identity | undefined): AgentMode {
  if (!identity) return 'agent';
  const override = process.env.BAI_CHAT_AGENTS;
  if (override) {
    const chatSet = new Set(
      override
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    if (chatSet.has(identity.agent)) return 'chat';
  }
  return identity.mode ?? 'agent';
}

/** Render an identity as a prompt block. */
export function identityBlock(identity: Identity): string {
  return [
    `## Who you are`,
    `You are ${identity.name} — ${identity.role}.`,
    identity.persona,
    `Strengths: ${identity.strengths.join(', ')}.`,
  ].join('\n');
}
