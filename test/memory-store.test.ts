import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MemoryStore } from '../src/store/memory-store.ts';

async function withStore<T>(fn: (store: MemoryStore) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'bai-mem-'));
  try {
    return await fn(new MemoryStore(join(dir, 'memory.jsonl')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('records and reads back memories', async () => {
  await withStore(async (store) => {
    await store.record('decision', 'claude', 'use CLI subprocess, not direct API');
    await store.record('lesson', 'codex', 'codex needs workspace-write to edit files');
    const all = await store.all();
    assert.equal(all.length, 2);
    assert.equal(all[0]?.kind, 'decision');
    assert.equal(all[1]?.agent, 'codex');
  });
});

test('recall scores by keyword overlap', async () => {
  await withStore(async (store) => {
    await store.record('decision', 'claude', 'thread store uses plain JSON files');
    await store.record('lesson', 'codex', 'sandbox blocks writes by default');
    const hits = await store.recall('how does the thread store work');
    assert.equal(hits[0]?.text, 'thread store uses plain JSON files');
  });
});

test('recall with empty query returns most recent first', async () => {
  await withStore(async (store) => {
    await store.record('lesson', 'claude', 'first');
    await store.record('lesson', 'claude', 'second');
    const hits = await store.recall('');
    assert.equal(hits[0]?.text, 'second');
  });
});

test('recall returns nothing when query matches no memory', async () => {
  await withStore(async (store) => {
    await store.record('lesson', 'claude', 'about routing');
    const hits = await store.recall('zzzzz nonexistent topic');
    assert.deepEqual(hits, []);
  });
});

test('all() returns empty when the store file does not exist', async () => {
  await withStore(async (store) => {
    assert.deepEqual(await store.all(), []);
  });
});
