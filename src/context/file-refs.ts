/**
 * File-reference context injection.
 *
 * A chat-only model (one with no file/command tools — see Identity.mode) can't
 * read the workspace itself. So when a message names a file with `@file:<path>`,
 * we read that file here and inline its contents into the prompt. BAi is the
 * model's hands: it reads, the model reasons over the text, and BAi remains the
 * only thing that ever touches disk.
 *
 * Syntax: `@file:src/foo.ts` — the path runs to the next whitespace. This does
 * not collide with @mention routing: the mention parser only acts on known
 * agent names, and "file" is never an agent.
 *
 * Safety:
 *   - paths resolve against a fixed root (cwd) and may not escape it (no `..`
 *     traversal, no absolute paths outside root) — a chat model shouldn't be
 *     able to pull /etc/passwd into the transcript;
 *   - files that look like secrets (.env, keys, credentials) are refused, named
 *     but never inlined, so we don't leak them into prompts or memory;
 *   - per-file and total byte caps keep one careless reference from blowing the
 *     context window.
 */

import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Match `@file:<path>` where the path is everything up to whitespace. */
const FILE_REF_RE = /(?<![\w@])@file:(\S+)/gi;

/** Trailing punctuation that's almost never part of a real path. */
const TRAILING = /[),.;:'"]+$/;

/** Basenames / patterns we refuse to inline, to avoid leaking secrets. */
const SECRET_RE =
  /(^\.env($|\.)|(^|[._-])secret|(^|[._-])credentials?|\.pem$|\.key$|(^|\/)id_rsa)/i;

export interface FileRefOptions {
  /** Root that paths resolve against and may not escape. Default process.cwd(). */
  root?: string;
  /** Max bytes inlined per file. Default 64 KiB. */
  maxBytesPerFile?: number;
  /** Max bytes inlined across all files in one message. Default 192 KiB. */
  maxBytesTotal?: number;
}

/** One resolved reference: either inlined content or a skip with a reason. */
export interface LoadedRef {
  /** The path exactly as written in the message. */
  ref: string;
  ok: boolean;
  /** File contents when ok; omitted otherwise. */
  content?: string;
  /** Why it was skipped when not ok. */
  reason?: string;
}

/** Extract distinct `@file:` paths from a message, in first-seen order. */
export function parseFileRefs(text: string): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const match of text.matchAll(FILE_REF_RE)) {
    const raw = (match[1] ?? '').replace(TRAILING, '');
    if (raw && !seen.has(raw)) {
      seen.add(raw);
      refs.push(raw);
    }
  }
  return refs;
}

/** Resolve a referenced path against root, refusing anything that escapes it. */
function safeResolve(ref: string, root: string): { abs: string } | { error: string } {
  if (isAbsolute(ref)) return { error: 'absolute paths are not allowed' };
  const abs = resolve(root, ref);
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
    return { error: 'path escapes the workspace root' };
  }
  return { abs };
}

/**
 * Read every `@file:` reference in a message and build a prompt block of their
 * contents. Returns the block (empty string when there are no refs) plus a
 * per-ref report so a caller/UI can show what was and wasn't loaded.
 */
export async function loadFileContext(
  text: string,
  options: FileRefOptions = {},
): Promise<{ block: string; refs: LoadedRef[] }> {
  const refs = parseFileRefs(text);
  if (refs.length === 0) return { block: '', refs: [] };

  const root = options.root ?? process.cwd();
  const perFile = options.maxBytesPerFile ?? 64 * 1024;
  const total = options.maxBytesTotal ?? 192 * 1024;

  const loaded: LoadedRef[] = [];
  let used = 0;

  for (const ref of refs) {
    if (SECRET_RE.test(ref)) {
      loaded.push({ ref, ok: false, reason: 'looks like a secret — refused' });
      continue;
    }
    const resolved = safeResolve(ref, root);
    if ('error' in resolved) {
      loaded.push({ ref, ok: false, reason: resolved.error });
      continue;
    }
    let content: string;
    try {
      content = await readFile(resolved.abs, 'utf8');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      loaded.push({ ref, ok: false, reason });
      continue;
    }
    if (used + Math.min(content.length, perFile) > total) {
      loaded.push({ ref, ok: false, reason: 'total context budget exceeded — skipped' });
      continue;
    }
    let truncated = false;
    if (content.length > perFile) {
      content = content.slice(0, perFile);
      truncated = true;
    }
    used += content.length;
    loaded.push({
      ref,
      ok: true,
      content: truncated ? `${content}\n… [truncated]` : content,
    });
  }

  return { block: renderBlock(loaded), refs: loaded };
}

/** Render loaded references as a fenced, labeled prompt block. */
function renderBlock(refs: LoadedRef[]): string {
  if (refs.length === 0) return '';
  const parts: string[] = [
    '## Referenced files',
    'These are the exact current contents of the files named with `@file:`. ' +
      'You cannot read or edit files yourself — this is all you can see. To ' +
      'change a file, do not reprint the whole file: give the specific old → new ' +
      'snippets to replace, and a human or a tool-capable agent will apply them.',
  ];
  for (const r of refs) {
    if (r.ok && r.content !== undefined) {
      parts.push(`### ${r.ref}\n\`\`\`\n${r.content}\n\`\`\``);
    } else {
      parts.push(`### ${r.ref}\n(could not include: ${r.reason})`);
    }
  }
  return parts.join('\n\n');
}
