#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { paths, readState, readSettings, writeSettings, line, same, own } = require('./install.cjs');

function toggle(args = process.argv.slice(2)) {
  const action = args[0];
  if (action !== 'enable' && action !== 'disable') throw new Error('Usage: toggle.cjs enable|disable [--config-dir DIR]');
  const p = paths(args.slice(1));
  const state = readState(p);
  if (!state) throw new Error(`No installation in ${p.dir}`);
  const { value: settings } = readSettings(p.settings);
  if (action === 'disable') {
    if (!same(settings.statusLine, line(p.target))) {
      if (state.disabled && (state.hadStatusLine ? same(settings.statusLine, state.originalStatusLine) : !own(settings, 'statusLine'))) return p;
      throw new Error('A different statusLine is configured; refusing to change it');
    }
    if (state.hadStatusLine) settings.statusLine = state.originalStatusLine;
    else delete settings.statusLine;
  } else {
    if (state.disabled && !(state.hadStatusLine ? same(settings.statusLine, state.originalStatusLine) : !own(settings, 'statusLine')))
      throw new Error('A different statusLine is configured; refusing to replace it');
    if (!state.disabled && !same(settings.statusLine, line(p.target)))
      throw new Error('A different statusLine is configured; refusing to replace it');
    settings.statusLine = line(p.target);
  }
  writeSettings(p, settings);
  state.disabled = action === 'disable';
  fs.writeFileSync(p.state, JSON.stringify(state, null, 2) + '\n');
  return p;
}
if (require.main === module) {
  try { toggle(); console.log('Status line toggled'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { toggle };
