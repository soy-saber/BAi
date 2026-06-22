/**
 * BAi — entry point.
 *
 * Stage 3: threaded, @mention-routed collaboration.
 *
 *   bai new "<title>"                 create a thread, prints its id
 *   bai threads                       list threads
 *   bai show <threadId>               print a thread transcript
 *   bai send <threadId> "<message>"   route a message to @mentioned agents
 *
 * A message addresses agents with @mentions:
 *   bai send <id> "@claude design the API, then @codex review it"
 */

import { claudeAdapter } from './adapters/claude.js';
import { codexAdapter } from './adapters/codex.js';
import { opencodeAdapter } from './adapters/opencode.js';
import type { AdapterRegistry, DispatchEvent } from './routing/orchestrator.js';
import { Orchestrator } from './routing/orchestrator.js';
import { type MemoryKind, MemoryStore } from './store/memory-store.js';
import { ThreadStore } from './store/thread-store.js';

const ADAPTERS: AdapterRegistry = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
};

/** Render a dispatch lifecycle event to the terminal in real time. */
function render(event: DispatchEvent): void {
  switch (event.kind) {
    case 'agent_start':
      console.log(`\n[${event.agent}] …working (hop ${event.hop})`);
      break;
    case 'message': {
      const m = event.message;
      if (m.type === 'text') {
        console.log(`[${m.agent}] ${m.text}`);
      } else if (m.type === 'tool_use') {
        console.log(`  ↳ (${m.agent}) tool: ${m.tool} ${JSON.stringify(m.input)}`);
      } else if (m.type === 'result' && !m.ok) {
        console.error(`  ↳ (${m.agent}) error: ${m.error ?? 'unknown'}`);
      }
      break;
    }
    case 'agent_end':
      if (event.ok) console.log(`[${event.agent}] ✓ done`);
      else console.error(`[${event.agent}] ✗ failed`);
      break;
    case 'done':
      if (event.noMatch) console.log('(no known @mention — nothing dispatched)');
      break;
  }
}

const USAGE = `Usage:
  bai new "<title>"                 create a thread
  bai threads                       list threads
  bai show <threadId>               print a thread transcript
  bai send <threadId> "<message>"   route to @mentioned agents (${Object.keys(ADAPTERS).join(', ')})
  bai remember <decision|lesson> <agent> "<text>"   record team memory
  bai memory ["<query>"]            recall memory (most recent if no query)
  bai serve [port]                  start the web UI (default http://localhost:3003)`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const store = new ThreadStore();

  switch (command) {
    case 'new': {
      const thread = await store.create(rest.join(' ').trim() || 'untitled');
      console.log(`created thread ${thread.id} — ${thread.title}`);
      break;
    }
    case 'threads': {
      const threads = await store.list();
      if (threads.length === 0) console.log('(no threads yet)');
      for (const t of threads) console.log(`${t.id}  ${t.title}  (${t.entries.length} entries)`);
      break;
    }
    case 'show': {
      const thread = await store.get(rest[0] ?? '');
      if (!thread) return fail(`thread not found: ${rest[0]}`);
      console.log(`# ${thread.title} (${thread.id})\n`);
      for (const e of thread.entries) {
        const who = e.role === 'user' ? 'you' : (e.agent ?? 'agent');
        console.log(`[${who}] ${e.text}\n`);
      }
      break;
    }
    case 'send': {
      const [threadId, ...words] = rest;
      const message = words.join(' ').trim();
      if (!threadId || !message) return fail(USAGE);
      const orch = new Orchestrator(store, ADAPTERS, { memory: new MemoryStore() });
      console.log(`> ${message}`);
      const result = await orch.dispatch(threadId, message, render);
      if (result.noMatch) console.log('(no known @mention — nothing dispatched)');
      break;
    }
    case 'remember': {
      const [kind, agent, ...words] = rest;
      const text = words.join(' ').trim();
      if ((kind !== 'decision' && kind !== 'lesson') || !agent || !text) {
        return fail('Usage: bai remember <decision|lesson> <agent> "<text>"');
      }
      const memory = await new MemoryStore().record(kind as MemoryKind, agent, text);
      console.log(`recorded ${memory.kind} ${memory.id}`);
      break;
    }
    case 'memory': {
      const query = rest.join(' ').trim();
      const memories = await new MemoryStore().recall(query);
      if (memories.length === 0) console.log('(no matching memory)');
      for (const m of memories) console.log(`${m.id}  (${m.kind}/${m.agent})  ${m.text}`);
      break;
    }
    case 'serve': {
      const port = Number(rest[0]) || 3003;
      const { startServer } = await import('./server/server.js');
      startServer(port);
      break;
    }
    default:
      return fail(USAGE);
  }
}

function fail(msg: string): void {
  console.error(msg);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
