# BAi

> A multi-agent collaboration platform — make different AI agents work together as a team.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

## What is this?

BAi turns isolated AI agent CLIs (Claude Code, Codex, Gemini, ...) into a team
that works together — instead of you copy-pasting context between chat windows.

It is the layer *above* each agent CLI: it spawns them as subprocesses, parses
their streaming output into one unified message format, routes tasks to the
right agent, and lets agents talk to each other (e.g. Claude writes code, Codex
reviews it).

## Why build it?

This is a learning project. The goal is to deeply understand how multi-agent
orchestration actually works under the hood — process management, stream
parsing, message routing, persistent identity, and agent-to-agent communication
— by building a minimal but real version from scratch.

Inspired by [Clowder AI](https://github.com/zts212653/clowder-ai) (MIT). BAi is
an independent, from-scratch implementation; it does not reuse Clowder's brand,
logos, or character designs.

## Status

A working end-to-end multi-agent platform, built in stages (each is one commit
with its own decision record in [`docs/decisions/`](docs/decisions/)):

- [x] **Stage 0** — Repo scaffold + tooling
- [x] **Stage 1** — Single agent adapter (spawn Claude CLI, parse stream)
- [x] **Stage 2** — Second agent (Codex/Gemini) behind one unified interface
- [x] **Stage 3** — Threads + @mention routing
- [x] **Stage 4** — Persistent identity + shared memory
- [x] **Stage 5** — A2A messaging + cross-model review
- [x] **Stage 6** — Minimal web UI
- [x] **Stage 7** — Third adapter (opencode) + live streaming status in the UI
- [x] **Stage 8** — Progressive (typing) rendering in the UI
- [x] **Stage 9** — Per-turn timeout + cancellation (Stop button)
- [x] **Stage 10** — Transient-failure retry with backoff
- [x] **Stage 11** — Automatic memory sedimentation (decisions/lessons)
- [x] **Stage 12** — Smarter recall + team retrospective (distilled insights)
- [x] **Stage 13** — Fourth adapter (Gemini) behind the same `CliSpec`
- [x] **Stage 14** — Capability routing (pick the best agent when none is @mentioned)
- [x] **Stage 15** — Audit pipeline (claude audits → reviewer gates → fallback chain)
- [x] **Stage 16** — UI polish + @mention autocomplete
- [x] **Stage 17** — A practice build: a deterministic-referee game with agent players
- [x] **Stage 18** — Chat-mode degradation: `@file:` context feeding for tool-less models
- [x] **Stage 19** — Security audit: one agent finds vulnerability flows, another verifies each
- [x] **Stage 20** — codex model override (`BAI_CODEX_MODEL`) + runtime no-tools capability hint
- [x] **Stage 21** — read-only git inspector: see what the agents changed, with per-file diffs in the UI
- [x] **Stage 22** — git writes from the UI: stage/unstage files and commit, gated behind explicit clicks
- [x] **Stage 23** — diff-review pipeline: a reviewer judges the working-tree diff, a gatekeeper says ship/hold

## Quick Start

```bash
# Prerequisites: Node.js 20+, and the `claude` and/or `codex` CLI installed and logged in

npm install
npm run build

# Threaded, @mention-routed collaboration:
node dist/index.js new "auth refactor"          # -> created thread a1b2c3d4
node dist/index.js send a1b2c3d4 "@claude design the API, then @codex review it"
node dist/index.js show a1b2c3d4                # print the transcript
node dist/index.js threads                      # list threads

# Feed files to a chat-only model (no file tools of its own) with @file:. BAi
# reads the file and inlines it; the model reasons over it and proposes edits,
# BAi (or a tool-capable agent) applies them. Mark such agents chat-only with
# BAI_CHAT_AGENTS, e.g. when your `codex` CLI is bound to a chat-only model:
#   BAI_CHAT_AGENTS=codex node dist/index.js serve
node dist/index.js send a1b2c3d4 "@codex review @file:src/server/app.js for bugs"

# Point the `codex` CLI at a different model without editing ~/.codex/config.toml.
# BAI_CODEX_MODEL injects `codex exec -m <model>` (reusing the configured
# provider). codex auto-degrades to chat mode for a known tool-less model and
# stays a tool-capable agent otherwise; if it then runs a turn calling no tools,
# BAi warns you to downgrade it with BAI_CHAT_AGENTS=codex.
#   BAI_CODEX_MODEL=gpt-5.5 node dist/index.js serve

# Audit pipeline — claude audits, a reviewer gatekeeps, with a fallback chain
# (claude → codex, falling back to opencode if codex can't be reached):
node dist/index.js audit a1b2c3d4 "src/server/server.ts"

# Security audit — claude finds vulnerability flows (source → sink), then codex
# verifies each flow actually exists & is exploitable (opencode if codex is down).
# Feed the code with @file: so a tool-less verifier still sees it:
node dist/index.js secaudit a1b2c3d4 "@file:src/server/server.ts"

# Diff review — review the working-tree change: a reviewer judges the diff
# (correctness/regressions/security), a gatekeeper says ship/hold. Pass a file
# to scope it, or omit for the whole tree. Reads `git diff` and feeds it inline:
node dist/index.js review a1b2c3d4 src/git.ts

# Practice game — two agents play tic-tac-toe; the referee is deterministic code:
node dist/index.js play claude codex

npm test     # routing/store/identity/A2A unit tests (fake adapters, no live CLI)

# Or use the web UI:
node dist/index.js serve     # http://localhost:3003
#   The sidebar shows a Git panel — the files the agents changed this session;
#   click one for a colored diff, +/− to stage/unstage, then commit the index.
#   "👁 Review changes" runs the diff-review pipeline over the working tree.
#   (GET /api/git/status, GET /api/git/diff?file=; POST /api/git/{stage,unstage,
#   commit} and /api/threads/:id/review. Writes act only on paths git already
#   reports; no push/reset/-a.)
```

> The web UI binds to localhost and has **no authentication**; it can spawn
> agents that edit files and run commands in the working directory. Keep it
> local.

The web UI streams live status while agents work — which agent is running, its
tool calls, and whether it succeeded or failed to connect — instead of waiting
for the whole turn to finish.

## Supported agents

Each agent is one `CliSpec` over a shared spawn/parse runner; adding another is
just another spec.

| Agent | CLI | Notes |
|-------|-----|-------|
| Claude | `claude` | `--permission-mode` / bypass mapping |
| Codex | `codex` | `--sandbox` mode mapping |
| opencode | `opencode` | set `OPENCODE_MODEL`, e.g. `opencode-go/deepseek-v4-flash` |

Provider API keys and `OPENCODE_MODEL` are read from the environment and never
written to disk. Mention an agent by name: `@claude`, `@codex`, `@opencode`.

A message addresses agents with `@mentions`; mentions run in the order written,
so "design then review" flows work. Each thread is an isolated context, stored
as a plain JSON file under `data/threads/`. Every agent runs behind one
`AgentAdapter` interface and actually performs the work in the current
directory.

## Architecture

_To be documented as it takes shape. Design decisions are recorded in
[`docs/decisions/`](docs/decisions/)._

## What I learned

_A running log of insights and pitfalls, updated as the project grows._

## License

[MIT](LICENSE)
