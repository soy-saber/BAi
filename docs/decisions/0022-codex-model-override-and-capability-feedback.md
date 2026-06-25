# 0022 — codex model override + runtime capability feedback

Status: accepted
Stage: S20
Agent: Claude

## Context

A user's `codex` CLI can be pointed at different models through its own
`~/.codex/config.toml` (`model_provider = "custom"`, a `base_url`, and a pinned
`model`). In this deployment it was pinned to `gemini-3.1-pro` — a chat-only
model with no real tool ability — even though the same custom provider also
serves `gpt-5.5`, which *is* tool-capable inside codex.

Two problems followed:

1. **No way to switch the model from BAi.** `codex.ts` hard-coded its argv, so
   the model was entirely whatever config.toml pinned. Getting GPT's hands
   meant editing the user's config file — which violates Config Immutability
   (deployment differences belong in env, not in edited config or source).
2. **Capability is a runtime fact, not a config fact.** Whether a given model
   name behind a custom provider actually has agent ability is only knowable by
   running it. A static "model → mode" table would confidently mislabel an
   unknown model and either feed files to something that didn't need them, or
   bet on tools a chat-only model doesn't have.

## Decision

Three small, composable pieces.

### 1. `BAI_CODEX_MODEL` — inject `-m <model>`, don't touch config.toml

`codex exec` accepts `-m <model>` (and `-c model=…`) to override the pinned
model while reusing the provider/base_url already in config. The codex adapter
now reads `BAI_CODEX_MODEL` and, when set, appends `-m <model>` to its argv —
before the `-` stdin marker. Empty/whitespace is ignored. The user's
config.toml is never written.

### 2. Mode follows the model — optimistically

`resolveMode` precedence, highest first:

1. `BAI_CHAT_AGENTS=codex` — explicit manual downgrade, always wins.
2. `BAI_CODEX_MODEL=<model>` — for codex only: a *known* chat-only model
   (matched by `/gemini/i`) auto-degrades to chat; anything else stays an
   **agent**. The default is optimistic: switching the model to get a model's
   hands implies you want to use them.
3. The identity's declared `mode` (default `agent`).

### 3. Runtime capability feedback — the part that handles uncertainty

Because step 2 is a guess, the orchestrator measures the truth. `consume`
already sees every `tool_use` event, so it now counts them. When a turn runs as
`mode === 'agent'`, **succeeds**, and called **zero** tools, the orchestrator
emits a `no_tools` event:

> *⟨agent⟩ called no tools this turn — if it's actually chat-only, set
> `BAI_CHAT_AGENTS=⟨agent⟩` to feed files instead.*

This converts the unknowable-at-config-time question ("does this model actually
have hands?") into an observable, after the first real turn — with a one-key fix
when the optimistic guess was wrong. We don't pre-bet and silently fail; we
assume capable, watch, and tell the operator when reality disagrees.

## Why optimistic + feedback, not conservative + probe

The conservative alternative — treat an unknown model as chat-only until proven
agentic — means every genuinely-capable model starts crippled (files needlessly
inlined, told it has no tools) until someone flips it on. An active capability
*probe* (a throwaway "run `echo`" turn) costs a round-trip and a model call
before every real turn, and a model can still pass a probe yet stall on real
work. Optimistic-plus-feedback pays nothing up front, is right in the common
case (you switched models *because* you want their tools), and degrades to a
single env var when wrong. The cost of a wrong optimistic guess is one wasted
turn plus a clear hint — cheap and self-correcting.

## Why `/gemini/i` and not a full table

It's the one model we *know* is chat-only in this stack, and naming it keeps the
common `BAI_CODEX_MODEL=gemini-3.1-pro` case correct without inlining. Anything
else is left to the optimistic default + the `no_tools` feedback rather than a
brittle allowlist that goes stale as providers add models. The pattern, not the
list, is the contract.

## Verification

- Unit (`test/codex-model.test.ts`, 7 cases): `-m` injection present only when
  `BAI_CODEX_MODEL` is set, placed before the `-` stdin marker; empty value
  ignored; the four `resolveMode` precedence paths (tool-capable → agent,
  known-chat model → chat, `BAI_CHAT_AGENTS` overrides both, neither set →
  declared mode).
- Unit (`test/orchestrator.test.ts`): an agent-mode turn that succeeds with
  text only and no `tool_use` emits exactly one `no_tools` event; a turn that
  used a tool does not.
- Full suite 126 pass; tsc clean; biome clean.
- Real machine: switching `BAI_CODEX_MODEL=gpt-5.5` and running a turn is the
  intended follow-up exercise (this is the model that should show tool calls,
  versus gemini-3.1-pro which should trip `no_tools`).

## Consequences

- Switching codex's model for a run is one env var, with no edit to the user's
  config.toml — the same Config-Immutability shape as `BAI_CHAT_AGENTS`.
- Mode and model stay coherent automatically for the known cases, and surface a
  prompt-free, observable signal for the unknown ones.
- `no_tools` is a general orchestrator signal, not codex-specific: any agent
  mislabeled tool-capable trips it. The feedback mechanism outlives this one
  model-switching feature.
- The `/gemini/i` heuristic is deliberately small; if a second known chat-only
  model appears, it's one regex edit, but the `no_tools` path means even an
  un-listed one fails loudly rather than silently.
