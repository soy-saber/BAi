import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type StageResult, securityAuditPipeline } from '../src/routing/pipeline.ts';

test('securityAuditPipeline wires find (claude) → verify (codex) with opencode fallback', () => {
  const stages = securityAuditPipeline();
  assert.equal(stages.length, 2);
  assert.equal(stages[0]?.name, 'find');
  assert.equal(stages[0]?.primary, 'claude');
  assert.equal(stages[1]?.name, 'verify');
  assert.equal(stages[1]?.primary, 'codex');
  assert.deepEqual(stages[1]?.fallbacks, ['opencode']);
});

test('agent ids are overridable so the pipeline is not bound to specific adapters', () => {
  const stages = securityAuditPipeline({
    finder: 'gemini',
    verifier: 'opencode',
    verifierFallback: 'claude',
  });
  assert.equal(stages[0]?.primary, 'gemini');
  assert.equal(stages[1]?.primary, 'opencode');
  assert.deepEqual(stages[1]?.fallbacks, ['claude']);
});

test('the find prompt demands a full source → sink flow per finding', () => {
  const stages = securityAuditPipeline();
  const prompt = stages[0]?.buildPrompt('@file:src/app.ts', []) ?? '';
  // It must ask for each leg of the flow, not just "list bugs".
  assert.match(prompt, /source/i);
  assert.match(prompt, /sink/i);
  assert.match(prompt, /flow/i);
  // The audit target is embedded so the agent knows what to look at.
  assert.match(prompt, /@file:src\/app\.ts/);
});

test('the verify prompt embeds the first-pass findings and asks to confirm each flow', () => {
  const stages = securityAuditPipeline();
  const prior: StageResult[] = [
    {
      stage: 'find',
      agent: 'claude',
      text: '1. SQL injection: req.query.id flows unescaped into db.query()',
      ok: true,
      failedOver: [],
    },
  ];
  const prompt = stages[1]?.buildPrompt('TARGET', prior) ?? '';
  // The verifier reviews the actual findings, not a fresh audit.
  assert.match(prompt, /SQL injection/);
  assert.match(prompt, /req\.query\.id/);
  // It must classify each finding and not redo the audit.
  assert.match(prompt, /CONFIRMED/);
  assert.match(prompt, /FALSE POSITIVE/);
  assert.match(prompt, /NOT to redo/i);
  assert.match(prompt, /VERDICT/);
  // It names who produced the first pass.
  assert.match(prompt, /claude/);
});

test('the verify prompt degrades gracefully when the find stage produced nothing', () => {
  const stages = securityAuditPipeline();
  const prompt = stages[1]?.buildPrompt('TARGET', []) ?? '';
  assert.match(prompt, /no audit produced/i);
});
