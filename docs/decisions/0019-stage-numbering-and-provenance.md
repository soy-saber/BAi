# 0019 — Stage numbering and report provenance

- **Date:** 2026-06-25
- **Status:** accepted
- **Stage:** maintenance
- **Agent:** GPT

## Context

The roadmap, commit history, and ADR metadata had drifted around the Gemini and
capability-routing stages. README and the Git history treated Gemini as Stage
13 and capability routing as Stage 14, while the Gemini ADR still described
Gemini as `S12.5` and referred to capability routing as `S13`.

At the same time, the project now expects multiple agents to contribute across
time. The existing decision records were Claude-authored, but the docs did not
make that provenance explicit.

## Decision

Use the README roadmap as the canonical stage sequence:

- Stage 13 is the Gemini adapter.
- Stage 14 is capability routing.
- Stages 15 through 17 keep their existing audit, UI, and tic-tac-toe meanings.

The Gemini ADR was updated from `S12.5` to `S13`, and its forward reference to
capability routing was updated from `S13` to `S14`.

All existing decision records `0001` through `0018` are now marked with
`Agent: Claude`. This maintenance record is marked `Agent: GPT`; future records
should do the same so GPT, Claude, Codex, or other contributors are easy to
separate in the project history.

## Consequences / pitfalls

ADR numbers and stage numbers are related but not identical. ADR `0019` is a
maintenance record, not a new product stage. The stage roadmap remains at S17
until the next actual feature stage is added.
