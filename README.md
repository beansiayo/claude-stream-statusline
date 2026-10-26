# Claude Stream Statusline

**English** | [简体中文](README.zh-CN.md)

A compact, single-line Claude Code status bar showing the model, reasoning effort, working directory, Git branch, context usage, output tokens, cache hit rate, and generation throughput measured from streaming events.

```text
✻ Example Model · high · ~/project · ⎇ main │ ctx █───────── 81k/1M 8.1% │ out 600 │ cache 72k (89%) │ 200 tok/s
```

This is a layout example, not a benchmark. The status line drops less essential details as the terminal narrows. Light and dark terminals use separate palettes. Speeds below 50 tok/s appear yellow; speeds of 50 tok/s or above appear green.

## Compatibility

- Node.js 24 or later. No npm dependencies; `npm install` is unnecessary.
- The installer supports macOS and Linux. Windows is not supported yet.
- The renderer uses Claude Code's `statusLine` JSON input.
- **Speed measurement is an optional plugin requiring the `turn.step` hooks module API**, including streaming `text`, `thinking`, `input`, `tool`, and `stop` events, `performance.now()`, `$.env.get`, and `$.fs.write`. The original prototype ran locally on Claude Code 2.1.310; that does not guarantee these interfaces exist in every distribution or release channel, even with the same version number. Run the plugin validation command below before installing. If the interfaces are unavailable, use the status line alone: speed will show `—`, without substituting transcript-based estimates.
- This repository's portable version has been tested with simulated streams, renderer tests, and isolated installation tests. It has not been verified on every platform.

## Installation

Download and extract the ZIP, or clone this repository from GitHub. From the project root, run:

```sh
node --version
node scripts/install.cjs
```

The installer changes only `statusLine` in your user settings, preserving other configuration. On the first install, it backs up the original settings and status line. Reinstalling does not overwrite that first backup. Backups stay in your local configuration directory, outside this repository. Installation files live under:

```text
${CLAUDE_CONFIG_DIR:-~/.claude}/claude-stream-statusline/
```

The installed command uses the absolute path to your current Node executable. If you move or uninstall Node later, rerun the installer.

### Enable measured throughput

First check whether your CLI accepts the plugin interfaces, then install the plugin at user scope:

```sh
claude plugin validate ./plugins/stream-speed
claude plugin install stream-speed --marketplace "$PWD" --scope user
```

Do not proceed with plugin installation if validation fails. The base status line works independently. Directory-listing warnings about README files or icons are separate from hooks API validation errors; this project uses a local marketplace.

Restart Claude Code after installation. Use `claude --resume` to return to an existing conversation. Speed appears after a reply completes. Avoid loading multiple sources of a plugin named `stream-speed`, including development-session hot-reload copies. If you already use an older personal speed plugin, disable its source in `/plugin` before installing this one.

The local marketplace uses this repository directory as its source. Keep the directory available for future updates.

### Custom configuration directory

Use the same environment variable for installation and for launching Claude Code:

```sh
export CLAUDE_CONFIG_DIR="$HOME/.claude-custom"
node scripts/install.cjs
claude plugin install stream-speed --marketplace "$PWD" --scope user
claude
```

`--config-dir DIR` selects the directory the installer operates on. It does not set the environment for subsequent Claude processes.

## Metrics

| Metric | Meaning |
| --- | --- |
| `ctx 81k/1M 8.1%` | Latest request's input tokens, including cached tokens, divided by model capacity; not cumulative session input |
| Context bar | Uses the same denominator as the adjacent percentage; a full bar does not guarantee immediate compaction |
| `out` | Output tokens reported for the latest request |
| `cache` | Cache-read tokens for the latest request and their share of input tokens; `—` when unavailable |
| `tok/s` | Throughput of the most recent successfully completed reply with valid measurement data |

Throughput is calculated as:

```text
API-reported output tokens / (stop event arrival time − first non-empty output event arrival time)
```

Output events include text, thinking, tool names, and tool arguments. This excludes waiting before the first output and the time spent subsequently executing client-side tools. It measures client-observed streaming throughput, which can be affected by network buffering, whether thinking is fully streamed, server-side tools, and provider token accounting. It is not pure server-side GPU decoding speed. The value updates only after a completion event and final usage data arrive; **it is not a live, per-token rate**. The measurement approach is informed by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-chat/src/client/contract/turn-metrics.ts); its source code was not copied.

