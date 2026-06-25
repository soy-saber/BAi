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

import { buildRegistry } from './adapters/registry.js';
import type { GameEvent } from './game/runner.js';
import { render as renderBoard } from './game/tictactoe.js';
import { gitDiff } from './git.js';
import type { DispatchEvent } from './routing/orchestrator.js';
import { Orchestrator } from './routing/orchestrator.js';
import {
  auditPipeline,
  diffReviewPipeline,
  type PipelineEvent,
  runPipeline,
  securityAuditPipeline,
} from './routing/pipeline.js';
import { type MemoryKind, MemoryStore } from './store/memory-store.js';
import { ThreadStore } from './store/thread-store.js';

const ADAPTERS = buildRegistry();

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
    case 'routed':
      console.log(`(no @mention — routed to @${event.agent} by capability)`);
      break;
    case 'no_tools':
      console.error(
        `  ⚠ ${event.agent} ran as a tool-capable agent but called no tools — it may be ` +
          `chat-only. Consider BAI_CHAT_AGENTS=${event.agent} to feed it files instead.`,
      );
      break;
    case 'done':
      if (event.noMatch) console.log('(no @mention and no capability match — nothing dispatched)');
      break;
  }
}

/** Render an audit-pipeline event to the terminal. */
function renderPipeline(event: PipelineEvent): void {
  if (event.stage_start) {
    console.log(`\n=== stage: ${event.stage_start.stage} — ${event.stage_start.agent} ===`);
  } else if (event.fallback) {
    const { stage, from, to, reason } = event.fallback;
    console.error(`  ⚠ [${stage}] ${from} failed (${reason}) → falling back to ${to}`);
  } else if (event.stage_end) {
    const r = event.stage_end;
    const over = r.failedOver.length ? ` (after ${r.failedOver.join(', ')} failed)` : '';
    if (r.ok) console.log(`--- ${r.stage}: done by ${r.agent}${over} ---`);
    else console.error(`--- ${r.stage}: EXHAUSTED — tried ${r.failedOver.join(', ')} ---`);
  }
}

/** Render a tic-tac-toe game event to the terminal. */
function renderGame(event: GameEvent): void {
  if (event.kind === 'turn_start') {
    console.log(`\n${event.player} (${event.agent}) to move:`);
    console.log(renderBoard(event.board));
  } else if (event.kind === 'illegal') {
    console.error(`  ⚠ ${event.player} (${event.agent}) illegal: ${event.reason} — re-prompting`);
  } else if (event.kind === 'move') {
    console.log(`  → ${event.player} (${event.agent}) plays cell ${event.cell}`);
  } else if (event.kind === 'game_end') {
    const r = event.report;
    console.log(`\nFinal board:\n${renderBoard(r.board)}`);
    if (r.result.kind === 'win') {
      console.log(`\n${r.result.player} (${r.result.agent}) wins.`);
    } else if (r.result.kind === 'draw') {
      console.log('\nDraw.');
    } else {
      console.log(`\n${r.result.player} (${r.result.agent}) forfeits: ${r.result.reason}`);
    }
  }
}

