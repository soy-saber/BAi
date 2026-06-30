import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { AgentAdapter, RunOptions } from '../src/adapters/adapter.ts';
import { Orchestrator } from '../src/routing/orchestrator.ts';
import { type RouteDeps, route } from '../src/server/server.ts';
import { ThreadStore } from '../src/store/thread-store.ts';
import type { AgentMessage } from '../src/types.ts';

// ---- harness ---------------------------------------------------------------
// We exercise the router directly (no socket), feeding it fake req/res objects
// and injected deps. This keeps the HTTP contract — status codes, JSON bodies,
// validation, NDJSON streaming — under test without binding a port or a live
// CLI. Git ops are pointed at a throwaway repo via deps.gitCwd.

/** A captured HTTP response: status, headers, and the body chunks written. */
interface CapturedRes {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Body parsed as JSON (throws in the getter if it wasn't JSON). */
  json(): unknown;
  /** Body parsed as newline-delimited JSON (one object per non-empty line). */
  ndjson(): unknown[];
}

/** Build a fake IncomingMessage: a readable stream carrying the JSON body. */
function fakeReq(method: string, url: string, body?: unknown): import('node:http').IncomingMessage {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(
    payload ? [Buffer.from(payload, 'utf8')] : [],
  ) as unknown as import('node:http').IncomingMessage & EventEmitter;
  req.method = method;
  req.url = url;
  return req;
}

/** Build a fake ServerResponse that records everything the router writes. */
function fakeRes(): { res: import('node:http').ServerResponse; captured: CapturedRes } {
  const captured: CapturedRes = {
    status: 0,
    headers: {},
    body: '',
    json() {
      return JSON.parse(this.body);
    },
    ndjson() {
      return this.body
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l));
    },
  };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      if (headers) for (const [k, v] of Object.entries(headers)) captured.headers[k] = v;
      return this;
    },
    write(chunk: string) {
      captured.body += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk) captured.body += chunk;
      return this;
    },
  } as unknown as import('node:http').ServerResponse;
  return { res, captured };
}

/** A fake adapter yielding a scripted message stream — no CLI involved. */
function fakeAdapter(name: string, messages: AgentMessage[]): AgentAdapter {
  return {
    name,
    async *run(_prompt: string, _options?: RunOptions): AsyncGenerator<AgentMessage> {
      for (const m of messages) yield m;
    },
  };
}

/** Drive the router once with injected deps, return the captured response. */
async function call(
  deps: RouteDeps,
  method: string,
  url: string,
  body?: unknown,
): Promise<CapturedRes> {
  const { res, captured } = fakeRes();
  await route(fakeReq(method, url, body), res, deps);
  return captured;
}

/** A throwaway thread store in a temp dir; caller removes the dir. */
async function tempStore(): Promise<{ store: ThreadStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'bai-srv-'));
  return { store: new ThreadStore(join(dir, 'threads')), dir };
}

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bai-srv-git-'));
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@bai.local');
  run('config', 'user.name', 'BAi Test');
  run('config', 'commit.gpgsign', 'false');
  return dir;
}

// ---- thread endpoints ------------------------------------------------------