The previous result stays visible while a new request is in progress. On completion, it is replaced by that request's outcome: a qualified numeric reading is labeled `tok/s`; an obvious burst shows `n/a tok/s (burst)`; insufficiently spaced output shows `n/a tok/s (sparse)`; missing usage or interruption shows `— tok/s`. Earlier numbers are not substituted for an unmeasurable completed reply. Version 1 samples are ignored until the updated plugin writes a new reading. Each session has its own file; subagents do not overwrite it.

A numeric reading requires at least three non-empty output events, an output arrival span of at least 0.5 seconds, and at least two inter-event gaps of 20 milliseconds or more. These are conservative sampling heuristics, not proof of unbuffered generation: short genuine replies may be rejected, and longer buffered batches can still pass. No arbitrary speed ceiling is applied. The plugin records counts and timing summaries, not output content. Reliable upstream generation speed requires provider timing data or verified streaming passthrough; these client-side checks cannot reconstruct missing upstream timing.

## Configuration

Merge the variables you need into the `env` object in your own `settings.json`. **Do not replace the entire file.**

```json
{
  "env": {
    "STATUSLINE_SCHEME": "dark",
    "STATUSLINE_FAST_TPS": "50"
  }
}
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `STATUSLINE_SCHEME` | Automatic | `light` or `dark`; automatic detection checks COLORFGBG, then macOS appearance, and otherwise falls back to light |
| `STATUSLINE_FAST_TPS` | `50` | Displayed speeds at or above this threshold are green; lower speeds are yellow |
| `STATUSLINE_CTX_WINDOW` | Capacity from the input JSON | Overrides the displayed model capacity without changing actual model limits |
| `STATUSLINE_COMPACT_ESTIMATE` | Off | Set to `1` to display an estimated compaction threshold and use it as the progress denominator |

### Optional compaction threshold estimate

If your user settings contain a numeric `autoCompactWindow`, enabling the estimate can produce:

```text
ctx ███─────── 81k/~239k/1M 33.9%
```

The tilde in `~239k` marks an estimate. The formula is based on CLI 2.1.309: clamp the configured window to model capacity, subtract a 20k output reserve, then subtract a 13k buffer. If `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is set, use the smaller of its proportional threshold and the previous result.

This logic reads environment variables, the current model's configuration in user-level `settings.json` (matching only the original ID or the ID with its bracket suffix removed), and the top-level numeric configuration. It does not fully reproduce project settings merging, model aliases, experiments, output limits, or runtime states such as disabled automatic compaction. With `auto` or no numeric setting, no estimate is made. **It therefore does not promise an exact match with the built-in auto-compaction countdown.** This project does not set a 272k window or change any compaction configuration.

## Toggle, update, and uninstall

```sh
# Temporarily restore the original status line, or hide it if none existed
node scripts/toggle.cjs disable
node scripts/toggle.cjs enable

# After obtaining the latest repository version, reinstall and update the plugin
node scripts/install.cjs
claude plugin marketplace update stream-statusline-local
claude plugin update stream-speed@stream-statusline-local --scope user

# Uninstall; the first command is needed only if you installed the plugin
claude plugin uninstall stream-speed@stream-statusline-local --scope user
node scripts/uninstall.cjs
```

Restart your sessions after plugin updates. The uninstaller restores the original status line only if the current one still belongs to this project. If you subsequently switched to a different status line, it preserves that change. Other settings remain untouched. The uninstaller leaves the `stream-speed/` sample directory and marketplace registration in place. If desired, remove the registration with `claude plugin marketplace remove stream-statusline-local` and manually delete `stream-speed/` inside your configuration directory.

Ghostty users can bind the toggle script themselves. This project does not modify terminal settings or install a global command named `sl`.

## Data and permissions

The plugin stores only the session ID, output token count, elapsed time, and calculated rate locally. It does not store reply text, request content, or credentials, and it makes no additional network requests. The status line reads Git HEAD information for the working directory, compaction configuration from user settings, and measurement files. Do not upload your settings backups or sample directory to GitHub.

## Development and publishing

```sh
npm test
claude plugin validate ./plugins/stream-speed
```

Tests use temporary directories and simulated streams. They do not send model requests or modify your real configuration. The project includes a GitHub Actions workflow for Node 24 on macOS and Linux.

The suggested repository name is `claude-stream-statusline`. Upload this project, not your `~/.claude` directory. This is an independent community project, unaffiliated with Anthropic or DeepSeek. Released under the MIT license; see [LICENSE](LICENSE).
