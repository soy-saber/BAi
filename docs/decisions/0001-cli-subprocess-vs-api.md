# 0001 — Drive agents via CLI subprocess, not direct model API

- **Date:** 2026-06-21
- **Status:** accepted
- **Agent:** Claude

## Context

BAi needs multiple AI agents to actually *do work* — read/write files, run
commands, edit code — not just chat. There are two ways to invoke an agent:

1. **CLI subprocess** — spawn an existing agent CLI (`claude`, `codex`, ...) as
   a child process and parse its streaming output.
2. **Direct model API** — call the Anthropic/OpenAI SDK ourselves.

## Decision

Use the CLI subprocess approach.

## Why

An agent is more than a chat model: it runs an *agentic loop* (read → think →
edit → run → observe → repeat) with tool use, file ops, permissions, retries,
and context management. The existing CLIs have spent a long time polishing this.

- CLI subprocess: we inherit that whole loop for free. Our job is only to spawn,
  parse, normalize, and route.
- Direct API: we would have to rebuild the agentic loop ourselves — effectively
  reimplementing what `claude` already does well. For a "make agents do real
  work" goal, that puts the hard part in the wrong place.

The direct-API route would only win if the goal were pure *conversational*
orchestration (agents debating/reviewing text, no file/command access). That is
not our goal.

## Consequences / pitfalls

- We must handle process management, streaming output, and per-CLI output format
  differences (e.g. Claude `stream-json` NDJSON vs Codex `json`).
- We depend on each CLI's output format staying stable; format drift breaks the
  parser.
- Concrete starting point (from studying Clowder AI's `ClaudeAgentService`):
  `claude -p "<prompt>" --output-format stream-json --verbose`, then parse the
  NDJSON stream line by line into our unified message type.
