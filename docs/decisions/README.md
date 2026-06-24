# Architecture Decision Records

This directory holds short notes on important design decisions — what we chose,
why, and what trade-offs or pitfalls came up.

For a learning project, *the reasoning matters more than the code*. Each file is
one decision. Keep them short and honest, including the things that went wrong.

## Format

```
# NNNN — <title>

- **Date:**
- **Status:** proposed | accepted | superseded
- **Agent:** Claude | GPT | Codex | ...
- **Stage:** S0 | S1 | ... | maintenance

## Context
What problem are we solving? What constraints apply?

## Decision
What did we choose?

## Why
Why this over the alternatives?

## Consequences / pitfalls
What does this make easy? What does it make hard? What did we trip on?
```

## Provenance

Decision records now carry an `Agent` field so work authored by different
agents can be distinguished over time. Existing records `0001` through `0018`
are marked as Claude-authored reports. New maintenance or feature records
should name the agent that made the change.
