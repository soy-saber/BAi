/**
 * BAi — entry point.
 *
 * Stage 1: a minimal CLI demo. Pass a prompt, watch Claude actually execute it,
 * and see every message printed in our unified format.
 *
 *   npm run build && node dist/index.js "list the files here"
 *   npm run dev -- "list the files here"
 */

import { runClaude } from './adapters/claude.js';

function render(message: import('./types.js').AgentMessage): void {
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
  const prompt = process.argv.slice(2).join(' ').trim();
  if (!prompt) {
    console.error('Usage: bai "<prompt>"');
    process.exitCode = 1;
    return;
  }

  console.log(`> ${prompt}`);
  for await (const message of runClaude(prompt)) {
    render(message);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
