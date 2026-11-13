import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeStructuredLogsSync,
  flushStructuredLogs,
  openStructuredLogs,
  resetStructuredLogsForTest,
  setStructuredLogLevel,
  writeStructuredLog,
} from './sink';

let userDataPath: string;

beforeEach(async () => {
  resetStructuredLogsForTest();
  userDataPath = await mkdtemp(path.join(os.tmpdir(), 'structured-log-sink-'));
});

afterEach(async () => {
  resetStructuredLogsForTest();
  await rm(userDataPath, { force: true, recursive: true });
});

const readRecords = async (file: string) =>
  (await readFile(path.join(userDataPath, 'logs', file), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

describe('structured log sink', () => {
  it('writes lines logged before opening, per process, at or above the minimum level', async () => {
    writeStructuredLog({
      level: 'info',
      message: 'logged while importing',
      ns: 'early',
      process: 'main',
    });
    writeStructuredLog({ level: 'debug', message: 'below minimum', process: 'main' });

    await openStructuredLogs({
      appVersion: '9.9.9',
      isPackaged: true,
      minLevel: 'info',
      userDataPath,
    });
    writeStructuredLog({ level: 'warn', message: 'window warning', process: 'renderer' });
    await flushStructuredLogs();

    expect(await readRecords('main.jsonl')).toEqual([
      expect.objectContaining({ appVersion: '9.9.9', msg: 'logged while importing', ns: 'early' }),
    ]);
    expect(await readRecords('renderer.jsonl')).toEqual([
      expect.objectContaining({ level: 'warn', msg: 'window warning', process: 'renderer' }),
    ]);
  });

  it('writes a manifest that is stamped with endedAt on a clean exit', async () => {
    await openStructuredLogs({
      isPackaged: false,
      minLevel: 'debug',
      now: () => new Date('2026-11-12T10:00:00.000Z'),
      userDataPath,
    });
    const manifestPath = path.join(userDataPath, 'logs', 'manifest.json');

    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual({
      files: { main: 'main.jsonl', renderer: 'renderer.jsonl' },
      isPackaged: false,
      pid: process.pid,
      startedAt: '2026-11-12T10:00:00.000Z',
      userData: userDataPath,
    });

    closeStructuredLogsSync({ endedAt: new Date('2026-11-12T11:00:00.000Z'), exitCode: 0 });
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toMatchObject({
      endedAt: '2026-11-12T11:00:00.000Z',
      exitCode: 0,
    });

    closeStructuredLogsSync({ endedAt: new Date('2026-11-12T11:00:01.000Z'), exitCode: 7 });
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toMatchObject({ exitCode: 7 });
  });

  it('applies a level set before open to buffered startup lines, and changes it live', async () => {
    writeStructuredLog({ level: 'debug', message: 'startup debug', process: 'main' });
    setStructuredLogLevel('debug');
    await openStructuredLogs({ isPackaged: true, minLevel: 'info', userDataPath });

    setStructuredLogLevel('info');
    writeStructuredLog({ level: 'debug', message: 'after switching off', process: 'main' });
    writeStructuredLog({ level: 'info', message: 'still recorded', process: 'main' });
    await flushStructuredLogs();

    expect((await readRecords('main.jsonl')).map((record) => record.msg)).toEqual([
      'startup debug',
      'still recorded',
    ]);
  });
});
