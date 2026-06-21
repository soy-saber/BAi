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
import type { AdapterRegistry } from './routing/orchestrator.js';
import { Orchestrator } from './routing/orchestrator.js';
import { type MemoryKind, MemoryStore } from './store/memory-store.js';
import { ThreadStore } from './store/thread-store.js';
import type { AgentMessage } from './types.js';

const ADAPTERS: AdapterRegistry = { claude: claudeAdapter, codex: codexAdapter };

function render(message: AgentMessage): void {
  switch (message.type) {
    case 'text':
      console.log(`\n[${message.agent}] ${message.text}`);
      break;
    case 'tool_use':
      console.log(`  ↳ (${message.agent}) tool: ${message.tool} ${JSON.stringify(message.input)}`);
      break;
    case 'result':
      if (message.ok) {
        console.log(`\n[${message.agent}] ✓ done${message.text ? `: ${message.text}` : ''}`);
      } else {
        console.error(`\n[${message.agent}] ✗ failed: ${message.error ?? 'unknown error'}`);
      }
      break;
  }
}

const USAGE = `Usage:
  bai new "<title>"                 create a thread
  bai threads                       list threads
  bai show <threadId>               print a thread transcript
  bai send <threadId> "<message>"   route to @mentioned agents (${Object.keys(ADAPTERS).join(', ')})
  bai remember <decision|lesson> <agent> "<text>"   record team memory
  bai memory ["<query>"]            recall memory (most recent if no query)`;

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
      const orch = new Orchestrator(store, ADAPTERS, {}, new MemoryStore());
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
