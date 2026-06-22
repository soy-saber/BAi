/**
 * The default agent registry, with retry wrapping applied.
 *
 * One place that knows which CLIs exist and that every one of them should be
 * wrapped with transient-failure retries. Both the CLI and the web server build
 * their registry from here so they can't drift.
 */

import type { AgentAdapter } from './adapter.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import { type RetryOptions, withRetry } from './retry.js';

export type AdapterRegistry = Record<string, AgentAdapter>;
/** Build the standard registry, wrapping each adapter with retry. */
export function buildRegistry(retry: RetryOptions = {}): AdapterRegistry {
  const base = [claudeAdapter, codexAdapter, opencodeAdapter];
  const registry: AdapterRegistry = {};
  for (const adapter of base) {
    registry[adapter.name] = withRetry(adapter, retry);
  }
  return registry;
}