test('POST /api/threads creates a thread (201) and GET lists it', async () => {
  const { store, dir } = await tempStore();
  try {
    const orch = new Orchestrator(store, {});
    const deps: RouteDeps = { store, orch };

    const created = await call(deps, 'POST', '/api/threads', { title: 'my task' });
    assert.equal(created.status, 201);
    const thread = created.json() as { id: string; title: string };
    assert.equal(thread.title, 'my task');
    assert.ok(thread.id);

    const listed = await call(deps, 'GET', '/api/threads');
    assert.equal(listed.status, 200);
    const threads = listed.json() as Array<{ id: string }>;
    assert.equal(threads.length, 1);
    assert.equal(threads[0]?.id, thread.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('GET /api/threads/:id returns 404 for an unknown id', async () => {
  const { store, dir } = await tempStore();
  try {
    const deps: RouteDeps = { store, orch: new Orchestrator(store, {}) };
    const res = await call(deps, 'GET', '/api/threads/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(res.json(), { error: 'not found' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST /api/threads/:id/send routes to the @mentioned agent', async () => {
  const { store, dir } = await tempStore();
  try {
    const orch = new Orchestrator(store, {
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'on it' },
        { type: 'result', agent: 'claude', ok: true },
      ]),
    });
    const deps: RouteDeps = { store, orch };
    const thread = (await call(deps, 'POST', '/api/threads', { title: 't' }).then((r) =>
      r.json(),
    )) as { id: string };

    const res = await call(deps, 'POST', `/api/threads/${thread.id}/send`, {
      message: '@claude do the thing',
    });
    assert.equal(res.status, 200);
    const { result } = res.json() as { result: { ran: string[] } };
    assert.deepEqual(result.ran, ['claude']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST /api/threads/:id/send rejects an empty message (400)', async () => {
  const { store, dir } = await tempStore();
  try {
    const deps: RouteDeps = { store, orch: new Orchestrator(store, {}) };
    const thread = (await call(deps, 'POST', '/api/threads', { title: 't' }).then((r) =>
      r.json(),
    )) as { id: string };
    const res = await call(deps, 'POST', `/api/threads/${thread.id}/send`, { message: '   ' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json(), { error: 'message required' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST /api/threads/:id/stream emits NDJSON dispatch events', async () => {
  const { store, dir } = await tempStore();
  try {
    const orch = new Orchestrator(store, {
      claude: fakeAdapter('claude', [
        { type: 'text', agent: 'claude', text: 'streaming' },
        { type: 'result', agent: 'claude', ok: true },
      ]),
    });
    const deps: RouteDeps = { store, orch };
    const thread = (await call(deps, 'POST', '/api/threads', { title: 't' }).then((r) =>
      r.json(),
    )) as { id: string };

    const res = await call(deps, 'POST', `/api/threads/${thread.id}/stream`, {
      message: '@claude go',
    });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] ?? '', /ndjson/);
    const events = res.ndjson() as Array<{ kind: string }>;
    const kinds = events.map((e) => e.kind);
    assert.ok(kinds.includes('agent_start'), 'expected an agent_start event');
    assert.ok(kinds.includes('done'), 'expected a terminal done event');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- git endpoints (live, against a throwaway repo) ------------------------

test('GET /api/git/status reports a changed file', { skip: !gitAvailable() }, async () => {
  const { store, dir } = await tempStore();
  const repo = makeRepo();
  try {
    writeFileSync(join(repo, 'a.txt'), 'hello\n');
    const deps: RouteDeps = { store, orch: new Orchestrator(store, {}), gitCwd: repo };

    const res = await call(deps, 'GET', '/api/git/status');
    assert.equal(res.status, 200);
    const status = res.json() as { repo: boolean; files: Array<{ path: string }> };
    assert.equal(status.repo, true);
    assert.equal(status.files.length, 1);
    assert.equal(status.files[0]?.path, 'a.txt');
  } finally {
    await rm(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('git stage → commit round-trips through the endpoints', {
  skip: !gitAvailable(),
}, async () => {
  const { store, dir } = await tempStore();
  const repo = makeRepo();
  try {
    writeFileSync(join(repo, 'a.txt'), 'hello\n');
    const deps: RouteDeps = { store, orch: new Orchestrator(store, {}), gitCwd: repo };

    const staged = await call(deps, 'POST', '/api/git/stage', { files: ['a.txt'] });
    assert.equal(staged.status, 200);
    assert.equal((staged.json() as { ok: boolean }).ok, true);

    const committed = await call(deps, 'POST', '/api/git/commit', { message: 'add a.txt' });
    assert.equal(committed.status, 200);
    const body = committed.json() as { ok: boolean; committed?: string };
    assert.equal(body.ok, true);
    assert.match(body.committed ?? '', /add a\.txt/);

    // Tree is clean afterwards.
    const status = await call(deps, 'GET', '/api/git/status');
    assert.equal((status.json() as { files: unknown[] }).files.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('POST /api/git/stage rejects a non-array files body (400)', async () => {
  const { store, dir } = await tempStore();
  try {
    const deps: RouteDeps = { store, orch: new Orchestrator(store, {}) };
    const res = await call(deps, 'POST', '/api/git/stage', { files: 'a.txt' });
    assert.equal(res.status, 400);
    assert.match((res.json() as { error: string }).error, /files: string\[\] required/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST /api/git/commit rejects an empty message (400)', async () => {
  const { store, dir } = await tempStore();
  try {
    const deps: RouteDeps = { store, orch: new Orchestrator(store, {}) };
    const res = await call(deps, 'POST', '/api/git/commit', { message: '' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json(), { error: 'message required' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('git stage refuses a path git does not report as changed', {
  skip: !gitAvailable(),
}, async () => {
  const { store, dir } = await tempStore();
  const repo = makeRepo();
  try {
    writeFileSync(join(repo, 'real.txt'), 'x\n');
    const deps: RouteDeps = { store, orch: new Orchestrator(store, {}), gitCwd: repo };
    // The endpoint returns 200 with ok:false — the guard is in the git layer,
    // not an HTTP-level rejection. Either way an arbitrary path can't be staged.
    const res = await call(deps, 'POST', '/api/git/stage', { files: ['../escape.txt'] });
    assert.equal(res.status, 200);
    const body = res.json() as { ok: boolean; error?: string };
    assert.equal(body.ok, false);
    assert.match(body.error ?? '', /not a changed file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('POST /api/threads/:id/review rejects a clean tree (400)', {
  skip: !gitAvailable(),
}, async () => {
  const { store, dir } = await tempStore();
  const repo = makeRepo();
  try {
    const deps: RouteDeps = { store, orch: new Orchestrator(store, {}), gitCwd: repo };
    const thread = (await call(deps, 'POST', '/api/threads', { title: 't' }).then((r) =>
      r.json(),
    )) as { id: string };
    const res = await call(deps, 'POST', `/api/threads/${thread.id}/review`);
    assert.equal(res.status, 400);
    assert.match((res.json() as { error: string }).error, /working tree clean/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('unknown route returns 404', async () => {
  const { store, dir } = await tempStore();
  try {
    const deps: RouteDeps = { store, orch: new Orchestrator(store, {}) };
    const res = await call(deps, 'GET', '/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.deepEqual(res.json(), { error: 'not found' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
