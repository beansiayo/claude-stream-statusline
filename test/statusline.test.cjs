const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.join(__dirname, '../src/statusline.cjs');

test('renders isolated measurements, theme colors and optional threshold estimates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-render-'));
  try {
    fs.mkdirSync(path.join(dir, 'stream-speed'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ autoCompactWindow: 272000 }));
    const payload = { session_id: 'test-a', model: { id: 'example', display_name: '测试模型' }, context_window: {
      context_window_size: 1000000, current_usage: { input_tokens: 81000, output_tokens: 600 },
    } };
    const run = (extra = {}, input = payload) => {
      const env = { ...process.env, CLAUDE_CONFIG_DIR: dir, STATUSLINE_SCHEME: 'dark', COLUMNS: '160' };
      for (const key of ['STATUSLINE_CTX_WINDOW', 'STATUSLINE_COMPACT_ESTIMATE', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', 'STATUSLINE_FAST_TPS']) delete env[key];
      const r = spawnSync(process.execPath, [script], { env: { ...env, ...extra }, input: JSON.stringify(input), encoding: 'utf8' });
      assert.equal(r.status, 0); return r.stdout;
    };
    const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '');
    assert.match(plain(run()), /81k\/1M 8.1%/);
    assert.match(plain(run()), /— tok\/s/);
    const sample = tokens => fs.writeFileSync(path.join(dir, 'stream-speed/test-a.json'), JSON.stringify({ version: 1, sessionId: 'test-a', sample: { tokens, seconds: 1 } }));
    sample(49); assert.ok(run().includes('\x1b[0;38;5;221m49 tok/s'));
    sample(50); assert.ok(run().includes('\x1b[0;38;5;113m50 tok/s'));
    assert.ok(run({ STATUSLINE_SCHEME: 'light' }).includes('\x1b[0;38;5;34m50 tok/s'));
    assert.ok(run({ STATUSLINE_FAST_TPS: '100' }).includes('\x1b[0;38;5;221m50 tok/s'));
    assert.match(plain(run({ STATUSLINE_COMPACT_ESTIMATE: '1' })), /81k\/~239k\/1M 33.9%/);
    assert.match(plain(run({}, { ...payload, session_id: 'test-b' })), /— tok\/s/);
    fs.writeFileSync(path.join(dir, 'stream-speed/test-a.json'), '{');
    assert.match(plain(run()), /— tok\/s/);
    for (const width of [1, 20, 40, 80]) assert.ok(plain(run({ COLUMNS: String(width) })).length <= width);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
