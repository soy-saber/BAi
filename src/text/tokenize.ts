/**
 * Shared text tokenization.
 *
 * One keyword-matching primitive, used by both memory recall (match a query
 * against stored memories) and capability routing (match a task against an
 * agent's strengths). Keeping it in one place means the two features can't
 * drift apart on what counts as a meaningful word.
 */

/** Words too common to carry meaning in keyword matching. */
export const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'for',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'with',
  'as',
  'we',
  'our',
  'you',
  'your',
  'i',
  'me',
  'my',
  'so',
  'if',
  'then',
  'than',
  'do',
  'does',
  'did',
  'can',
  'will',
  'would',
  'should',
  'use',
  'using',
  'used',
  'because',
]);

/** Lowercase, split on non-alphanumerics, drop stopwords and 1-char tokens. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length > 1 && !STOPWORDS.has(w),
  );
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
