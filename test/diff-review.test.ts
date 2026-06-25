import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffReviewPipeline, type StageResult } from '../src/routing/pipeline.ts';

test('diffReviewPipeline wires review (claude) → gatekeep (codex) with opencode fallback', () => {
  const stages = diffReviewPipeline();
  assert.equal(stages.length, 2);
  assert.equal(stages[0]?.name, 'review');
  assert.equal(stages[0]?.primary, 'claude');
  assert.equal(stages[1]?.name, 'gatekeep');
  assert.equal(stages[1]?.primary, 'codex');
  assert.deepEqual(stages[1]?.fallbacks, ['opencode']);
});

test('agent ids are overridable so the pipeline is not bound to specific adapters', () => {
  const stages = diffReviewPipeline({
    reviewer: 'gemini',
    gatekeeper: 'opencode',
    gatekeeperFallback: 'claude',
  });
  assert.equal(stages[0]?.primary, 'gemini');
  assert.equal(stages[1]?.primary, 'opencode');
  assert.deepEqual(stages[1]?.fallbacks, ['claude']);
});

test('the review prompt scopes to the change and embeds the diff', () => {
  const stages = diffReviewPipeline();
  const diff = '@@ -1,3 +1,3 @@\n-const x = 1;\n+const x = 2;';
  const prompt = stages[0]?.buildPrompt(diff, []) ?? '';
  // It must review the CHANGE, asking about correctness/regressions, not "list bugs".
  assert.match(prompt, /correctness/i);
  assert.match(prompt, /regression/i);
  assert.match(prompt, /unified diff/i);
  // The diff is embedded so the reviewer sees the actual change.
  assert.match(prompt, /const x = 2;/);
});

test('the gatekeep prompt embeds the review and asks for a ship/hold verdict', () => {
  const stages = diffReviewPipeline();
  const prior: StageResult[] = [
    {
      stage: 'review',
      agent: 'claude',
      text: 'blocker: the new condition inverts the guard at server.ts:42',
      ok: true,
      failedOver: [],
    },
  ];
  const prompt = stages[1]?.buildPrompt('DIFF', prior) ?? '';
  // The gatekeeper judges the actual review, not a fresh one.
  assert.match(prompt, /inverts the guard/);
  // It must decide ship/hold and weigh the reviewer's objections.
  assert.match(prompt, /VERDICT: ship/);
  assert.match(prompt, /hold/);
  assert.match(prompt, /overstated/i);
  // It names who produced the review.
  assert.match(prompt, /claude/);
});

test('the gatekeep prompt degrades gracefully when the review stage produced nothing', () => {
  const stages = diffReviewPipeline();
  const prompt = stages[1]?.buildPrompt('DIFF', []) ?? '';
  assert.match(prompt, /no review produced/i);
});
