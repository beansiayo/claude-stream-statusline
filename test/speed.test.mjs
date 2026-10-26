import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../plugins/stream-speed/hooks/register.ts';

test('qualifies receive timing, rejects bursts and forwards stream lifecycle', async () => {
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
      assert.equal(record.sample.tps, 123);
      time = 12000; yield { kind: 'text', text: 'more' };
      time = 13000; yield { kind: 'stop', usage: result.usage, stopReason: 'end_turn' };
      return result;
    }
    const stream = hook($, {}, response);
    let item; let count = 0;
    do { item = await stream.next(); if (!item.done) count++; } while (!item.done);
    assert.equal(item.value, result);
    assert.equal(count, 4);
    assert.equal(record.version, 2);
    assert.equal(record.status, 'observed');
    assert.equal(record.sample.tps, 200);
    assert.equal(writes, 1);
    // Regression: 749 tokens are delivered after a long wait in an 83ms burst.
    time = 0;
    async function* burst() {
      time = 15000; yield { kind: 'tool', name: 'Edit' };
      time = 15026; yield { kind: 'input', json: '{"x":1}' };
      time = 15054; yield { kind: 'input', json: '{"x":2}' };
      time = 15083; yield { kind: 'stop', usage: { output_tokens: 749 }, stopReason: 'tool_use' };
      return {};
    }
    for await (const _ of hook($, {}, burst)) {}
    assert.equal(record.status, 'burst');
    assert.equal(record.sample, null);
    assert.equal(record.timing.deltaCount, 3);
    // A delayed stop must not make a single buffered output qualify.
    async function* single() {
      time = 20000; yield { kind: 'text', text: 'whole reply' };
      time = 25000; yield { kind: 'stop', usage: result.usage, stopReason: 'end_turn' }; return {};
    }
    for await (const _ of hook($, {}, single)) {}
    assert.equal(record.status, 'burst');
    async function* sparse() {
      time = 26000; yield { kind: 'text', text: 'a' };
      time = 28000; yield { kind: 'text', text: 'b' };
      time = 29000; yield { kind: 'stop', usage: result.usage, stopReason: 'end_turn' }; return {};
    }
    for await (const _ of hook($, {}, sparse)) {}
    assert.equal(record.status, 'insufficient');
    const previousWrites = writes;
    async function* noUsage() { yield { kind: 'stop', usage: null, stopReason: 'end_turn' }; return {}; }
    for await (const _ of hook($, { agentId: 'subagent' }, noUsage)) {}
    assert.equal(writes, previousWrites);
    for await (const _ of hook($, {}, noUsage)) {}
    assert.equal(record.status, 'unavailable');
    async function* failure() { yield { kind: 'text', text: 'partial' }; throw Error('interrupted'); }
    await assert.rejects(async () => { for await (const _ of hook($, {}, failure)) {} }, /interrupted/);
    assert.equal(record.status, 'interrupted');
    let closed = false;
    async function* cancellable() { try { yield { kind: 'text', text: 'a' }; } finally { closed = true; } }
    const cancelled = hook($, {}, cancellable);
    await cancelled.next(); await cancelled.return();
    assert.equal(closed, true);
    assert.equal(record.status, 'interrupted');
  } finally { Object.defineProperty(globalThis, 'performance', original); }
});
