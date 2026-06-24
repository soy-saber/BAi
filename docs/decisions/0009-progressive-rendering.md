# 0009 — Progressive (typing) rendering in the web UI

## Status

Accepted.

## Agent

Claude.

## Context

After Stage 7 the UI streamed *lifecycle* events but still rendered an agent's
reply only once, on `agent_end`. So a long reply appeared as one sudden block
after a wait, unlike the CLI where text scrolls as it is produced.

## Decision

Render text **as it arrives**. On the first `message` event whose payload is a
`text` chunk for an agent, the UI removes that agent's "working…" status line and
opens a *live bubble*; each subsequent text chunk is appended to it. On
`agent_end` the bubble is finalized in place (or, if no text streamed — e.g. a
failure before any output — the final text is shown instead).

Implementation notes:

- Appended chunks are written with `textContent`, never `innerHTML`, so streamed
  agent output can never inject markup.
- A blinking caret (`.entry.live pre::after`) marks a bubble that is still
  streaming; it is removed on finalize.
- Per-agent live bubbles are tracked in `state.liveByAgent`, so concurrent or
  handed-off agents each grow their own bubble.

## Granularity is CLI-bound, and that's fine

Chunk size depends on the underlying CLI's stream. Claude's `stream-json` emits
many text blocks → smooth typing. opencode emits one text event per turn → the
reply appears in one append. The UI logic is identical either way; we render
whatever granularity the adapter yields rather than faking token-by-token
output. If finer streaming is wanted later, it belongs in the adapter (e.g.
Claude partial-message events), not the UI.

## Consequences

- The web UI now mirrors the CLI's "watch it think" feel for streaming CLIs.
- No protocol change: the same `DispatchEvent` stream drives CLI and UI.
- `textContent` appation keeps the XSS-safety property from ADR 0007.
