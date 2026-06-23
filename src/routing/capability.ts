/**
 * Capability routing.
 *
 * When a message names no agent (@mention), we still want it to reach the most
 * suitable one rather than nobody. Each agent advertises `strengths` (see
 * Identity); we score those against the task text with the same keyword
 * primitive used for memory recall, and suggest the best match.
 *
 * This is a *suggestion*, never an override: an explicit @mention always wins
 * (the orchestrator only consults this when there are zero mentions). Keeping
 * the matcher dumb-but-transparent — keyword overlap, no embeddings — mirrors
 * the recall design and is good enough until scale demands more.
 */

import type { Identity } from '../identity/identity.js';
import { escapeRegExp, tokenize } from '../text/tokenize.js';

export interface RouteCandidate {
  /** Agent id. */
  agent: string;
  /** Match score (count of distinct task terms hitting this agent's strengths). */
  score: number;
}

/**
 * Score every identity's strengths against the task and return them best-first.
 * Agents with a zero score are included (score 0) so callers can see the full
 * ranking; use `pickAgent` for the "just give me one" path.
 *
 * Scoring mirrors memory recall: tokenize the task (stopwords/1-char dropped),
 * tokenize each agent's strengths, and count distinct task terms that appear as
 * whole words in the strengths. Whole-word matching avoids "test" hitting
 * "latest".
 */
export function rankAgents(task: string, identities: Identity[]): RouteCandidate[] {
  const terms = [...new Set(tokenize(task))];

  const scored = identities.map((identity) => {
    const haystack = identity.strengths.join(' ').toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (new RegExp(`\\b${escapeRegExp(term)}\\b`).test(haystack)) score += 1;
    }
    return { agent: identity.agent, score };
  });

  // Best first; ties broken by agent id for a stable, predictable order.
  return scored.sort((a, b) => b.score - a.score || a.agent.localeCompare(b.agent));
}

/**
 * Pick the single best agent for a task, or undefined if nothing matches.
 *
 * Requires a real keyword hit (score >= 1): with no overlap we return undefined
 * rather than guessing, so the caller can fall back to a default or tell the
 * user to @mention someone explicitly. A tie returns the first by the stable
 * order above (not random), so the same task always routes the same way.
 */
export function pickAgent(task: string, identities: Identity[]): string | undefined {
  const ranked = rankAgents(task, identities);
  const top = ranked[0];
  return top && top.score > 0 ? top.agent : undefined;
}
