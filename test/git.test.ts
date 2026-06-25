/**
 * Tests for the git inspector. Two layers:
 *   - `parseStatus` against fixed porcelain fixtures — no git process spawned,
 *     which is exactly why the parser was split out from the spawn wrappers.
 *   - the mutating wrappers (stage/unstage/commit) against a throwaway repo in
 *     a temp dir, so the path-validation guard and real git behavior are
 *     exercised end to end without touching this project's repo.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gitCommit, gitDiff, gitStage, gitStatus, gitUnstage, parseStatus } from '../src/git.js';

test('parses branch with upstream and ahead/behind', () => {
  const out = parseStatus('## main...origin/main [ahead 2, behind 1]\n');
  assert.equal(out.branch, 'main');
  assert.equal(out.upstream, 'origin/main');
  assert.equal(out.ahead, 2);
  assert.equal(out.behind, 1);
  assert.equal(out.files.length, 0);
});

test('parses branch with upstream but no divergence', () => {
  const out = parseStatus('## main...origin/main\n');
  assert.equal(out.branch, 'main');
  assert.equal(out.upstream, 'origin/main');
  assert.equal(out.ahead, undefined);
  assert.equal(out.behind, undefined);
});

test('parses a local-only branch with no upstream', () => {
  const out = parseStatus('## feature/x\n');
  assert.equal(out.branch, 'feature/x');
  assert.equal(out.upstream, undefined);
});

test('parses "No commits yet" branch line', () => {
  const out = parseStatus('## No commits yet on main\n');
  assert.equal(out.branch, 'main');
  assert.equal(out.upstream, undefined);
});

test('classifies staged, unstaged, and both', () => {
  const raw = ['## main', 'M  staged.ts', ' M unstaged.ts', 'MM both.ts'].join('\n');
  const out = parseStatus(raw);
  const by = (p: string) => out.files.find((f) => f.path === p);

  const staged = by('staged.ts');
  assert.ok(staged);
  assert.equal(staged.staged, true);
  assert.equal(staged.unstaged, false);

  const unstaged = by('unstaged.ts');
  assert.ok(unstaged);
  assert.equal(unstaged.staged, false);
  assert.equal(unstaged.unstaged, true);

  const both = by('both.ts');
  assert.ok(both);
  assert.equal(both.staged, true);
  assert.equal(both.unstaged, true);
});

test('classifies untracked files', () => {
  const out = parseStatus('## main\n?? new-file.ts\n');
  const f = out.files[0];
  assert.ok(f);
  assert.equal(f.path, 'new-file.ts');
  assert.equal(f.untracked, true);
  assert.equal(f.staged, false);
  assert.equal(f.unstaged, false);
});

test('keeps both paths for a rename', () => {
  const out = parseStatus('## main\nR  old/name.ts -> new/name.ts\n');
  const f = out.files[0];
  assert.ok(f);
  assert.equal(f.path, 'new/name.ts');
  assert.equal(f.orig, 'old/name.ts');
  assert.equal(f.index, 'R');
});

test('unquotes paths with spaces and escapes', () => {
  const out = parseStatus('## main\n M "dir with space/a\\tb.ts"\n');
  const f = out.files[0];
  assert.ok(f);
  assert.equal(f.path, 'dir with space/a\tb.ts');
});

test('ignores blank lines and short garbage', () => {
  const out = parseStatus('## main\n\nM  real.ts\nx\n');
  assert.equal(out.files.length, 1);
  assert.equal(out.files[0]?.path, 'real.ts');
});

test('empty status yields no files', () => {
  const out = parseStatus('## main...origin/main\n');
  assert.deepEqual(out.files, []);
});

// ---- live git: stage / unstage / commit against a throwaway repo ----------
// These spawn real git in a temp dir, so they exercise the actual argv,
// path-validation guard, and exit-code handling — not just the pure parser.
// Skipped automatically if git isn't on PATH.

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bai-git-'));
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run('init', '-q');
  // Local identity so commits work without a global git config.
  run('config', 'user.email', 'test@bai.local');
  run('config', 'user.name', 'BAi Test');
  run('config', 'commit.gpgsign', 'false');
  return dir;
}

test('live: stage → commit → clean tree', { skip: !gitAvailable() }, async () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'a.txt'), 'hello\n');

    // Untracked file shows up, with no tracked diff to show.
    let status = await gitStatus(dir);
    assert.equal(status.repo, true);
    assert.equal(status.files.length, 1);
    assert.equal(status.files[0]?.untracked, true);
    const newDiff = await gitDiff('a.txt', { cwd: dir });
    assert.equal(newDiff.untracked, true);

    // Stage it, then it's a staged add.
    const staged = await gitStage(['a.txt'], dir);
    assert.equal(staged.ok, true);
    status = await gitStatus(dir);
    assert.equal(status.files[0]?.staged, true);

    // Commit the index.
    const committed = await gitCommit('add a.txt', dir);
    assert.equal(committed.ok, true);
    assert.match(committed.committed ?? '', /add a\.txt/);

    // Working tree is clean again.
    status = await gitStatus(dir);
    assert.equal(status.files.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live: unstage moves a file back out of the index', { skip: !gitAvailable() }, async () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'b.txt'), 'one\n');
    await gitStage(['b.txt'], dir);
    assert.equal((await gitStatus(dir)).files[0]?.staged, true);

    const un = await gitUnstage(['b.txt'], dir);
    assert.equal(un.ok, true);
    const f = (await gitStatus(dir)).files[0];
    assert.ok(f);
    assert.equal(f.staged, false);
    assert.equal(f.untracked, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live: staging a path git does not report is rejected', {
  skip: !gitAvailable(),
}, async () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'real.txt'), 'x\n');
    // "../escape" is not in `git status`, so the guard must refuse it — this is
    // the test that the endpoint can't be coaxed into staging arbitrary paths.
    const bad = await gitStage(['../escape.txt'], dir);
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? '', /not a changed file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live: commit with nothing staged fails cleanly', { skip: !gitAvailable() }, async () => {
  const dir = makeRepo();
  try {
    const res = await gitCommit('nothing here', dir);
    assert.equal(res.ok, false);
    assert.ok((res.error ?? '').length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('empty file list and empty message are rejected without spawning git', async () => {
  assert.equal((await gitStage([], '/nonexistent')).ok, false);
  assert.equal((await gitUnstage([], '/nonexistent')).ok, false);
  assert.equal((await gitCommit('   ', '/nonexistent')).ok, false);
});
