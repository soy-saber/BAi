# 0020 — Chat-mode degradation and `@file:` context feeding

- **Date:** 2026-06-25
- **Status:** accepted
- **Stage:** 18
- **Agent:** Claude

## Context

Not every model behind an adapter has real tools. The same GPT-5.5 or Gemini
that runs autonomously through one CLI is, through another binding, a plain
chat endpoint: no shell, no file read/write. Two failure shapes show up in
practice:

- GPT **believes it is in a Linux sandbox** and narrates running commands and
  editing files — output that is pure fiction, because nothing reached disk.
- Gemini (in this stack) **correctly says it has no shell**, then can't do the
  task at all because it never sees the files.

Both come from one fact: a chat-only model cannot touch the workspace. It can
still reason, review, analyse, and plan — it just needs the file contents put
in front of it, and it needs to stop pretending it can act.

The user's own framing settled the approach: making a chat model edit large
files by "feed the whole file in, get the whole file out" is a bad idea — it
blows the context window, truncates, and silently drops lines. BAi must be the
model's hands instead: BAi reads, the model reasons over the text, BAi is the
only thing that ever writes to disk.

## Decision

Add a capability flag to identity and a read-only context-injection path.

1. **`Identity.mode: 'agent' | 'chat'`** (default `'agent'`). `gemini` is marked
   `chat`. A `BAI_CHAT_AGENTS=codex,gemini` env override forces any agent to
   chat-only without editing source — needed because a `codex` CLI may be bound
   to a chat-only model like gemini-3.1-pro (Config Immutability: deployment
   differences live in env, not code). `resolveMode()` merges the two.

2. **`@file:<path>` references.** A message can name files; `loadFileContext`
   reads them and inlines their exact current contents into the prompt under a
   "Referenced files" block. Only done for `chat`-mode agents — a tool-capable
   agent is left to open files itself. Writing to disk always stays with BAi.

3. **Chat-mode note in the prompt.** Chat agents get a blunt preamble: you have
   no file/command tools, do not claim to have run anything, the quoted files
   are all you can see, and to change a file give precise old → new snippets for
   a human or tool-capable teammate to apply. This directly targets GPT's
   imagined-sandbox behaviour and steers edits toward small diffs, not whole-file
   reprints — the second-tier "mediated editing" path the user wanted deferred.

4. **`file_context` dispatch event** so the UI can show which files were fed in
   (and which were refused), making the otherwise-invisible injection visible.

### Safety on the read path

`@file:` lets a chat model pull file contents into the transcript, so the reader
is locked down: paths resolve against a fixed root (cwd) and may not escape it
(no `..`, no absolute paths); basenames that look like secrets (`.env`, `*.key`,
`*.pem`, `credentials`, `id_rsa`) are named but never inlined; per-file (64 KiB)
and total (192 KiB) byte caps stop one careless reference from blowing the
window. This keeps a chat model from coaxing `/etc/passwd` or a key file into a
prompt — or into memory, since transcripts sediment.

## The practice run (before → after)

We dogfooded the feature on BAi's own frontend. `codex` was bound to
gemini-3.1-pro (chat-only) via `BAI_CHAT_AGENTS=codex`, the server was started,
and through the real HTTP/streaming API we asked `@codex` to polish the UI,
passing `@file:src/server/index.html` and `@file:src/server/app.js`.

**Before:** a chat-only codex would have had no way to see either file — it
would either refuse or hallucinate edits to files it never read.

**After:** the dispatch streamed `agent_start → file_context (both files
ok:true) → result → agent_end → done [codex]`. The model received the real file
contents, kept its injected identity (it signed off as "Maine Coon"), respected
the chat-mode note — it did **not** pretend to edit anything — and returned a
clean set of `*** Begin Patch / *** Update File / old → new` diff blocks: a new
coral accent palette with a separate blue reserved for agents, larger
role-coloured avatars, and a left colour-bar on agent bubbles. BAi (here, the
human-side Claude) then applied those diffs to disk. End to end, the chat model
did real work on real files without ever touching the filesystem.

## Consequences / pitfalls

- `@file:` is read-only by design. Writing back is deliberately **not**
  automated yet; the chat model emits diffs and something tool-capable applies
  them. Automatic diff-application (parsing the patch blocks and writing them) is
  the obvious next stage, with its own failure handling (a snippet that no longer
  matches).
- The secret-refusal list is best-effort by filename, not content inspection. A
  secret in an oddly-named file would still be readable. The byte caps and the
  no-escape root are the harder guarantees.
- `mode` lives in code today (with an env override). Moving identities to config
  (a separate backlog item) would let a deployment declare a model's capability
  without either.
