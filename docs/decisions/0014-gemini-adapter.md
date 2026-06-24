# 0014 — Gemini adapter

Status: accepted
Stage: S13
Agent: Claude

## Context

BAi had three adapters (claude, codex, opencode). Adding Google's `gemini`
CLI was the next concrete test of the adapter abstraction: if the abstraction
is right, a new agent should cost one `CliSpec` and nothing else. Gemini also
brings a different strength profile (long-context analysis, multimodal) to the
team, which the capability-routing stage that follows will lean on.

## Decision

`src/adapters/gemini.ts` — one `CliSpec`, modeled on `opencode.ts`:

- **Invocation:** `gemini -o stream-json --skip-trust [--yolo]`, prompt on
  stdin (same as the others — no `-p` needed).
  - `-o stream-json` emits one JSON event per line (NDJSON), so `runCli`'s
    existing line parser handles it unchanged.
  - `--skip-trust` is mandatory: without it the CLI silently downgrades out of
    YOLO whenever the cwd is an "untrusted" folder, disabling autonomous file
    ops even with `--yolo` present.
  - `--yolo` is the `bypass`/`acceptEdits` mapping (auto-approve every tool
    call); `default` omits it so the CLI prompts (blocks unattended, by design).
- **Event mapping** (events differ from the other CLIs):
  - `{type:"init", model, session_id}` → diagnostic, dropped.
  - `{type:"message", role:"user", content}` → the CLI's echo of our own
    prompt, dropped.
  - `{type:"message", role:"assistant"|"model", content}` → text message.
  - `{type:"result", status:"success"|"error", error?}` → terminal result;
    `ok = status === "success"`, error message surfaced otherwise.
- **No tool_use events:** Gemini's stream-json folds tool activity into
  messages rather than emitting a distinct tool event, so this adapter emits
  text + result only. (If a future CLI version adds one, it slots in here.)
- Credentials are the CLI's own concern: it reads `~/.gemini/.env`
  (`GEMINI_API_KEY`, `GEMINI_MODEL`, `GOOGLE_GEMINI_BASE_URL`) on its own. BAi
  never reads or stores the key.

Registered in `buildRegistry()` alongside the others, wrapped with retry like
everything else. `geminiSpec` is exported so tests can drive `mapEvent` /
`buildArgs` directly.

## Why this shape

The whole bet of the adapter layer (ADR 0003) is "new agent = one CliSpec".
Gemini's event names are different from claude/codex/opencode, but everything
above `mapEvent` — spawn, stdin feed, NDJSON parse, timeout, cancel, retry,
terminal-result guarantee — was reused untouched. That is the abstraction
paying off.

## Pitfall: the proxy can't actually serve Gemini over the Anthropic format

The user's key routes through a proxy (cc-switch / anyrouter). While wiring
this up we checked whether the same proxy could let local **Claude Code** drive
a Gemini model: it can't. The proxy lists `gemini-2.5-pro` on its OpenAI-format
model list, but its Anthropic `/v1/messages` endpoint returns
`404 当前 API 不支持所选模型 gemini-2.5-pro`. Claude Code only speaks the
Anthropic format, so that path is dead. Separately, the Gemini CLI's own key
currently returns `403 Forbidden` (nginx) — a known instability on the user's
side, pre-authorized to skip.

Net: the adapter is complete and unit-tested, but **not yet verified against a
live Gemini API**. It goes in now and gets a real-machine run when a working
key is available.

## Verification

- Unit: `test/gemini.test.ts` — `buildArgs` (stream-json + skip-trust always;
  `--yolo` only for autonomous permissions), and `mapEvent` (init dropped,
  user echo dropped, assistant/model → text, empty text dropped, success →
  ok=true, error → ok=false with message, error-with-no-detail fallback).
  10 cases. Full suite 62 pass.
- Real machine: **deferred** — proxy 404s Gemini over the Anthropic format and
  the CLI key 403s. To run when a working key lands.

## Consequences

- Adding agent #4 cost exactly one file plus one registry line, confirming the
  abstraction holds at n=4.
- There is now an adapter in the tree whose live path is unverified. The ADR
  records this honestly rather than pretending green unit tests mean a working
  integration.
- Gemini's declared strengths (long-context analysis, multimodal) feed the
  capability-routing stage (S14) that follows.
