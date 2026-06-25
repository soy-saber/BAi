/**
 * Tests for the git status parser. We test the pure `parseStatus` against fixed
 * porcelain fixtures — no git process spawned — which is exactly why the parser
 * was split out from the spawn wrappers (see git.ts design notes).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStatus } from '../src/git.js';

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
