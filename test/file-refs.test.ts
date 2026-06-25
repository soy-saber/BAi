import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadFileContext, parseFileRefs } from '../src/context/file-refs.ts';

test('parseFileRefs extracts distinct @file: paths in order', () => {
  const refs = parseFileRefs(
    'look at @file:src/a.ts and @file:src/b.ts, also @file:src/a.ts again',
  );
  assert.deepEqual(refs, ['src/a.ts', 'src/b.ts']);
});

test('parseFileRefs strips trailing punctuation but keeps the path', () => {
  assert.deepEqual(parseFileRefs('see @file:src/foo.ts.'), ['src/foo.ts']);
  assert.deepEqual(parseFileRefs('(@file:src/bar.ts)'), ['src/bar.ts']);
});

test('parseFileRefs ignores a bare @mention (not @file:)', () => {
  assert.deepEqual(parseFileRefs('@claude please look'), []);
});

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'bai-refs-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadFileContext inlines a referenced file under a labeled block', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, 'hello.ts'), 'export const x = 1;\n');
    const { block, refs } = await loadFileContext('explain @file:hello.ts', { root: dir });
    assert.equal(refs.length, 1);
    assert.equal(refs[0]?.ok, true);
    assert.match(block, /Referenced files/);
    assert.match(block, /### hello\.ts/);
    assert.match(block, /export const x = 1;/);
  });
});

test('loadFileContext returns an empty block when there are no refs', async () => {
  await withDir(async (dir) => {
    const { block, refs } = await loadFileContext('no files here', { root: dir });
    assert.equal(block, '');
    assert.deepEqual(refs, []);
  });
});

test('loadFileContext refuses to escape the workspace root', async () => {
  await withDir(async (dir) => {
    const { refs } = await loadFileContext('@file:../../etc/passwd', { root: dir });
    assert.equal(refs[0]?.ok, false);
    assert.match(refs[0]?.reason ?? '', /escapes|absolute/);
  });
});

test('loadFileContext refuses files that look like secrets', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, '.env'), 'SECRET=shh\n');
    const { refs } = await loadFileContext('@file:.env', { root: dir });
    assert.equal(refs[0]?.ok, false);
    assert.match(refs[0]?.reason ?? '', /secret/i);
  });
});

test('loadFileContext reports a missing file rather than throwing', async () => {
  await withDir(async (dir) => {
    const { refs } = await loadFileContext('@file:nope.ts', { root: dir });
    assert.equal(refs[0]?.ok, false);
    assert.ok((refs[0]?.reason ?? '').length > 0);
  });
});

test('loadFileContext truncates a file past the per-file cap', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, 'big.txt'), 'x'.repeat(100));
    const { block, refs } = await loadFileContext('@file:big.txt', {
      root: dir,
      maxBytesPerFile: 10,
    });
    assert.equal(refs[0]?.ok, true);
    assert.match(block, /\[truncated\]/);
  });
});
