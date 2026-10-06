import { open } from 'node:fs/promises';

import { resolveClaudeCodeTranscriptPath } from './ensureResumeTranscript';

/** Tail window read per step while scanning backwards for the last cost-state. */
const CHUNK_BYTES = 64 * 1024;

const COST_STATE_MARKER = '"type":"cost-state"';

const parseCostState = (line: string): number | undefined => {
  if (!line.includes(COST_STATE_MARKER)) return undefined;
  try {
    const record = JSON.parse(line);
    return record?.type === 'cost-state' && typeof record.totalCostUSD === 'number'
      ? record.totalCostUSD
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Read the last `cost-state.totalCostUSD` from a Claude Code transcript.
 *
 * CC appends a `cost-state` record at the end of every run and restores the
 * newest one on `--resume`, which is why a resumed run's `total_cost_usd`
 * includes everything the session spent before. The record sits near the tail,
 * so the file is scanned backwards in chunks instead of loading a transcript
 * that can reach tens of megabytes.
 */
export const readTranscriptSessionCost = async (filePath: string): Promise<number | undefined> => {
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch {
    return undefined;
  }

  try {
    const { size } = await handle.stat();
    let position = size;
    // Bytes of a line cut by the previous (later) chunk boundary.
    let carry = Buffer.alloc(0);

    while (position > 0) {
      const length = Math.min(CHUNK_BYTES, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      await handle.read(chunk, 0, length, position);

      const buffer = Buffer.concat([chunk, carry]);
      const lines = buffer.toString('utf8').split('\n');
      // The first piece may be the tail of a line that starts in an earlier
      // chunk; keep it for the next round unless this is the file start.
      const head = position > 0 ? lines.shift() : undefined;

      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const cost = parseCostState(lines[i]);
        if (cost !== undefined) return cost;
      }

      carry = head === undefined ? Buffer.alloc(0) : Buffer.from(head, 'utf8');
    }

    return undefined;
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
};

/**
 * The cumulative cost a Claude Code session had reached before this run, read
 * from the transcript `--resume` will load. Undefined when the transcript or
 * its cost-state is missing (a rebuilt transcript has none — CC then restores
 * nothing and its total is already per-run). Never throws: a missing baseline
 * only means the reported total is kept as is.
 */
export const readClaudeCodeSessionCost = async (params: {
  /** Claude profile root selected through CLAUDE_CONFIG_DIR. */
  configDir?: string;
  cwd: string;
  sessionId: string;
}): Promise<number | undefined> => {
  try {
    const filePath = await resolveClaudeCodeTranscriptPath(params);
    return filePath ? await readTranscriptSessionCost(filePath) : undefined;
  } catch {
    return undefined;
  }
};
