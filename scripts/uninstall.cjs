#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { paths, readState, readSettings, writeSettings, line, same } = require('./install.cjs');

function uninstall(args) {
  const p = paths(args);
  const state = readState(p);
  if (!state) throw new Error(`No installation in ${p.dir}`);
  const entries = fs.readdirSync(p.install).sort();
  if (entries.join(',') !== 'settings.backup.json,state.json,statusline.cjs')
    throw new Error(`Unexpected contents in ${p.install}; refusing to remove it`);
  const { value: settings } = readSettings(p.settings);
  if (same(settings.statusLine, line(p.target))) {
    if (state.hadStatusLine) settings.statusLine = state.originalStatusLine;
    else delete settings.statusLine;
    writeSettings(p, settings);
  }
  fs.unlinkSync(p.target);
  fs.unlinkSync(p.state);
  fs.unlinkSync(p.backup);
  fs.rmdirSync(p.install);
  return p;
}
if (require.main === module) {
  try { const p = uninstall(); console.log(`Uninstalled status line from ${p.dir}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { uninstall };
