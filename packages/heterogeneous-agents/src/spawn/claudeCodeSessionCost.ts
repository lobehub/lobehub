import { open } from 'node:fs/promises';

import { resolveClaudeCodeTranscriptPath } from './ensureResumeTranscript';

/** Tail window read per step while scanning backwards for the last cost-state. */
const CHUNK_BYTES = 64 * 1024;

/**
 * A cost-state record is a few hundred bytes. Any longer line (a large tool
 * result, a pasted file) cannot be one, so it is skipped by offset without
 * ever being buffered.
 */
const MAX_COST_STATE_LINE_BYTES = 16 * 1024;

const COST_STATE_MARKER = '"type":"cost-state"';

const NEWLINE = 0x0a;

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
 * so the file is scanned backwards in fixed chunks for line boundaries instead
 * of loading a transcript that can reach tens of megabytes. Only short lines
 * are ever decoded; memory stays bounded by one chunk plus one candidate line
 * however long the records behind the tail are.
 */
export const readTranscriptSessionCost = async (filePath: string): Promise<number | undefined> => {
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch {
    return undefined;
  }

  try {
    const fileHandle = handle;
    const chunk = Buffer.alloc(CHUNK_BYTES);
    let chunkStart = 0;
    let chunkEnd = 0;

    /** Decode `[start, end)` if it is short enough to be a cost-state record. */
    const readLine = async (start: number, end: number): Promise<number | undefined> => {
      const length = end - start;
      if (length <= 0 || length > MAX_COST_STATE_LINE_BYTES) return undefined;
      if (start >= chunkStart && end <= chunkEnd) {
        return parseCostState(chunk.toString('utf8', start - chunkStart, end - chunkStart));
      }
      // The line straddles a chunk boundary: read just its bytes.
      const line = Buffer.alloc(length);
      await fileHandle.read(line, 0, length, start);
      return parseCostState(line.toString('utf8'));
    };

    const { size } = await fileHandle.stat();
    // Exclusive end of the line currently being walked back over.
    let lineEnd = size;
    let position = size;

    while (position > 0) {
      const length = Math.min(CHUNK_BYTES, position);
      position -= length;
      await fileHandle.read(chunk, 0, length, position);
      chunkStart = position;
      chunkEnd = position + length;

      for (let i = length - 1; i >= 0; i -= 1) {
        if (chunk[i] !== NEWLINE) continue;
        const lineStart = position + i + 1;
        const cost = await readLine(lineStart, lineEnd);
        if (cost !== undefined) return cost;
        lineEnd = position + i;
      }
    }

    return await readLine(0, lineEnd);
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
