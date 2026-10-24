#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const marker = 'claude-stream-statusline';
const filename = 'statusline.cjs';
const source = path.resolve(__dirname, '..', 'src', filename);

function paths(args = process.argv.slice(2)) {
  if (process.platform === 'win32') throw new Error('Windows is not supported');
  let dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config-dir' && args[i + 1]) dir = args[++i];
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  dir = path.resolve(dir);
  return { dir, settings: path.join(dir, 'settings.json'), install: path.join(dir, marker),
    target: path.join(dir, marker, filename), state: path.join(dir, marker, 'state.json'),
    backup: path.join(dir, marker, 'settings.backup.json') };
}

function exists(file) { return fs.existsSync(file); }
function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
function digest(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function quote(text) { return "'" + text.replace(/'/g, "'\\''") + "'"; }
function line(target) { return { type: 'command', command: `${quote(process.execPath)} ${quote(target)}` }; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function readSettings(file) {
  if (!exists(file)) return { value: {}, raw: null };
  const raw = fs.readFileSync(file, 'utf8');
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`Invalid JSON in ${file}`); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`Expected an object in ${file}`);
  return { value, raw };
}
function readState(p) {
  if (!exists(p.install)) return null;
  if (!fs.statSync(p.install).isDirectory() || !exists(p.state)) throw new Error(`Foreign install directory: ${p.install}`);
  let state;
  try { state = JSON.parse(fs.readFileSync(p.state, 'utf8')); } catch { throw new Error(`Invalid installer state: ${p.state}`); }
  if (!state || state.marker !== marker || state.version !== 1 || state.target !== p.target ||
      typeof state.sourceHash !== 'string' || typeof state.hadStatusLine !== 'boolean' ||
      (state.hadStatusLine && !own(state, 'originalStatusLine')) ||
      typeof state.hadSettings !== 'boolean' || !exists(p.backup) || !exists(p.target) ||
      digest(fs.readFileSync(p.target)) !== state.sourceHash) {
    throw new Error(`Foreign or modified install directory: ${p.install}`);
  }
  return state;
}
function writeSettings(p, settings) {
  fs.mkdirSync(p.dir, { recursive: true });
  const temp = path.join(p.dir, `.settings.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, p.settings);
  } finally { if (exists(temp)) fs.unlinkSync(temp); }
}
function install(args) {
  const p = paths(args);
  const state = readState(p);
  const { value: settings, raw } = readSettings(p.settings);
  if (state && !same(settings.statusLine, line(p.target)) && own(settings, 'statusLine')) {
    if (!state.disabled || !same(settings.statusLine, state.originalStatusLine))
      throw new Error('A different statusLine is configured; refusing to replace it');
  }
  if (!state) {
    const content = fs.readFileSync(source);
    const initial = { marker, version: 1, target: p.target, sourceHash: digest(content),
      hadSettings: raw !== null, hadStatusLine: own(settings, 'statusLine'),
      originalStatusLine: settings.statusLine, disabled: false };
    fs.mkdirSync(p.dir, { recursive: true });
    fs.mkdirSync(p.install);
    fs.writeFileSync(p.backup, raw === null ? '' : raw, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(p.target, content, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(p.state, JSON.stringify(initial, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } else if (state.sourceHash !== digest(fs.readFileSync(source))) {
    const content = fs.readFileSync(source);
    fs.writeFileSync(p.target, content);
    state.sourceHash = digest(content);
    fs.writeFileSync(p.state, JSON.stringify(state, null, 2) + '\n');
  }
  settings.statusLine = line(p.target);
  writeSettings(p, settings);
  if (state && state.disabled) {
    state.disabled = false;
    fs.writeFileSync(p.state, JSON.stringify(state, null, 2) + '\n');
  }
  return p;
}
if (require.main === module) {
  try { const p = install(); console.log(`Installed status line in ${p.dir}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { paths, readState, readSettings, writeSettings, line, same, own, install };
