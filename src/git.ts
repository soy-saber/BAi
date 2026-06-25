/**
 * Git inspector — a thin, read-only window onto the working tree.
 *
 * BAi's agents edit files in the working directory directly, so the single most
 * useful thing the operator can see is "what did they actually change?" This
 * module answers that: a structured `git status` and a per-file `git diff`.
 *
 * It also exposes a small set of *mutating* ops — stage, unstage, commit — for
 * the operator to act on those changes from the UI. These are deliberately the
 * non-destructive ones: stage/unstage only move entries in and out of the index,
 * and commit only records what's already staged (no `-a`, no reset, no clean, no
 * checkout that could discard work). Every path passed to a write op is first
 * validated against `git status`, so a request can only ever act on files git
 * already reports as changed — never an arbitrary path.
 *
 * Design notes:
 *   - We spawn `git` directly (no shell). git is a real `.exe` on Windows, so
 *     CreateProcess finds it without PATHEXT help — unlike the npm-shim CLIs in
 *     adapters/, which need shell:true. With no shell, file paths and the commit
 *     message passed as argv carry zero shell-injection surface, however odd.
 *   - The status *parser* is pure and exported (`parseStatus`) so it's tested
 *     without spawning anything; the spawn wrappers are the thin part.
 *   - `gitDiff` only diffs paths that actually appear in `git status`, so the
 *     endpoint can't be coaxed into reading arbitrary files via a crafted path.
 */

import { spawn } from 'node:child_process';

/** One changed path, decomposed from a porcelain status line. */
export interface GitFile {
  /** Path as git reports it (the new path for renames). */
  path: string;
  /** Original path, for renames/copies only. */
  orig?: string;
  /** Index (staged) status char, e.g. 'M', 'A', 'D', 'R'; ' ' if none. */
  index: string;
  /** Worktree (unstaged) status char; ' ' if none. */
  worktree: string;
  /** Convenience flags derived from the two chars above. */
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

/** A snapshot of the working tree. `repo: false` means "not a git repo here". */
export interface GitStatus {
  repo: boolean;
  branch?: string;
  /** Upstream tracking branch, if any (e.g. "origin/main"). */
  upstream?: string;
  ahead?: number;
  behind?: number;
  files: GitFile[];
}

interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

/** Run a git subcommand with no shell; never throws — failures come back as ok:false. */
function runGit(args: string[], cwd: string): Promise<GitRun> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: String(err), code: -1 });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    // ENOENT (git not installed) arrives as an 'error' event, not an exit code.
    child.on('error', (err) => resolve({ ok: false, stdout, stderr: String(err), code: -1 }));
    child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr, code: code ?? 0 }));
  });
}

/**
 * Unquote a porcelain path. git wraps paths containing special chars in double
 * quotes with C-style escapes; the common, unquoted case is returned as-is.
 */
function unquotePath(p: string): string {
  if (p.length < 2 || p[0] !== '"' || p[p.length - 1] !== '"') return p;
  const inner = p.slice(1, -1);
  return inner.replace(/\\(["\\ntr])/g, (_, ch) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      default:
        return ch; // \" or \\
    }
  });
}

/**
 * Parse the output of `git status --porcelain=v1 --branch` into structured form.
 * Pure — no I/O — so it can be unit-tested against fixed fixtures.
 *
 * The first `## ...` line carries branch + ahead/behind; each remaining line is
 * `XY <path>`, where X is the index (staged) status and Y the worktree status.
 * Renames/copies appear as `R  old -> new` (we keep both).
 */
export function parseStatus(raw: string): Omit<GitStatus, 'repo'> {
  const out: Omit<GitStatus, 'repo'> = { files: [] };
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;

    if (line.startsWith('## ')) {
      const info = line.slice(3);
      // "No commits yet on main" / "HEAD (no branch)" have no upstream.
      const noCommits = info.match(/^No commits yet on (.+)$/);
      if (noCommits) {
        out.branch = noCommits[1];
        continue;
      }
      // "<local>...<upstream> [ahead N, behind M]" or just "<local>".
      const m = info.match(/^(.+?)(?:\.\.\.(\S+))?(?:\s\[(.+)\])?$/);
      if (m) {
        out.branch = m[1];
        if (m[2]) out.upstream = m[2];
        if (m[3]) {
          const ahead = m[3].match(/ahead (\d+)/);
          const behind = m[3].match(/behind (\d+)/);
          if (ahead) out.ahead = Number(ahead[1]);
          if (behind) out.behind = Number(behind[1]);
        }
      }
      continue;
    }

    // Status lines are "XY<space>path"; X/Y may be a space themselves.
    if (line.length < 4) continue;
    const index = line[0] ?? ' ';
    const worktree = line[1] ?? ' ';
    let rest = line.slice(3);
    let orig: string | undefined;
    // Renames/copies: "old -> new". Keep the new path as the primary.
    const arrow = rest.indexOf(' -> ');
    if (arrow !== -1) {
      orig = unquotePath(rest.slice(0, arrow));
      rest = rest.slice(arrow + 4);
    }
    const path = unquotePath(rest);
    out.files.push({
      path,
      ...(orig ? { orig } : {}),
      index,
      worktree,
      staged: index !== ' ' && index !== '?',
      unstaged: worktree !== ' ' && worktree !== '?',
      untracked: index === '?' && worktree === '?',
    });
  }
  return out;
}

