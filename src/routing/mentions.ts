/**
 * @mention parsing.
 *
 * A message addresses one or more agents with `@name` tokens, e.g.
 *   "@claude design the API, then @codex review it"
 * routes to both claude and codex. Unknown mentions are ignored so a stray
 * email address or "@everyone" doesn't spawn a phantom agent.
 */

/** Match @name where name is alphanumeric/_/- and not preceded by a word char. */
const MENTION_RE = /(?<![\w@])@([a-zA-Z][\w-]*)/g;

export interface ParsedMention {
  /** Distinct agent names mentioned, in first-seen order, lowercased. */
  agents: string[];
  /** Original text, unchanged (agents still see their @mentions). */
  text: string;
}

/**
 * Extract @mentions from a message, keeping only those in `known`.
 * Order is first-seen; duplicates collapse.
 */
export function parseMentions(text: string, known: Iterable<string>): ParsedMention {
  const knownSet = new Set([...known].map((n) => n.toLowerCase()));
  const seen = new Set<string>();
  const agents: string[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const name = (match[1] ?? '').toLowerCase();
    if (knownSet.has(name) && !seen.has(name)) {
      seen.add(name);
      agents.push(name);
    }
  }
  return { agents, text };
}
