/**
 * BAi — entry point.
 *
 * Stage 2: route a prompt to a chosen agent, both behind one AgentAdapter
 * interface. The two CLIs have completely different native output formats, yet
 * everything below prints in BAi's unified AgentMessage form.
 *
 *   npm run build && node dist/index.js claude "list the files here"
 *   node dist/index.js codex "create a file hello.txt with: hi"
 *   npm run dev -- codex "what is in this directory?"
 */

import type { AgentAdapter } from './adapters/adapter.js';
import { claudeAdapter } from './adapters/claude.js';
import { codexAdapter } from './adapters/codex.js';
import type { AgentMessage } from './types.js';

const ADAPTERS: Record<string, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

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

async function main(): Promise<void> {
  const [agentName, ...rest] = process.argv.slice(2);
  const prompt = rest.join(' ').trim();
  const adapter = agentName ? ADAPTERS[agentName] : undefined;

  if (!adapter || !prompt) {
    console.error(`Usage: bai <${Object.keys(ADAPTERS).join('|')}> "<prompt>"`);
    process.exitCode = 1;
    return;
  }

  console.log(`> [${adapter.name}] ${prompt}`);
  for await (const message of adapter.run(prompt)) {
    render(message);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
