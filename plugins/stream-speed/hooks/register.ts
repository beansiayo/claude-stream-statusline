import type { Register } from 'claude-code';

type Reading = {
  status: 'observed' | 'burst' | 'insufficient' | 'unavailable' | 'interrupted';
  sample: { tokens: number; seconds: number; tps: number } | null;
  timing: { requestSeconds: number; outputSpanSeconds: number; deltaCount: number; spacedGaps: number };
};

export const register: Register = (on) => {
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e);

    const sessionId = await $.session.id();
    const configured = await $.env.get('CLAUDE_CONFIG_DIR');
    const home = await $.env.get('HOME');
    const configDir = configured || (home && `${home}/.claude`);
    if (!configDir || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) return yield* next(e);
    const file = `${configDir}/stream-speed/${sessionId}.json`;
    const started = performance.now();
    let first: number | undefined;
    let last: number | undefined;
    let deltaCount = 0;
    let spacedGaps = 0;
    let reading: Reading | undefined;
    let completed = false;
    const stream = next(e);
    // These conservative checks reject obvious bursts; they cannot prove that
    // upstream generation was unbuffered. A passing rate is receive throughput.
    const timing = (now: number) => ({
      requestSeconds: (now - started) / 1000,
      outputSpanSeconds: first === undefined || last === undefined ? 0 : (last - first) / 1000,
      deltaCount,
      spacedGaps,
    });
    try {
      for (;;) {
        const item = await stream.next();
        if (item.done) {
          completed = true;
          return item.value;
        }
        const chunk = item.value;
        const now = performance.now();
        const delta = ((chunk.kind === 'text' || chunk.kind === 'thinking') && chunk.text.length > 0)
          || (chunk.kind === 'input' && chunk.json.length > 0)
          || chunk.kind === 'tool';
        if (delta) {
          // A subsequent response must not reuse a preceding stop's usage.
          if (reading) { first = undefined; last = undefined; deltaCount = 0; spacedGaps = 0; reading = undefined; }
          if (first === undefined) first = now;
          if (last !== undefined && now - last >= 20) spacedGaps++;
          last = now;
          deltaCount++;
        }
        if (chunk.kind === 'stop') {
          const tokens = chunk.usage?.output_tokens;
          const seconds = first === undefined ? 0 : (now - first) / 1000;
          const facts = timing(now);
          const validUsage = typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0;
          let status: Reading['status'] = 'unavailable';
          if (chunk.stopReason === null) status = 'interrupted';
          else if (validUsage && first !== undefined) {
            if (facts.outputSpanSeconds < 0.5) status = 'burst';
            else if (deltaCount < 3 || spacedGaps < 2) status = 'insufficient';
            else if (seconds > 0 && Number.isFinite(tokens / seconds)) status = 'observed';
          }
          reading = { status, sample: status === 'observed' ? { tokens: tokens!, seconds, tps: tokens! / seconds } : null, timing: facts };
        }
        yield chunk;
      }
    } finally {
      try {
        const result: Reading = completed && reading ? reading : {
          status: completed ? 'unavailable' : 'interrupted', sample: null, timing: timing(performance.now()),
        };
        // Keep the previous reading during generation, but never substitute it
        // for the outcome of a completed, unmeasurable response.
        await $.fs.write(file, JSON.stringify({ version: 2, sessionId, ...result }));
      } catch {}
      await stream.return(undefined as never);
    }
  });
};
