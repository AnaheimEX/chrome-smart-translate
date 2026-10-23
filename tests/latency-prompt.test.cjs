'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { background } = require('./helpers.cjs');
test('parallel selection prewarming issues only one native preparation for the same prompt/model', async t => {
  const app = background({ codexModel: 'test-model' });
  t.after(app.close);
  await Promise.all(Array.from({ length: 8 }, () => app.context.warmCodex({})));
  assert.equal(app.nativeCalls.filter(call => call.action === 'prepare').length, 1);
});
test('prewarm sends neither selected text nor context and deduplication resets after completion', async t => {
  const app = background({ codexModel: 'test-model' });
  t.after(app.close);
  await app.context.warmCodex({ text: 'do not send before click', context: { nearby: 'private context' } });
  const first = app.nativeCalls.find(call => call.action === 'prepare');
  assert.equal(first.text, undefined);
  assert.equal(first.context, undefined);
  await app.context.warmCodex({});
  assert.equal(app.nativeCalls.filter(call => call.action === 'prepare').length, 2);
});
test('cached translation is marked as cached rather than displaying old generation timing', async t => {
  const app = background({ codexModel: 'test-model' });
  t.after(app.close);
  await app.translate('Repeat me').done;
  const result = await app.translate('Repeat me').done;
  assert.equal(result.timing.cached, true);
  assert.equal(result.timing.firstTokenMs, undefined);
  assert.equal(app.nativeCalls.filter(call => call.action === 'translate').length, 1);
});
test('Codex timing reaches the content port so first-byte delay can be measured', async t => {
  const timing = { setupMs: 12, firstTokenMs: 456, totalMs: 789 };
  const app = background({ codexModel: 'test-model' }, {
    native: request => request.action === 'translate'
      ? { type: 'done', translation: '模拟译文', timing } : { type: 'ready' },
  });
  t.after(app.close);
  const result = await app.translate().done;
  assert.deepEqual(result.timing, timing);
});
