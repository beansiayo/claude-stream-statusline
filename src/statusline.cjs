#!/usr/bin/env node
/**
 * Claude Code status line — one row.
 *
 *   ✻ model · effort · cwd · branch │ ctx bar 221k/239k/1M 92% │ out 106 │ cache 84% │ 3 tok/s
 *
 * "ctx" defaults to current / model capacity. An optional ~threshold is an
 * explicitly enabled compaction estimate, never a promise of when it fires.
 * Output speed is the last completed stream measurement, not a live rate.
 *
 * Output speed comes from the stream-speed plugin: provider output tokens
 * divided by elapsed time from the first output delta to response completion.
 * Without a measured sample, speed displays a dash.
 *
 * Colours live in THEME below — change the numbers to re-tune the palette.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ESC = '\x1b[';
const RESET = ESC + '0m';

// `0;` first: Claude Code renders the status line with a dim attribute, and a
// bare 38;5;N would inherit it, washing every colour out.
const fg = (n) => ESC + '0;38;5;' + n + 'm';

// Light terminals need dark, saturated codes; dark terminals need bright ones.
const PALETTES = {
  light: {
    model: 61, // indigo
    effort: 130, // burnt orange
    dir: 24, // deep teal
    branch: 28, // green
    sep: 244, // grey
    label: 244, // grey
    value: 234, // near black
    good: 34, // green
    warn: 136, // dark amber
    bad: 160, // red
    compact: 25, // blue
    speed: 25, // blue
    faint: 250, // faint grey
  },
  dark: {
    model: 183, // lilac
    effort: 216, // peach
    dir: 110, // slate blue
    branch: 149, // leaf green
    sep: 240,
    label: 246,
    value: 254, // near white
    good: 113,
    warn: 221,
    bad: 203,
    compact: 117, // sky blue
    speed: 180, // sand
    faint: 242,
  },
};

/**
 * Is the macOS appearance dark? Returns null when it cannot be determined.
 * `defaults` exits 1 when the key is absent, and that absence means Light.
 */
function osAppearanceDark() {
  if (process.platform !== 'darwin') return null;
  try {
    const out = execFileSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], {
      encoding: 'utf8',
      timeout: 500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().toLowerCase() === 'dark';
  } catch (e) {
    return e && e.status === 1 ? false : null;
  }
}

/**
 * Palette choice, highest priority first:
 *   1. STATUSLINE_SCHEME=light|dark (set it in settings.json env)
 *   2. COLORFGBG, which some terminals export ("15;0" = light text on dark bg)
 *   3. the macOS appearance — Ghostty here runs `theme = light:…,dark:…`, so the
 *      terminal background follows the system and Ghostty exports no COLORFGBG
 *   4. light
 */
function detectScheme() {
  const forced = (process.env.STATUSLINE_SCHEME || '').toLowerCase();
  if (forced === 'light' || forced === 'dark') return forced;

  const m = (process.env.COLORFGBG || '').match(/(?:^|;)(\d+)$/);
  if (m) return Number(m[1]) >= 7 ? 'light' : 'dark';

  const dark = osAppearanceDark();
  if (dark !== null) return dark ? 'dark' : 'light';

  return 'light';
}

const THEME = PALETTES[detectScheme()];
const S = {};
for (const k of Object.keys(THEME)) S[k] = fg(THEME[k]);

const HOME = os.homedir();
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const FAST_TPS = Number(process.env.STATUSLINE_FAST_TPS) > 0 ? Number(process.env.STATUSLINE_FAST_TPS) : 50;

function safeText(value) {
  return String(value).replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))|[\x00-\x1f\x7f]/g, ' ');
}

