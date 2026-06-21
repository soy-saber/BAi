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

Early development. Built in stages:

- [x] **Stage 0** — Repo scaffold + tooling
- [x] **Stage 1** — Single agent adapter (spawn Claude CLI, parse stream)
- [ ] **Stage 2** — Second agent (Codex/Gemini) behind one unified interface
- [ ] **Stage 3** — Threads + @mention routing
- [ ] **Stage 4** — Persistent identity + shared memory
- [ ] **Stage 5** — A2A messaging + cross-model review
- [ ] **Stage 6** — Minimal web UI

## Quick Start

```bash
# Prerequisites: Node.js 20+, and the `claude` CLI installed and logged in

npm install
npm run build
node dist/index.js "create a file called hello.txt containing: BAi works"
# or during development:
npm run dev -- "list the files in this directory"
```

Stage 1 drives a single agent: it spawns the `claude` CLI, streams its
`stream-json` output, and prints every text / tool-use / result message in
BAi's unified format. The agent actually performs the work (file edits, shell
commands) in the current directory.

## Architecture

_To be documented as it takes shape. Design decisions are recorded in
[`docs/decisions/`](docs/decisions/)._

## What I learned

_A running log of insights and pitfalls, updated as the project grows._

## License

[MIT](LICENSE)
