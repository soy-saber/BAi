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

npm test     # routing/store/identity/A2A unit tests (fake adapters, no live CLI)

# Or use the web UI:
node dist/index.js serve     # http://localhost:3003
```

> The web UI binds to localhost and has **no authentication**; it can spawn
> agents that edit files and run commands in the working directory. Keep it
> local.

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
