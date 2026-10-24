'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { install, line } = require('../scripts/install.cjs');
const { uninstall } = require('../scripts/uninstall.cjs');
const { toggle } = require('../scripts/toggle.cjs');

function fixture(t, name = 'config') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-statusline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, name);
}
const read = dir => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
const write = (dir, value) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(value)); };
const args = dir => ['--config-dir', dir];

test('roundtrip preserves initial statusLine, first backup and subsequent unrelated changes', t => {
  const dir = fixture(t);
  const original = { model: 'custom', statusLine: { type: 'command', command: 'old' } };
  write(dir, original);
  const p = install(args(dir));
  assert.deepEqual(read(dir).statusLine, line(p.target));
  assert.equal(fs.readFileSync(p.backup, 'utf8'), JSON.stringify(original));
  const changed = { ...read(dir), theme: 'dark' };
  write(dir, changed);
  install(args(dir));
  assert.equal(fs.readFileSync(p.backup, 'utf8'), JSON.stringify(original));
  toggle(['disable', ...args(dir)]);
  assert.deepEqual(read(dir).statusLine, original.statusLine);
  toggle(['enable', ...args(dir)]);
  assert.deepEqual(read(dir).statusLine, line(p.target));
  uninstall(args(dir));
  assert.deepEqual(read(dir), { ...original, theme: 'dark' });
  assert.equal(fs.existsSync(p.install), false);
});

test('new settings and env config dir roundtrip', t => {
  const dir = fixture(t);
  const p = install(args(dir));
  toggle(['disable', ...args(dir)]);
  assert.equal(Object.hasOwn(read(dir), 'statusLine'), false);
  toggle(['enable', ...args(dir)]);
  uninstall(args(dir));
  assert.deepEqual(read(dir), {});
  const envDir = fixture(t, 'env-config');
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = envDir;
  try { install([]); assert.ok(read(envDir).statusLine); uninstall([]); }
  finally { if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous; }
  assert.equal(fs.existsSync(p.install), false);
});

test('malformed settings and foreign install directory cause no changes', t => {
  const dir = fixture(t);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{broken');
  assert.throws(() => install(args(dir)), /Invalid JSON/);
  assert.equal(fs.existsSync(path.join(dir, 'claude-stream-statusline')), false);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
  fs.mkdirSync(path.join(dir, 'claude-stream-statusline'));
  assert.throws(() => install(args(dir)), /Foreign install directory/);
  assert.deepEqual(read(dir), {});
});

test('quoted executable and target paths work with spaces and apostrophes', t => {
  const dir = fixture(t, "a space's config");
  const p = install(args(dir));
  const command = read(dir).statusLine.command;
  assert.equal(command, line(p.target).command);
  assert.match(command, /'\\''/);
  const output = execFileSync('/bin/sh', ['-c', command], { input: JSON.stringify({ model: { display_name: 'Test' } }), encoding: 'utf8' });
  assert.match(output, /Test/);
});

test('user replacement remains untouched on uninstall and blocks toggle and reinstall', t => {
  const dir = fixture(t);
  write(dir, { statusLine: { type: 'command', command: 'original' }, other: 1 });
  const p = install(args(dir));
  const custom = { type: 'command', command: 'replacement' };
  write(dir, { ...read(dir), statusLine: custom, other: 2 });
  assert.throws(() => toggle(['disable', ...args(dir)]), /different statusLine/);
  assert.throws(() => install(args(dir)), /different statusLine/);
  uninstall(args(dir));
  assert.deepEqual(read(dir), { statusLine: custom, other: 2 });
  assert.equal(fs.existsSync(p.install), false);
});