function cellWidth(s) {
  let width = 0;
  for (const char of s.replace(/\x1b\[[0-9;]*m/g, '')) {
    const cp = char.codePointAt(0);
    if (/\p{Mark}/u.test(char) || cp === 0x200d || cp === 0xfe0f) continue;
    width += cp >= 0x1100 && (cp <= 0x115f || cp >= 0x2329 && cp <= 0x232a ||
      cp >= 0x2e80 && cp <= 0xa4cf || cp >= 0xac00 && cp <= 0xd7a3 ||
      cp >= 0xf900 && cp <= 0xfaff || cp >= 0xfe10 && cp <= 0xfe6f ||
      cp >= 0xff00 && cp <= 0xff60 || cp >= 0xffe0 && cp <= 0xffe6 ||
      cp >= 0x1f300) ? 2 : 1;
  }
  return width;
}

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

/** 439 -> "439", 3911 -> "3.9k", 40007 -> "40k", 1048576 -> "1.0M" */
function tok(n) {
  if (n == null) return '—';
  n = Math.round(n);
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1000000) return Math.round(n / 1000) + 'k';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '').replace(/\.0$/, '') + 'M';
}

/** Filled usage and remaining track share the percentage's scale. */
function bar(pct, width, color) {
  const p = Math.max(0, Math.min(100, pct == null ? 0 : pct));
  const filled = Math.round((p / 100) * width);
  return color + '█'.repeat(filled) + S.faint + '─'.repeat(width - filled) + RESET;
}

/** Higher is worse. */
function usageColor(pct) {
  if (pct == null) return S.value;
  return pct >= 75 ? S.bad : pct >= 50 ? S.warn : S.good;
}

/** Higher is better. */
function cacheColor(pct) {
  if (pct == null) return S.value;
  return pct >= 90 ? S.good : pct >= 60 ? S.warn : S.bad;
}

/** Latest measured stream speed; missing measurements are never estimated. */
function lastReplySpeed(transcriptPath, id) {
  const sessionId = id || (transcriptPath && path.basename(transcriptPath, '.jsonl'));
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'stream-speed', sessionId + '.json'), 'utf8'));
    if (record.version !== 2 || record.sessionId !== sessionId) return null;
    if (['burst', 'insufficient', 'unavailable', 'interrupted'].includes(record.status)) return { status: record.status };
    const sample = record.sample;
    const timing = record.timing;
    if (record.status !== 'observed' || !timing || !(num(timing.outputSpanSeconds) >= 0.5)
      || !(num(timing.deltaCount) >= 3) || !(num(timing.spacedGaps) >= 2)) return null;
    if (!sample || !(num(sample.tokens) > 0) || !(num(sample.seconds) > 0)) return null;
    const tps = sample.tokens / sample.seconds;
    return Number.isFinite(tps) ? { status: 'observed', ...sample, tps } : null;
  } catch { return null; }
}

function gitBranch(dir) {
  try {
    let p = dir;
    for (let depth = 0; depth < 6; depth++) {
      const dotGit = path.join(p, '.git');
      let head = null;
      try {
        const st = fs.statSync(dotGit);
        if (st.isDirectory()) {
          head = fs.readFileSync(path.join(dotGit, 'HEAD'), 'utf8').trim();
        } else {
          const pointer = fs.readFileSync(dotGit, 'utf8').trim();
          const m = pointer.match(/^gitdir:\s*(.+)$/);
          if (m) head = fs.readFileSync(path.join(path.resolve(p, m[1]), 'HEAD'), 'utf8').trim();
        }
      } catch {}
      if (head) {
        const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
        return ref ? ref[1] : head.slice(0, 7);
      }
      const parent = path.dirname(p);
      if (parent === p) break;
      p = parent;
    }
  } catch {}
  return null;
}

function shortenDir(dir) {
  if (!dir) return '';
  let d = dir;
  if (HOME && (d === HOME || d.startsWith(HOME + path.sep))) d = '~' + d.slice(HOME.length);
  return d;
}

function sep() {
  return S.sep + ' │ ' + RESET;
}

function compactionWindow(modelWindow) {
  const forced = Number(process.env.STATUSLINE_CTX_WINDOW);
  if (Number.isFinite(forced) && forced > 0) return forced;
  return modelWindow;
}

