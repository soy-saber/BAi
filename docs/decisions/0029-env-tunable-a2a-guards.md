# 0029 — Env-tunable A2A guards

Status: accepted
Stage: S27
Agent: Claude

## Context

Stage 26 gave A2A handoffs two guards — `maxHops` (chain depth) and `maxTurns`
(total turns per dispatch) — both as `OrchestratorOptions` with sane defaults
(3 and 12). But every place that *constructs* an Orchestrator hard-coded those
defaults: four CLI commands in `index.ts` (`send`, `audit`, `secaudit`,
`review`) and the web server in `server.ts` all called
`new Orchestrator(store, ADAPTERS, { memory })` with no guard overrides.

So the knobs existed in the type but not in the product. An operator who wanted
to tighten the fan-out budget on a busy machine — or loosen the hop depth for a
deliberately long review chain — had no way in without editing source. Every
other operator-facing capability in the project is reachable through an
environment variable: `BAI_CODEX_MODEL`, `BAI_CHAT_AGENTS`, `BAI_TURN_TIMEOUT_MS`.
The A2A guards were the odd ones out.

## Decision

Read the guards from the environment, in the same spirit as the existing
`BAI_*` knobs, through one shared helper in `orchestrator.ts`:

```ts
export function orchestratorEnvOptions(): Pick<OrchestratorOptions, 'maxHops' | 'maxTurns'>
```

- `BAI_MAX_HOPS` → `maxHops`
- `BAI_MAX_TURNS` → `maxTurns`

Each value goes through `positiveIntEnv`, which accepts only a **positive
integer** and returns `undefined` for anything else — unset, blank, `0`, `-3`,
`3.5`, `abc`. The helper returns a *partial* options object that omits any key
whose env var was absent or invalid, so a caller spreads it over its own
options and the Orchestrator's own default stands wherever the env said nothing
usable. `0` and negatives are deliberately rejected rather than clamped: a
`maxHops` of 0 would silently disable all handoffs, which is a surprising thing
to get from a typo'd env var. Invalid input falls back to the default, it never
changes behavior to an extreme.

All five construction sites now spread `...orchestratorEnvOptions()` into their
options. The helper centralizes the parse so the five sites can't drift — there
is one definition of what `BAI_MAX_HOPS` means, not five.

The helper is exported and unit-tested directly (unset → empty, valid →
parsed, `0`/negative → ignored, mixed valid/invalid → only the valid key),
because the parse *is* the logic worth testing; the wiring is a one-line spread.

## Consequences

- The two A2A guards are now operator-tunable without touching source, matching
  how every other capability in the project is configured. A tighter
  `BAI_MAX_TURNS=6` on a shared box, or a looser `BAI_MAX_HOPS=6` for a long
  review chain, is one env var away.
- Defaults are unchanged: with no env vars set, `orchestratorEnvOptions()`
  returns `{}` and the Orchestrator's `3` / `12` stand. Existing behavior is
  byte-for-byte the same for anyone who sets nothing.
- The "positive integer or fall back" rule means a typo can't silently wedge the
  system into an extreme (no handoffs at all, or an unbounded chain). The worst
  a bad value does is leave the default in place.
- One parse, five callers: the meaning of each env var lives in a single tested
  function, so the CLI and the server can't disagree about it.
- A future token-based budget (floated in ADR 0028) could read its own
  `BAI_*` knob through the same helper, keeping all the dispatch guards parsed
  in one place.