/** Read the working-tree status. Returns `{ repo: false }` outside a git repo. */
export async function gitStatus(cwd: string = process.cwd()): Promise<GitStatus> {
  const run = await runGit(['status', '--porcelain=v1', '--branch'], cwd);
  if (!run.ok) return { repo: false, files: [] };
  return { repo: true, ...parseStatus(run.stdout) };
}

/**
 * Diff the working tree, or one file within it.
 *
 * With no `file`, returns the whole-tree unified diff (everything `git diff`
 * shows). With a `file`, the path is validated against the current status
 * first, so this can't be used to read files outside the set git already
 * reports as changed. `staged` selects the index-vs-HEAD diff (`--cached`)
 * instead of the worktree-vs-index diff.
 *
 * Returns `{ diff: '' }` outside a repo or when a named file isn't a recognized
 * change; `untracked: true` when the file is new (no tracked baseline to diff).
 */
export async function gitDiff(
  file?: string,
  options: { staged?: boolean; cwd?: string } = {},
): Promise<{ file?: string; diff: string; untracked?: boolean }> {
  const cwd = options.cwd ?? process.cwd();
  const status = await gitStatus(cwd);
  if (!status.repo) return { file, diff: '' };

  if (file !== undefined) {
    const match = status.files.find((f) => f.path === file);
    if (!match) return { file, diff: '' };
    // Untracked files have no tracked baseline to diff against.
    if (match.untracked) return { file, diff: '', untracked: true };
  }

  const args = ['diff'];
  if (options.staged) args.push('--cached');
  // `--` ends option parsing; any path is a positional arg, never a flag, and
  // there's no shell, so a leading-dash or otherwise odd filename is harmless.
  if (file !== undefined) args.push('--', file);
  const run = await runGit(args, cwd);
  return { file, diff: run.ok ? run.stdout : '' };
}

/** Outcome of a mutating git op. `ok: false` carries git's stderr in `error`. */
export interface GitWriteResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate that every requested path is something git already reports as
 * changed. This is the guard that keeps the write endpoints from being coaxed
 * into staging arbitrary files: we only ever act on the working-tree's own
 * change set, never on a path the operator hand-crafts in a request body.
 *
 * Returns the offending path on the first miss, or null when all are present.
 */
async function rejectUnknownPaths(files: string[], cwd: string): Promise<string | null> {
  const status = await gitStatus(cwd);
  if (!status.repo) return '(not a git repository)';
  const known = new Set(status.files.map((f) => f.path));
  // Renames report the new path in status; allow the old path too so a staged
  // rename can be unstaged by either name.
  for (const f of status.files) if (f.orig) known.add(f.orig);
  for (const f of files) if (!known.has(f)) return f;
  return null;
}

/**
 * Stage one or more changed files (`git add -- <paths>`). Paths are checked
 * against `git status` first, so only real working-tree changes can be staged.
 */
export async function gitStage(
  files: string[],
  cwd: string = process.cwd(),
): Promise<GitWriteResult> {
  if (files.length === 0) return { ok: false, error: 'no files given' };
  const bad = await rejectUnknownPaths(files, cwd);
  if (bad) return { ok: false, error: `not a changed file: ${bad}` };
  const run = await runGit(['add', '--', ...files], cwd);
  return run.ok
    ? { ok: true }
    : { ok: false, error: run.stderr.trim() || `git add (code ${run.code})` };
}

/**
 * Unstage one or more files (`git reset -- <paths>`), moving them out of the
 * index back to the working tree. Non-destructive: it never touches file
 * contents, only what's staged. We use `git reset` rather than `git restore
 * --staged` because reset also works before the first commit (no HEAD yet) —
 * it resets the index entry to HEAD when one exists, or clears it otherwise.
 * Paths are validated against status.
 */
export async function gitUnstage(
  files: string[],
  cwd: string = process.cwd(),
): Promise<GitWriteResult> {
  if (files.length === 0) return { ok: false, error: 'no files given' };
  const bad = await rejectUnknownPaths(files, cwd);
  if (bad) return { ok: false, error: `not a changed file: ${bad}` };
  const run = await runGit(['reset', '-q', '--', ...files], cwd);
  return run.ok
    ? { ok: true }
    : { ok: false, error: run.stderr.trim() || `git reset (code ${run.code})` };
}

/**
 * Commit whatever is currently staged (`git commit -m <message>`). Deliberately
 * does NOT pass `-a`: it only commits the index, so the operator controls
 * exactly what lands by staging first. The message goes on its own argv (no
 * shell), so it's injection-safe regardless of content. Fails cleanly when
 * there's nothing staged.
 */
export async function gitCommit(
  message: string,
  cwd: string = process.cwd(),
): Promise<GitWriteResult & { committed?: string }> {
  const msg = message.trim();
  if (!msg) return { ok: false, error: 'empty commit message' };
  const run = await runGit(['commit', '-m', msg], cwd);
  if (run.ok) {
    // git prints "[branch sha] subject" on the first stdout line; surface it.
    const first = run.stdout.split('\n').find((l) => l.trim().length > 0) ?? '';
    return { ok: true, committed: first.trim() };
  }
  // "nothing to commit" comes back on stdout with a non-zero code; prefer it.
  const reason = run.stderr.trim() || run.stdout.trim() || `git commit (code ${run.code})`;
  return { ok: false, error: reason };
}
