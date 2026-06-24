# 0017 — UI polish + @mention autocomplete

Status: accepted
Stage: S16
Agent: Claude

## Context

The web UI worked but was bare: a flat dark page, a single-line `<input>`, and
no help discovering which agents exist or how to address them. You had to know
the exact agent ids and type `@claude` by hand. Two asks:

1. Make mentioning an agent easy — autocomplete the name instead of typing the
   full id.
2. Polish the look and the ergonomics, taking cues from opencode and Cat Cafe
   (a real composer, keyboard-first, a visible roster of who you can talk to).

## Decision

### `/api/agents` endpoint

A new `GET /api/agents` returns `{ id, name, role, strengths }` for every agent
that has a live adapter, sourced from the same `IDENTITIES` the orchestrator
uses. The UI fetches it once on load to drive both the autocomplete and the
sidebar legend. No identity data is duplicated client-side; it comes from the
one source of truth.

### @mention autocomplete

Pure client-side, no dependency:

- A caret-aware matcher finds an active `@token` immediately before the cursor
  (`(?:^|\s)@([\w-]*)$`), so `@` only triggers at a word start, not inside an
  email or mid-word.
- Matches are agents whose id `startsWith` the partial. A floating popup lists
  each with its avatar, `@id`, display name, and role.
- Keyboard-first: ↑/↓ move, Enter/Tab pick, Esc dismisses. Mouse picks use
  `mousedown` (with `preventDefault`) so the textarea doesn't blur and swallow
  the click before the pick registers.
- Picking replaces just the in-progress token and appends a space, leaving the
  rest of the line intact.

### Composer ergonomics

- `<input>` became an auto-growing `<textarea>` (1 line up to ~180px).
- **Enter sends, Shift+Enter inserts a newline** — the convention from chat
  apps and opencode. The form's `requestSubmit()` keeps the existing submit path
  (and the Stop button) untouched.

### Visual pass

Reused the existing CSS-variable theme, added a couple of tokens (`--panel-2`,
`--accent-soft`, `--radius`), and restyled: branded sidebar header, a topbar
showing the active thread, rounded message bubbles with agent-initial avatars,
a sidebar agent legend, and a keyboard-hint line under the composer. All
dependency-free, still one static HTML file plus one JS file.

## Why client-side and dependency-free

The whole UI is deliberately a thin, buildless shell over the same Orchestrator
the CLI uses (see ADR 0007). Pulling in a framework or a combobox library for
one autocomplete would break that and add a build step. The matcher is ~15
lines and the popup is plain DOM; that's the right size for the problem.

## Why `startsWith` (not fuzzy) matching

Same philosophy as recall and capability routing: dumb-but-predictable first.
Agent ids are short and few; prefix matching is unambiguous and never surprises.
Fuzzy matching is a later nicety if the roster ever grows large.

## Consequences / pitfalls

- The blur-vs-mousedown race is the classic autocomplete footgun; handled with
  `mousedown` + a short blur delay. Worth remembering if the markup changes.
- `noDescendingSpecificity` fires a false positive on two unrelated `.avatar`
  rules that only share a trailing class; suppressed inline with a note rather
  than renaming the shared class everywhere.
- Autocomplete is presentation only — routing still parses `@mentions` from the
  final text server-side, so anything typed by hand works identically. The UI
  can't desync from what the orchestrator actually honors.

## Verification

- `npm run build` + full suite: 80 tests pass (UI is exercised manually; the
  server endpoint reuses tested stores/identities).
- `biome check` clean.
- Manual: typing `@` opens the popup; arrows/Tab/Enter pick; Enter sends;
  Shift+Enter adds a newline; the legend lists each agent and role.
