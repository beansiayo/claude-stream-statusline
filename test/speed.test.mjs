import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../plugins/stream-speed/hooks/register.ts';

test('measures decode time, preserves samples and forwards cancellation', async () => {
  let hook;
  register((_, fn) => { hook = fn; });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let time = 0;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => time } });
  try {
    let record = { sample: { tps: 123 } };
    let writes = 0;
    const $ = {
      session: { id: async () => 'session-a' },
      env: { get: async key => ({ HOME: '/home/example', CLAUDE_CONFIG_DIR: '/tmp/custom config' })[key] },
      fs: { write: async (file, text) => {
        assert.equal(file, '/tmp/custom config/stream-speed/session-a.json');
        record = JSON.parse(text); writes++;
      } },
    };
    const result = { usage: { output_tokens: 600 } };
    async function* response() {
      assert.equal(record.sample.tps, 123);
      time = 10000; yield { kind: 'thinking', text: 'reason' };
      time = 11000; yield { kind: 'text', text: 'answer' };
      time = 13000; yield { kind: 'stop', usage: result.usage, stopReason: 'end_turn' };
      return result;
    }
    const stream = hook($, {}, response);
    let item; let count = 0;
    do { item = await stream.next(); if (!item.done) count++; } while (!item.done);
    assert.equal(item.value, result);
    assert.equal(count, 3);
    assert.equal(record.sample.tps, 200);
    assert.equal(writes, 1);
    async function* noUsage() { yield { kind: 'stop', usage: null, stopReason: null }; return {}; }
    for await (const _ of hook($, {}, noUsage)) {}
    for await (const _ of hook($, { agentId: 'subagent' }, noUsage)) {}
    assert.equal(writes, 1);
    async function* failure() { yield { kind: 'text', text: 'partial' }; throw Error('interrupted'); }
    await assert.rejects(async () => { for await (const _ of hook($, {}, failure)) {} }, /interrupted/);
    assert.equal(record.sample.tps, 200);
    let closed = false;
    async function* cancellable() { try { yield { kind: 'text', text: 'a' }; } finally { closed = true; } }
    const cancelled = hook($, {}, cancellable);
    await cancelled.next(); await cancelled.return();
    assert.equal(closed, true);
    assert.equal(writes, 1);
  } finally { Object.defineProperty(globalThis, 'performance', original); }
});