const USAGE = `Usage:
  bai new "<title>"                 create a thread
  bai threads                       list threads
  bai show <threadId>               print a thread transcript
  bai send <threadId> "<message>"   route to @mentioned agents (${Object.keys(ADAPTERS).join(', ')})
  bai remember <decision|lesson> <agent> "<text>"   record team memory
  bai memory ["<query>"]            recall memory (most recent if no query)
  bai retrospect <agent>            distill recent memory into insights
  bai audit <threadId> "<target>"   run the audit pipeline (claude → codex/opencode gatekeep)
  bai secaudit <threadId> "<target>"   security audit: claude finds vuln flows → codex/opencode verifies each
  bai review <threadId> [file]      review the working-tree diff (claude reviews → codex/opencode gatekeeps ship/hold)
  bai play <agentX> <agentO>        play tic-tac-toe: two agents, a deterministic referee
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
      if (result.noMatch) console.log('(no @mention and no capability match — nothing dispatched)');
      break;
    }
    case 'audit': {
      const [threadId, ...words] = rest;
      const target = words.join(' ').trim();
      if (!threadId || !target) {
        return fail('Usage: bai audit <threadId> "<file path or description to audit>"');
      }
      const orch = new Orchestrator(store, ADAPTERS, { memory: new MemoryStore() });
      console.log(`> audit: ${target}`);
      const results = await runPipeline(orch, threadId, target, auditPipeline(), {
        onEvent: render,
        onPipelineEvent: renderPipeline,
      });
      const last = results[results.length - 1];
      if (!last?.ok) {
        console.error('\naudit pipeline did not complete (a stage exhausted its agents).');
        process.exitCode = 1;
      } else {
        console.log('\naudit pipeline complete.');
      }
      break;
    }
    case 'secaudit': {
      const [threadId, ...words] = rest;
      const target = words.join(' ').trim();
      if (!threadId || !target) {
        return fail(
          'Usage: bai secaudit <threadId> "<target — describe the code, with @file: refs>"',
        );
      }
      const orch = new Orchestrator(store, ADAPTERS, { memory: new MemoryStore() });
      console.log(`> security audit: ${target}`);
      const results = await runPipeline(orch, threadId, target, securityAuditPipeline(), {
        onEvent: render,
        onPipelineEvent: renderPipeline,
      });
      const last = results[results.length - 1];
      if (!last?.ok) {
        console.error('\nsecurity audit did not complete (a stage exhausted its agents).');
        process.exitCode = 1;
      } else {
        console.log('\nsecurity audit complete.');
      }
      break;
    }
    case 'review': {
      // Review the working-tree diff: reviewer judges the change, a gatekeeper
      // decides ship/hold. The diff is read here (not by the agents) so the
      // change travels in the prompt — a chat-only reviewer sees it inline.
      const [threadId, file] = rest;
      if (!threadId) {
        return fail('Usage: bai review <threadId> [file]   review the working-tree diff');
      }
      const { diff, untracked } = await gitDiff(file);
      if (untracked) {
        return fail(`${file} is untracked — nothing to diff. Stage or commit a baseline first.`);
      }
      if (!diff.trim()) {
        console.log(file ? `(no changes in ${file})` : '(working tree clean — nothing to review)');
        break;
      }
      const target = file ? `Changes to ${file}:\n\n${diff}` : diff;
      const orch = new Orchestrator(store, ADAPTERS, { memory: new MemoryStore() });
      console.log(`> review diff${file ? `: ${file}` : ' (working tree)'}`);
      const results = await runPipeline(orch, threadId, target, diffReviewPipeline(), {
        onEvent: render,
        onPipelineEvent: renderPipeline,
      });
      const last = results[results.length - 1];
      if (!last?.ok) {
        console.error('\ndiff review did not complete (a stage exhausted its agents).');
        process.exitCode = 1;
      } else {
        console.log('\ndiff review complete.');
      }
      break;
    }
    case 'play': {
      const [xName, oName] = rest;
      const x = xName ? ADAPTERS[xName] : undefined;
      const o = oName ? ADAPTERS[oName] : undefined;
      if (!x || !o) {
        return fail(
          `Usage: bai play <X-agent> <O-agent>  (agents: ${Object.keys(ADAPTERS).join(', ')})`,
        );
      }
      const { playGame } = await import('./game/runner.js');
      console.log(`> tic-tac-toe: ${xName} (X) vs ${oName} (O)\n`);
      // renderGame prints the final board and outcome on the game_end event.
      const report = await playGame({ X: x, O: o }, { onEvent: renderGame });
      if (report.result.kind === 'forfeit') process.exitCode = 1;
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
    case 'retrospect': {
      const agentName = rest[0];
      const adapter = agentName ? ADAPTERS[agentName] : undefined;
      if (!adapter) {
        return fail(`Usage: bai retrospect <${Object.keys(ADAPTERS).join('|')}>`);
      }
      const { runRetrospect } = await import('./identity/retrospect.js');
      const result = await runRetrospect(adapter, new MemoryStore());
      console.log(`reviewed ${result.reviewed} memories`);
      if (result.insights.length === 0) console.log('(no new insights distilled)');
      for (const text of result.insights) console.log(`  + insight: ${text}`);
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
