# 0002 — Pitfalls building the Claude stream-json adapter

- **Date:** 2026-06-21
- **Status:** accepted

## Context

Stage 1 spawns the `claude` CLI and parses its `--output-format stream-json`
output into our unified `AgentMessage` type. Getting a real turn to *do work*
(not just chat) surfaced four pitfalls worth recording.

## What the stream actually looks like

One JSON object per stdout line (NDJSON). The types we handle:

- `system` (`subtype: "init"`, `"api_retry"`, ...) — diagnostics, no user payload.
- `assistant` — `message.content[]` holds blocks: `text` blocks become text
  messages, `tool_use` blocks (with `name` + `input`) become tool-use messages.
- `result` — terminal event; `is_error` + `result` (final summary text).

We parse line-by-line with readline, `JSON.parse` each line, and skip any line
that fails to parse rather than crashing the whole turn.

## Pitfalls

1. **Permission mode blocks real work.** With the default permission mode the
   CLI waits for interactive approval, so in a non-interactive subprocess it
   *reports* a tool_use but never actually writes the file. Fix: expose a
   `permission` option and default to `bypass`
   (`--dangerously-skip-permissions`) so an unattended turn can fully act.
   Trade-off: bypass is only safe inside a trusted working directory — this is
   exactly the kind of thing the "Iron Laws" guardrails will later constrain.

2. **Windows can't spawn `.cmd` directly.** `claude` on Windows is a `.cmd`
   shim, and Node 20+ refuses to spawn `.cmd` without a shell (`spawn EINVAL`).
   Fix: set `shell: true` only on Windows.

3. **`shell: true` + argv is a security smell (DEP0190).** Passing args with a
   shell concatenates them unescaped. It's safe *here* only because every argv
   entry is a hard-coded constant flag and the untrusted input (the prompt) is
   passed on **stdin**, never on the command line. Keep it that way.

4. **Rate-limit retries appear inline.** A live run emitted a `system` /
   `api_retry` event (HTTP 429) mid-stream. Because we ignore unknown `system`
   events, retries are handled transparently — but it's a reminder that the
   stream can stall and a turn can take much longer than the model's think time.

## Consequences

- The adapter always yields a terminal `result` message, even if the CLI dies
  without one (synthesized from the exit code + stderr), so callers can rely on
  a turn always ending.
- Prompt-on-stdin also sidesteps the Windows 32K command-line limit for free.
