# 0032 — Tests for the shared tokenize primitive

Status: accepted
Stage: S30
Agent: Claude

## Context

`src/text/tokenize.ts` is a small module with an outsized role: its `tokenize`
function is the one keyword primitive shared by two features that must agree —
memory recall (match a query against stored memories) and capability routing
(match a task against an agent's strengths). Its own header says the reason it
lives in one place is so "the two features can't drift apart on what counts as a
meaningful word."

Yet the primitive itself had no direct test. Both callers were tested
(`capability.test.ts`, `memory-store.test.ts`), but only through their own
behavior — nothing pinned `tokenize`'s contract directly. A change to the
stopword list, the 1-char filter, or the split regex could shift both features
at once, and the failure would show up (if at all) as a subtle ranking change in
two places rather than one obvious broken assertion. `escapeRegExp`, used by both
callers to build literal-match patterns from user input, was likewise untested.

## Decision

Add `test/tokenize.test.ts` pinning the primitive's exact contract:

- **`tokenize`**: lowercasing and non-alphanumeric splitting; stopword and
  1-char-token dropping; multi-digit numbers kept but single digits dropped;
  empty / all-stopword / all-punctuation input yielding `[]`; and — explicitly —
  that it does *not* dedupe (callers wrap in a `Set` themselves; the primitive
  stays faithful to the input).
- **`STOPWORDS`**: a spot check that common words are members and a real term
  (`architecture`) is not.
- **`escapeRegExp`**: that the escaped form matches its source string literally
  (metacharacters neutralized) and leaves plain alphanumerics untouched.

The tests assert on exact arrays (`deepEqual`), so any drift in what counts as a
meaningful word breaks a named test rather than nudging a downstream ranking.

## Consequences

- The shared keyword contract is now nailed down in one place. A change to
  stopwords or the split rule must be a deliberate edit to a failing test, not a
  silent shift rippling through both recall and routing.
- The "does not dedupe" test documents the division of labor: the primitive is
  faithful, the callers dedupe. That boundary is now enforced, not just
  convention.
- `escapeRegExp` — the guard that keeps a user's query or a strength string with
  a `.` or `*` in it from being read as a pattern — is covered, so the
  literal-match assumption both callers rely on can't regress unnoticed.
- Coverage of the two consumers stays where it was; this adds the missing
  bottom-of-the-stack test the two of them were implicitly depending on.
