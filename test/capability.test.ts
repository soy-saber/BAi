import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Identity } from '../src/identity/identity.ts';
import { pickAgent, rankAgents } from '../src/routing/capability.ts';

/** Two identities with clearly different strengths, for routing tests. */
const IDS: Identity[] = [
  {
    agent: 'claude',
    name: 'Ragdoll',
    role: 'architect',
    persona: '',
    strengths: ['architecture', 'implementation', 'refactoring', 'writing'],
  },
  {
    agent: 'codex',
    name: 'Maine Coon',
    role: 'reviewer',
    persona: '',
    strengths: ['code review', 'testing', 'finding bugs', 'verification'],
  },
];

test('rankAgents scores the better-matching agent higher', () => {
  const ranked = rankAgents('please review this code and find bugs', IDS);
  assert.equal(ranked[0]?.agent, 'codex');
  assert.ok((ranked[0]?.score ?? 0) > (ranked[1]?.score ?? 0));
});

test('rankAgents returns every agent, even zero-score ones', () => {
  const ranked = rankAgents('write a refactoring plan', IDS);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.agent, 'claude'); // refactoring + writing both hit
});

test('pickAgent picks the best match for a task', () => {
  assert.equal(pickAgent('refactor the architecture', IDS), 'claude');
  assert.equal(pickAgent('add testing and verification', IDS), 'codex');
});

test('pickAgent returns undefined when nothing matches', () => {
  // No task term overlaps any strength → no guess.
  assert.equal(pickAgent('order a pizza for lunch', IDS), undefined);
});

test('pickAgent is stable on a tie (first by agent id)', () => {
  // A task that hits exactly one strength of each agent equally.
  // "implementation" hits claude, "testing" hits codex → 1-1 tie.
  const pick = pickAgent('implementation and testing', IDS);
  // Tie broken by localeCompare: 'claude' < 'codex'.
  assert.equal(pick, 'claude');
});

test('routing ignores stopwords (no spurious matches)', () => {
  // Only stopwords + a non-strength word: no real overlap.
  assert.equal(pickAgent('can you do the thing for me', IDS), undefined);
});

test('whole-word matching: "test" does not match "latest"', () => {
  const ids: Identity[] = [
    { agent: 'a', name: 'A', role: '', persona: '', strengths: ['latest releases'] },
  ];
  assert.equal(pickAgent('write a test', ids), undefined);
});
