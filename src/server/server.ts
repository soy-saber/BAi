/**
 * Minimal HTTP server for the BAi web UI.
 *
 * Deliberately dependency-free: Node's built-in `http` module, a tiny JSON API,
 * and one static HTML page. The UI is a thin shell over the same Orchestrator
 * and stores the CLI uses — all the real logic lives below this layer.
 *
 * SECURITY: this binds to localhost and has no authentication. It can spawn
 * agent CLIs that edit files and run commands in the working directory. Do not
 * expose it on a public interface.
 *
 * Endpoints:
 *   GET  /                      -> the chat page
 *   GET  /api/threads           -> list threads
 *   POST /api/threads           -> { title } create a thread
 *   GET  /api/threads/:id       -> one thread (with entries)
 *   POST /api/threads/:id/send  -> { message } route to @mentioned agents
 *   POST /api/threads/:id/stream-> { message } same, but streams live
 *                                  dispatch events as newline-delimited JSON
 *   GET  /api/git/status        -> working-tree changes (porcelain, parsed)
 *   GET  /api/git/diff?file=    -> unified diff for one file (or the whole tree)
 *   POST /api/git/stage         -> { files } `git add` changed paths
 *   POST /api/git/unstage       -> { files } `git restore --staged` paths
 *   POST /api/git/commit        -> { message } commit the staged index
 *
 * The git reads (status/diff) are side-effect free. The writes stage/unstage and
 * commit, but only ever act on paths git already reports as changed, and only
 * the staged index — no push, reset, checkout, or other destructive op lives
 * here; those stay a deliberate, out-of-band manual decision (see ADR 0024).
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from '../adapters/registry.js';
import { gitCommit, gitDiff, gitStage, gitStatus, gitUnstage } from '../git.js';
import { IDENTITIES } from '../identity/identity.js';
import { Orchestrator } from '../routing/orchestrator.js';
import { diffReviewPipeline, runPipeline, securityAuditPipeline } from '../routing/pipeline.js';
import { MemoryStore } from '../store/memory-store.js';
import { ThreadStore } from '../store/thread-store.js';

const ADAPTERS = buildRegistry();
const HERE = dirname(fileURLToPath(import.meta.url));

async function readJson(
  req: import('node:http').IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function send(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json);
}

export function startServer(port = 3003): import('node:http').Server {
  const store = new ThreadStore();
  // A generous per-turn timeout so a hung CLI can't wedge a turn forever, while
  // leaving room for legitimately slow turns (rate-limit waits, long tool runs).
  const timeoutMs = Number(process.env.BAI_TURN_TIMEOUT_MS) || 10 * 60 * 1000;
  const orch = new Orchestrator(store, ADAPTERS, {
    memory: new MemoryStore(),
    runOptions: { timeoutMs },
  });

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, store, orch);
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`BAi UI on http://localhost:${port}`);
  });
  return server;
}

async function route(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  store: ThreadStore,
  orch: Orchestrator,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/') {
    const html = await readFile(join(HERE, 'index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (method === 'GET' && path === '/app.js') {
    const js = await readFile(join(HERE, 'app.js'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(js);
    return;
  }

  if (method === 'GET' && path === '/api/agents') {
    // The agents the UI can @mention, with the metadata its autocomplete and
    // legend need (id, display name, role, strengths). Sourced from the same
    // identities the orchestrator uses, filtered to those with a live adapter.
    const agents = Object.keys(ADAPTERS).map((id) => {
      const identity = IDENTITIES[id];
      return {
        id,
        name: identity?.name ?? id,
        role: identity?.role ?? '',
        strengths: identity?.strengths ?? [],
      };
    });
    return send(res, 200, agents);
  }

  if (method === 'GET' && path === '/api/git/status') {
    // Read-only: what has changed in the working tree right now. Lets the UI
    // show "what did the agents touch" without the operator leaving the page.
    const status = await gitStatus();
    return send(res, 200, status);
  }

  if (method === 'GET' && path === '/api/git/diff') {
    // Unified diff for one file (?file=path) or the whole tree when omitted.
    // The file is passed to `git diff -- <file>` as a separate argv after `--`,
    // so it can't be read as a flag; git also confines it to the repo.
    const file = url.searchParams.get('file') ?? undefined;
    const diff = await gitDiff(file);
    return send(res, 200, diff);
  }

  // Git writes. Each is triggered only by an explicit UI click and acts solely
  // on paths git already reports as changed (gitStage/gitUnstage validate; the
  // commit only touches the staged index). No push, reset, or destructive op
  // lives here — those stay a manual, out-of-band decision.
  if (method === 'POST' && path === '/api/git/stage') {
    const { files } = await readJson(req);
    if (!Array.isArray(files) || files.some((f) => typeof f !== 'string')) {
      return send(res, 400, { error: 'files: string[] required' });
    }
    return send(res, 200, await gitStage(files as string[]));
  }

  if (method === 'POST' && path === '/api/git/unstage') {
    const { files } = await readJson(req);
    if (!Array.isArray(files) || files.some((f) => typeof f !== 'string')) {
      return send(res, 400, { error: 'files: string[] required' });
    }
    return send(res, 200, await gitUnstage(files as string[]));
  }

  if (method === 'POST' && path === '/api/git/commit') {
    const { message } = await readJson(req);
    if (typeof message !== 'string' || !message.trim()) {
      return send(res, 400, { error: 'message required' });
    }
    return send(res, 200, await gitCommit(message.trim()));
  }

  if (method === 'GET' && path === '/api/threads') {
    return send(res, 200, await store.list());
  }

  if (method === 'POST' && path === '/api/threads') {
    const { title } = await readJson(req);
    const thread = await store.create(typeof title === 'string' && title ? title : 'untitled');
    return send(res, 201, thread);
  }

  const showMatch = path.match(/^\/api\/threads\/([^/]+)$/);
  if (method === 'GET' && showMatch) {
    const thread = await store.get(showMatch[1] ?? '');
    return thread ? send(res, 200, thread) : send(res, 404, { error: 'not found' });
  }

  const sendMatch = path.match(/^\/api\/threads\/([^/]+)\/send$/);
  if (method === 'POST' && sendMatch) {
    const { message } = await readJson(req);
    if (typeof message !== 'string' || !message.trim()) {
      return send(res, 400, { error: 'message required' });
    }
    const result = await orch.dispatch(sendMatch[1] ?? '', message.trim());
    const thread = await store.get(sendMatch[1] ?? '');
    return send(res, 200, { result, thread });
  }

  const streamMatch = path.match(/^\/api\/threads\/([^/]+)\/stream$/);
  if (method === 'POST' && streamMatch) {
    const { message } = await readJson(req);
    if (typeof message !== 'string' || !message.trim()) {
      return send(res, 400, { error: 'message required' });
    }
    // Newline-delimited JSON: one dispatch event per line, flushed as it
    // happens, so the browser sees "agent working / streaming / done / failed"
    // in real time instead of waiting for the whole turn to finish.
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
    });
    // Cancel the turn if the client disconnects (e.g. the UI "stop" button
    // aborts the fetch, which closes the request).
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    await orch.dispatch(
      streamMatch[1] ?? '',
      message.trim(),
      (event) => {
        res.write(`${JSON.stringify(event)}\n`);
      },
      ac.signal,
    );
    res.end();
    return;
  }

  const auditMatch = path.match(/^\/api\/threads\/([^/]+)\/audit$/);
  if (method === 'POST' && auditMatch) {
    const { target } = await readJson(req);
    if (typeof target !== 'string' || !target.trim()) {
      return send(res, 400, { error: 'target required' });
    }
    // Same NDJSON streaming as /stream, but the events are a mix of dispatch
    // lifecycle events (per-agent, from each stage's turn) and pipeline events
    // (stage_start / fallback / stage_end). The UI's handleEvent renders both.
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
    });
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    await runPipeline(orch, auditMatch[1] ?? '', target.trim(), securityAuditPipeline(), {
      onEvent: (event) => res.write(`${JSON.stringify(event)}\n`),
      onPipelineEvent: (event) => res.write(`${JSON.stringify({ kind: 'pipeline', ...event })}\n`),
      signal: ac.signal,
    });
    res.end();
    return;
  }

  const reviewMatch = path.match(/^\/api\/threads\/([^/]+)\/review$/);
  if (method === 'POST' && reviewMatch) {
    // Review the working-tree diff: read it here (optionally for one ?file=),
    // then run the reviewer → gatekeeper pipeline over it. The diff travels in
    // the prompt so a chat-only reviewer sees the change inline. Streams the
    // same NDJSON dispatch + pipeline events as /audit.
    const file = url.searchParams.get('file') ?? undefined;
    const { diff, untracked } = await gitDiff(file);
    if (untracked) {
      return send(res, 400, { error: `${file} is untracked — stage a baseline first` });
    }
    if (!diff.trim()) {
      return send(res, 400, { error: file ? `no changes in ${file}` : 'working tree clean' });
    }
    const target = file ? `Changes to ${file}:\n\n${diff}` : diff;
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
    });
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    await runPipeline(orch, reviewMatch[1] ?? '', target, diffReviewPipeline(), {
      onEvent: (event) => res.write(`${JSON.stringify(event)}\n`),
      onPipelineEvent: (event) => res.write(`${JSON.stringify({ kind: 'pipeline', ...event })}\n`),
      signal: ac.signal,
    });
    res.end();
    return;
  }

  send(res, 404, { error: 'not found' });
}