// Opt-in approximation based on CLI 2.1.309 internals. Model output limits,
// project overrides and future CLI versions can change the real threshold.
const OUTPUT_RESERVE = 20000;
const COMPACT_BUFFER = 13000;

function autoCompactTrigger(modelWindow, configuredWindow) {
  const window = configuredWindow
    ? Math.min(modelWindow || configuredWindow, configuredWindow)
    : modelWindow;
  if (!window || window <= OUTPUT_RESERVE + COMPACT_BUFFER) return null;
  const effective = window - Math.min(OUTPUT_RESERVE, Math.floor(window / 2));
  const pct = Number(process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE); // same env CC honours
  if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
    return Math.min(Math.floor((effective * pct) / 100), effective - COMPACT_BUFFER);
  }
  return effective - COMPACT_BUFFER;
}

// The value as configured in settings, shown next to the trigger point.
function configuredCompactWindow(modelId) {
  const fromEnv = Number(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
    const settings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
    const models = settings.modelSettings || {};
    const bareId = String(modelId || '').replace(/\[[^\]]*\]$/, '');
    const configured = models[modelId]?.autoCompactWindow
      ?? models[bareId]?.autoCompactWindow
      ?? settings.autoCompactWindow;
    const value = num(configured);
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

function render(raw) {
  const j = JSON.parse(raw);

  const cols = parseInt(process.env.COLUMNS || '120', 10) || 120;
  const cwd = safeText((j.workspace && (j.workspace.current_dir || j.workspace.project_dir)) || j.cwd || '');
  const modelName = safeText((j.model && (j.model.display_name || j.model.id)) || 'unknown');
  const effort = j.effort && j.effort.level ? safeText(j.effort.level) : null;

  // ---- context window -------------------------------------------------
  const cw = j.context_window || {};
  const cu = cw.current_usage || null;
  const size = num(cw.context_window_size);
  const budget = compactionWindow(size);
  const configured = configuredCompactWindow(j.model && j.model.id);
  const compactWindow = process.env.STATUSLINE_COMPACT_ESTIMATE === '1' && configured
    ? autoCompactTrigger(budget, configured) : null;
  const percentageWindow = compactWindow || budget;

  let promptTokens = null;
  let cacheRead = null;
  let outputTokens = null;

  if (cu) {
    const inputTokens = num(cu.input_tokens) || 0;
    cacheRead = num(cu.cache_read_input_tokens);
    const cacheCreate = num(cu.cache_creation_input_tokens) || 0;
    outputTokens = num(cu.output_tokens);
    promptTokens = [cu.input_tokens, cu.cache_read_input_tokens, cu.cache_creation_input_tokens].some((v) => num(v) != null)
      ? inputTokens + (cacheRead || 0) + cacheCreate : null;
  }

  // The percentage uses the displayed denominator (model capacity by default).
  let pct = compactWindow ? null : num(cw.used_percentage);
  if (promptTokens != null && percentageWindow) pct = (promptTokens / percentageWindow) * 100;

  // ---- cache hit rate (latest reply) ----------------------------------
  let cachePct = null;
  if (cacheRead != null && promptTokens > 0) cachePct = (cacheRead / promptTokens) * 100;
  else if (j.prompt_cache && num(j.prompt_cache.hit_ratio) != null) cachePct = num(j.prompt_cache.hit_ratio) * 100;
  const cachingObserved = !j.prompt_cache ? true : j.prompt_cache.caching_observed !== false;

  const speed = lastReplySpeed(j.transcript_path, j.session_id);

  // ---- segments --------------------------------------------------------
  const dirFull = shortenDir(cwd);
  const dirBase = dirFull.split('/').pop() || dirFull;
  const branch = gitBranch(cwd);

  const modelSeg = S.model + '✻ ' + modelName + RESET;
  const effortSeg = effort ? S.effort + effort + RESET : null;
  const dirSeg = dirFull ? S.dir + dirFull + RESET : null;
  const dirBaseSeg = dirBase ? S.dir + dirBase + RESET : null;
  const branchSeg = branch ? S.branch + '⎇ ' + branch + RESET : null;

  const ctxVal = `${S.value}${tok(promptTokens)}${compactWindow != null ? `${S.faint}/${RESET}${S.compact}~${tok(compactWindow)}` : ''}${budget ? `${S.faint}/${RESET}${S.value}${tok(budget)}` : ''}${RESET}`;
  const ctxPct = pct != null ? `${usageColor(pct)}${pct.toFixed(1)}%${RESET}` : `${S.faint}—${RESET}`;

  const ctxShort = `${S.label}ctx${RESET} ${ctxVal} ${ctxPct}`;
  const ctxFull =
    pct == null
      ? ctxShort
      : `${S.label}ctx${RESET} ${bar(pct, 10, usageColor(pct))} ${ctxVal} ${ctxPct}`;

  const outSeg = `${S.label}out${RESET} ${S.value}${tok(outputTokens)}${RESET}`;

  // Cached tokens are the part of this request's upload served from the prompt
  // cache; the uncached remainder is promptTokens - cacheRead.
  const cacheSeg = !cachingObserved
    ? `${S.label}cache${RESET} ${S.faint}n/a${RESET}`
    : `${S.label}cache${RESET} ${cachePct == null ? S.faint : cacheColor(cachePct)}${cacheRead == null ? '—' : tok(cacheRead)}${
        cachePct != null ? ' (' + cachePct.toFixed(0) + '%)' : ''
      }${RESET}`;
  const speedSeg = speed?.status === 'observed'
    ? `${Math.round(speed.tps) >= FAST_TPS ? S.good : S.warn}${speed.tps.toFixed(0)} recv tok/s${RESET}`
    : speed && ['burst', 'insufficient'].includes(speed.status)
      ? `${S.warn}n/a tok/s (${speed.status === 'burst' ? 'burst' : 'sparse'})${RESET}`
      : `${S.faint}— tok/s${RESET}`;

  // ---- fit one row, dropping the least useful parts first --------------
  let head = [modelSeg, effortSeg, dirSeg, branchSeg].filter(Boolean);
  let body = [ctxFull, outSeg, cacheSeg, speedSeg];

  const build = (h, b) => h.join(S.sep + ' · ' + RESET) + sep() + b.join(sep());
  let line = build(head, body);
  const fits = () => cellWidth(line) <= Math.max(1, cols - 2);

  // The four metrics matter most, so the head is trimmed before any of them.
  const steps = [
    () => { body[0] = ctxShort; },                                  // drop the bar
    () => { head = head.filter((x) => x !== branchSeg); },          // drop the branch
    () => { head = head.filter((x) => x !== effortSeg); },          // drop the effort
    () => { head = head.map((x) => (x === dirSeg ? dirBaseSeg : x)).filter(Boolean); }, // basename only
    () => { head = head.filter((x) => x !== dirSeg && x !== dirBaseSeg); },             // drop the dir
    () => { head[0] = S.model + '✻ ' + modelName.slice(0, 14) + '…' + RESET; }, // shorten the model
    () => { body = body.filter((x) => x !== cacheSeg); },           // drop the cache rate
    () => { body = body.filter((x) => x !== outSeg); },             // drop out tokens
  ];

  for (const step of steps) {
    if (fits()) break;
    step();
    line = build(head, body);
  }

  if (!fits()) {
    const modelShort = S.model + '✻' + RESET;
    head = [modelShort];
    body = [ctxShort];
    line = build(head, body);
    if (!fits()) line = modelShort;
    if (!fits()) line = '';
  }

  process.stdout.write(line);
}

let stdinRaw = '';
try {
  stdinRaw = fs.readFileSync(0, 'utf8');
  render(stdinRaw);
} catch {
  // Never leave the bar blank because of an unexpected payload.
  try {
    const j = JSON.parse(stdinRaw);
    const m = safeText((j.model && (j.model.display_name || j.model.id)) || 'claude');
    process.stdout.write(S.model + '✻ ' + m + RESET);
  } catch {}
}
