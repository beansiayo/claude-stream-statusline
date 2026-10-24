# Stream Speed

Optional companion for Claude Stream Statusline. This plugin observes the main conversation's streaming output, times the interval from the first non-empty output event to the stop event, and divides API-reported output tokens by that interval. It keeps the last valid result during subsequent requests and interrupted responses. It stores only numeric measurements and the session identifier, never response text.

Requires the Claude Code hooks module API (`turn.step`, `$.env.get`, `$.fs.write`, and `$.session.id`). Validate against your own CLI before installing; interface availability can vary between distributions. Samples are written under `$CLAUDE_CONFIG_DIR/stream-speed` or `$HOME/.claude/stream-speed`. See the repository README for installation, compatibility limits, and uninstall instructions. MIT licensed.
