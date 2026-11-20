import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonlLogWriter } from './writer';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'structured-log-writer-'));
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

const line = (index: number) => `${JSON.stringify({ index, msg: 'x'.repeat(40) })}\n`;

describe('JsonlLogWriter', () => {
  it('appends queued lines in order', async () => {
    const filePath = path.join(directory, 'main.jsonl');
    const writer = new JsonlLogWriter({ filePath, process: 'main' });
    writer.write(line(1));
    writer.write(line(2));
    await writer.flush();

    expect(await readFile(filePath, 'utf8')).toBe(line(1) + line(2));
  });

  it('rotates past the size cap and keeps a bounded number of generations', async () => {
    const filePath = path.join(directory, 'main.jsonl');
    const writer = new JsonlLogWriter({
      filePath,
      maxBytes: line(0).length * 2,
      maxGenerations: 2,
      process: 'main',
    });
    for (let index = 0; index < 8; index += 1) {
      writer.write(line(index));
      await writer.flush();
    }

    expect(await readFile(filePath, 'utf8')).toBe(line(6) + line(7));
    expect(await readFile(`${filePath}.1`, 'utf8')).toBe(line(4) + line(5));
    expect(await readFile(`${filePath}.2`, 'utf8')).toBe(line(2) + line(3));
    await expect(stat(`${filePath}.3`)).rejects.toThrow();
  });

  it('drops lines past the pending cap and records how many', async () => {
    const filePath = path.join(directory, 'main.jsonl');
    const writer = new JsonlLogWriter({
      filePath,
      maxPendingBytes: line(0).length * 2,
      process: 'main',
    });
    for (let index = 0; index < 5; index += 1) writer.write(line(index));
    await writer.flush();

    const lines = (await readFile(filePath, 'utf8')).trim().split('\n');
    expect(lines.slice(0, 2)).toEqual([line(0).trim(), line(1).trim()]);
    expect(JSON.parse(lines[2])).toMatchObject({
      level: 'warn',
      msg: expect.stringContaining('dropped 3'),
      process: 'main',
    });
  });

  it('flushSync writes what is still queued, for the exit hook', async () => {
    const filePath = path.join(directory, 'main.jsonl');
    const writer = new JsonlLogWriter({ filePath, process: 'main' });
    writer.write(line(1));
    writer.flushSync();

    expect(await readFile(filePath, 'utf8')).toBe(line(1));
  });

  it('flushSync keeps a batch whose async append is still pending at exit', async () => {
    const filePath = path.join(directory, 'main.jsonl');
    const writer = new JsonlLogWriter({ filePath, process: 'main' });
    writer.write(line(1));
    const pending = writer.flush();
    writer.flushSync();

    expect(readFileSync(filePath, 'utf8')).toContain(line(1));
    await pending;
  });
});
