import type { Register } from 'claude-code';

export const register: Register = (on) => {
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e);

    const sessionId = await $.session.id();
    const configured = await $.env.get('CLAUDE_CONFIG_DIR');
    const home = await $.env.get('HOME');
    const configDir = configured || (home && `${home}/.claude`);
    if (!configDir || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) return yield* next(e);
    const file = `${configDir}/stream-speed/${sessionId}.json`;
    // Never clear the last valid sample when the next request starts.
    let first: number | undefined;
    let sample: { tokens: number; seconds: number; tps: number } | null = null;
    const stream = next(e);
    try {
      for (;;) {
        const item = await stream.next();
        if (item.done) {
          if (sample) {
            try {
              await $.fs.write(file, JSON.stringify({ version: 1, sessionId, sample }));
            } catch {}
          }
          return item.value;
        }
        const chunk = item.value;
        const now = performance.now();
        const delta = ((chunk.kind === 'text' || chunk.kind === 'thinking') && chunk.text.length > 0)
          || (chunk.kind === 'input' && chunk.json.length > 0)
          || chunk.kind === 'tool';
        if (first === undefined && delta) first = now;
        if (chunk.kind === 'stop') {
          const tokens = chunk.usage?.output_tokens;
          const seconds = first === undefined ? 0 : (now - first) / 1000;
          sample = typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0
            && seconds > 0 && Number.isFinite(tokens / seconds) && chunk.stopReason !== null
            ? { tokens, seconds, tps: tokens / seconds } : null;
          first = undefined;
        }
        yield chunk;
      }
    } finally {
      // Forward cancellation to the underlying stream as well.
      await stream.return(undefined as never);
    }
  });
};
