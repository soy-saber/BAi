# 0007 — Minimal web UI: a thin shell, not a second brain

- **Date:** 2026-06-21
- **Status:** accepted

## Context

Stage 6 is the face of the project — the most "screenshot-able" part — but it's
intentionally the *last* and *thinnest* layer. Everything real (adapters,
routing, identity, memory, A2A) was built and tested via the CLI first. The UI
only needs to expose what already works.

## Decision

A dependency-free server + single-page app:

- **Server** (`src/server/server.ts`): Node's built-in `http` only. A tiny JSON
  API (`/api/threads`, `/api/threads/:id`, `.../send`) over the *same*
  `Orchestrator` and stores the CLI uses. No framework.
- **UI** (`src/server/index.html` + `app.js`): vanilla JS, no build step. A
  thread list, a transcript view, and a composer where `@mentions` route to
  agents — the web mirror of `bai send`.
- **Build**: `tsc` then a small `copy-assets.mjs` to copy the HTML/JS into
  `dist/server` (tsc only emits JS).

Why no framework (React/Fastify/etc.): the UI carries no business logic, so a
framework would be pure overhead and a heavier dependency surface to learn from.
For a learning project, "vanilla over the same core" makes the layering obvious.

## Security

The server binds to `127.0.0.1`, has **no authentication**, and can spawn agent
CLIs that edit files and run commands in the working directory. This is stated
in the server file's header and must stay localhost-only. Any future remote
exposure needs auth + a sandbox boundary first — flagged, not silently shipped.

## Consequences / pitfalls

- `send` is request/response: the page waits for the whole turn (including any
  A2A handoffs) before updating. Fine for a minimal UI; live streaming over
  WebSocket/SSE is the obvious next iteration (the adapters already stream).
- All output is HTML-escaped on render (`escapeHtml`) — agent output is
  untrusted text and must never be injected as markup.
- The optimistic user-message render is replaced by the server's authoritative
  transcript once the turn completes, so the two can't drift.
