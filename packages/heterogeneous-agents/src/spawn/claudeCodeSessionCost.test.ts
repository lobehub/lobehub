import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readClaudeCodeSessionCost, readTranscriptSessionCost } from './claudeCodeSessionCost';
import { resolveClaudeCodeTranscriptPath } from './ensureResumeTranscript';

const SESSION_ID = '72f65fa9-0355-45d3-b903-8f41027ed5f2';

const costState = (totalCostUSD: number) =>
  JSON.stringify({ sessionId: SESSION_ID, totalCostUSD, type: 'cost-state' });
const turn = (text: string) =>
  JSON.stringify({ message: { content: text, role: 'user' }, type: 'user' });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cc-cost-'));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

const writeTranscript = async (lines: string[]) => {
  const file = path.join(dir, 'session.jsonl');
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
};

describe('readTranscriptSessionCost', () => {
  it('returns the newest cost-state the session ended a run with', async () => {
    const file = await writeTranscript([
      turn('a'),
      costState(4.01),
      turn('b'),
      costState(38.09),
      turn('c'),
    ]);

    expect(await readTranscriptSessionCost(file)).toBe(38.09);
  });

  it('finds a cost-state far behind the tail and across chunk boundaries', async () => {
    // ~400KB of later records pushes the cost-state several 64KB chunks back;
    // odd-sized lines make a chunk boundary land inside the record.
    const filler = Array.from({ length: 3000 }, (_, i) => turn(`${'x'.repeat(100 + (i % 37))}`));
    const file = await writeTranscript([turn('start'), costState(12.5), ...filler]);

    expect(await readTranscriptSessionCost(file)).toBe(12.5);
  });

  it('reaches a cost-state behind a single multi-megabyte record', async () => {
    // An interrupted run can leave one huge tool-result line after the last
    // cost-state; it is stepped over by offset, never accumulated.
    const huge = JSON.stringify({ content: 'y'.repeat(5 * 1024 * 1024), type: 'user' });
    const file = await writeTranscript([costState(7.25), huge]);

    expect(await readTranscriptSessionCost(file)).toBe(7.25);
  });

  it('reads a cost-state on the first line without a trailing newline', async () => {
    const file = path.join(dir, 'single.jsonl');
    await writeFile(file, costState(1.5));

    expect(await readTranscriptSessionCost(file)).toBe(1.5);
  });

  it('returns undefined for a transcript without cost-state or a missing file', async () => {
    // a transcript LobeHub rebuilt after CC's GC carries no cost-state
    const file = await writeTranscript([turn('a'), turn('b')]);

    expect(await readTranscriptSessionCost(file)).toBeUndefined();
    expect(await readTranscriptSessionCost(path.join(dir, 'missing.jsonl'))).toBeUndefined();
  });
});

describe('readClaudeCodeSessionCost', () => {
  it('reads the transcript `--resume` loads for the session', async () => {
    const cwd = path.join(dir, 'repo');
    await mkdir(cwd);
    const configDir = path.join(dir, 'profile');
    const file = (await resolveClaudeCodeTranscriptPath({
      configDir,
      cwd,
      sessionId: SESSION_ID,
    }))!;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${costState(69.67)}\n`);

    expect(await readClaudeCodeSessionCost({ configDir, cwd, sessionId: SESSION_ID })).toBe(69.67);
    expect(
      await readClaudeCodeSessionCost({ configDir, cwd, sessionId: '../../escape' }),
    ).toBeUndefined();
  });
});
