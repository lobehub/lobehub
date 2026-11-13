import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  collectRecentLogLines,
  getDiagnosticsFileName,
  openGenerations,
  writeDiagnosticsBundle,
} from './bundle';

const NOW = new Date('2026-11-13T08:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const record = (msg: string, hoursAgo: number) =>
  JSON.stringify({
    level: 'info',
    msg,
    pid: 1,
    process: 'main',
    ts: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
  });

describe('writeDiagnosticsBundle', () => {
  let root: string;
  let logDirectory: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'lobe-diagnostics-'));
    logDirectory = path.join(root, 'logs');
    await mkdir(logDirectory);
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it('zips the last day of logs across rotated files, oldest first, with manifest and system info', async () => {
    await writeFile(
      path.join(logDirectory, 'main.jsonl.2'),
      `${record('two days ago', 48)}\n${record('older rotation', 20)}\n`,
    );
    await writeFile(path.join(logDirectory, 'main.jsonl.1'), `${record('newer rotation', 5)}\n`);
    await writeFile(
      path.join(logDirectory, 'main.jsonl'),
      `${record('live', 0.1)}\n{"ts":"torn line\n`,
    );
    await writeFile(path.join(logDirectory, 'manifest.json'), '{"pid":1}\n');

    const result = await writeDiagnosticsBundle({
      logDirectory,
      now: NOW,
      outputDirectory: root,
      systemInfo: { app: { version: '2.0.0' } },
    });

    expect(result.fileName).toBe(getDiagnosticsFileName(NOW));
    expect(result.filePath).toBe(path.join(root, result.fileName));

    const entries = unzipSync(new Uint8Array(await readFile(result.filePath)));
    expect(Object.keys(entries).sort()).toEqual(['main.jsonl', 'manifest.json', 'system.json']);

    const main = strFromU8(entries['main.jsonl']).trim().split('\n');
    expect(main.map((line) => line.match(/"msg":"([^"]+)"/)?.[1] ?? line)).toEqual([
      'older rotation',
      'newer rotation',
      'live',
      '{"ts":"torn line',
    ]);
    expect(strFromU8(entries['manifest.json'])).toBe('{"pid":1}\n');
    expect(JSON.parse(strFromU8(entries['system.json']))).toEqual({
      app: { version: '2.0.0' },
      exportedAt: NOW.toISOString(),
      logsSince: new Date(NOW.getTime() - 24 * HOUR).toISOString(),
    });
  });

  it('still writes system info when no log has been recorded yet', async () => {
    const result = await writeDiagnosticsBundle({
      logDirectory,
      now: NOW,
      outputDirectory: root,
      systemInfo: {},
    });

    const entries = unzipSync(new Uint8Array(await readFile(result.filePath)));
    expect(Object.keys(entries)).toEqual(['system.json']);
    expect(result.size).toBeGreaterThan(0);
  });
});

describe('collectRecentLogLines', () => {
  let logDirectory: string;

  beforeEach(async () => {
    logDirectory = await mkdtemp(path.join(os.tmpdir(), 'lobe-diagnostics-rotate-'));
  });

  afterEach(async () => {
    await rm(logDirectory, { force: true, recursive: true });
  });

  it('keeps every generation when the writer rotates after the files are opened', async () => {
    const file = (suffix = '') => path.join(logDirectory, `main.jsonl${suffix}`);
    await writeFile(file('.2'), `${record('gen 2', 3)}\n`);
    await writeFile(file('.1'), `${record('gen 1', 2)}\n`);
    await writeFile(file(), `${record('live', 1)}\n`);

    const handles = await openGenerations(logDirectory, 'main.jsonl');
    // The writer's rotate(): every generation moves up by one and a fresh live file starts.
    await rename(file('.2'), file('.3'));
    await rename(file('.1'), file('.2'));
    await rename(file(), file('.1'));
    await writeFile(file(), `${record('after rotation', 0)}\n`);

    const content = await collectRecentLogLines(handles, NOW.getTime() - 24 * HOUR);
    expect(
      content
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).msg),
    ).toEqual(['gen 2', 'gen 1', 'live']);
  });

  it('retakes the snapshot when the writer rotates between opening two files', async () => {
    const file = (suffix = '') => path.join(logDirectory, `main.jsonl${suffix}`);
    await writeFile(file('.2'), `${record('gen 2', 3)}\n`);
    await writeFile(file('.1'), `${record('gen 1', 2)}\n`);
    await writeFile(file(), `${record('live', 1)}\n`);

    let rotated = false;
    const openFile = async (filePath: string) => {
      const handle = await open(filePath, 'r');
      // Rotate right after `.2` is opened: the next open of `.1` then gets the old live
      // file, so a single pass would lose "gen 1".
      if (!rotated && filePath === file('.2')) {
        rotated = true;
        await rename(file('.2'), file('.3'));
        await rename(file('.1'), file('.2'));
        await rename(file(), file('.1'));
        await writeFile(file(), `${record('after rotation', 0)}\n`);
      }
      return handle;
    };

    const handles = await openGenerations(logDirectory, 'main.jsonl', openFile);
    const content = await collectRecentLogLines(handles, NOW.getTime() - 24 * HOUR);
    expect(
      content
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).msg),
    ).toEqual(['gen 2', 'gen 1', 'live', 'after rotation']);
  });
});

describe('getDiagnosticsFileName', () => {
  it('stamps the local time', () => {
    expect(getDiagnosticsFileName(new Date(2026, 10, 3, 9, 5, 7))).toBe(
      'LobeHub-diagnostics-20261103-090507.zip',
    );
  });
});
