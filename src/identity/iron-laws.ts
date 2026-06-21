/**
 * The Iron Laws — non-negotiable constraints, injected into every agent turn.
 *
 * These are the "hard rails": the legal floor an agent must never cross,
 * regardless of the task. They are phrased as agreements the team keeps, not
 * just restrictions imposed from outside.
 */

export const IRON_LAWS = [
  'Data Storage Sanctuary — never delete or flush a persistent store (the memory/, data/ directories, databases). That is memory, not garbage.',
  'Process Self-Preservation — never kill your parent process or break your own startup config.',
  'Config Immutability — treat runtime config (.env, config files) as read-only; changing it requires a human.',
  'Network Boundary — never touch ports or services that are not yours.',
] as const;

/** Render the laws as a prompt block. */
export function ironLawsBlock(): string {
  const lines = IRON_LAWS.map((law, i) => `  ${i + 1}. ${law}`).join('\n');
  return `## Iron Laws (always apply)\n${lines}`;
}
