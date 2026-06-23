import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geminiSpec } from '../src/adapters/gemini.ts';

// These tests exercise the parts of the gemini adapter that are pure: how it
// builds argv from a permission level, and how it maps native stream-json events
// to unified messages. The real CLI's network behavior (and its known 403 API
// instability) is out of scope — we only verify our translation layer.

test('buildArgs always requests stream-json and skips the trust downgrade', () => {
  const args = geminiSpec.buildArgs('bypass');
  assert.deepEqual(args.slice(0, 3), ['-o', 'stream-json', '--skip-trust']);
});

test("buildArgs adds --yolo for autonomous permissions but not for 'default'", () => {
  assert.ok(geminiSpec.buildArgs('bypass').includes('--yolo'));
  assert.ok(geminiSpec.buildArgs('acceptEdits').includes('--yolo'));
  assert.ok(!geminiSpec.buildArgs('default').includes('--yolo'));
});

test('init events produce no user-facing message', () => {
  const out = geminiSpec.mapEvent(
    { type: 'init', model: 'gemini-2.5-pro', session_id: 'x' },
    'gemini',
  );
  assert.deepEqual(out, []);
});

test('the prompt echo (role:user) is dropped', () => {
  const out = geminiSpec.mapEvent({ type: 'message', role: 'user', content: 'say hi' }, 'gemini');
  assert.deepEqual(out, []);
});

test('an assistant message becomes a text message', () => {
  const out = geminiSpec.mapEvent(
    { type: 'message', role: 'assistant', content: 'Hello there friend' },
    'gemini',
  );
  assert.deepEqual(out, [{ type: 'text', agent: 'gemini', text: 'Hello there friend' }]);
});

test("the 'model' role is also treated as assistant text", () => {
  const out = geminiSpec.mapEvent(
    { type: 'message', role: 'model', content: 'from the model' },
    'gemini',
  );
  assert.deepEqual(out, [{ type: 'text', agent: 'gemini', text: 'from the model' }]);
});

test('an empty assistant message yields nothing', () => {
  const out = geminiSpec.mapEvent({ type: 'message', role: 'assistant', content: '' }, 'gemini');
  assert.deepEqual(out, []);
});

test('a success result is a terminal ok=true', () => {
  const out = geminiSpec.mapEvent(
    { type: 'result', status: 'success', stats: { total_tokens: 10 } },
    'gemini',
  );
  assert.deepEqual(out, [{ type: 'result', agent: 'gemini', ok: true }]);
});

test('an error result surfaces the error message and ok=false', () => {
  const out = geminiSpec.mapEvent(
    {
      type: 'result',
      status: 'error',
      error: { type: 'unknown', message: '[API Error: 403 Forbidden]' },
    },
    'gemini',
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]?.type, 'result');
  if (out[0]?.type === 'result') {
    assert.equal(out[0].ok, false);
    assert.match(out[0].error ?? '', /403 Forbidden/);
  }
});

test('an error result with no detail still fails with a fallback message', () => {
  const out = geminiSpec.mapEvent({ type: 'result', status: 'error' }, 'gemini');
  assert.equal(out.length, 1);
  if (out[0]?.type === 'result') {
    assert.equal(out[0].ok, false);
    assert.equal(out[0].error, 'gemini error');
  }
});
