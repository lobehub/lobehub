import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as layout from '../../src/main/utils/structuredLog/layout';
import {
  createFollowCursors,
  describeRun,
  discoverLogDirectories,
  formatRecord,
  getLogFileName,
  LOG_DIRECTORY_NAME,
  LOG_LEVEL_RANK,
  LOG_MANIFEST_FILE,
  LOG_PROCESSES,
  type LogFilter,
  type LogRecord,
  matchesFilter,
  MAX_LOG_GENERATIONS,
  parseTimeBound,
  queryLogs,
  readAppended,
} from '../desktopLogs.mts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'desktop-logs-cli-'));
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

const record = (overrides: Partial<LogRecord>): LogRecord => ({
  level: 'info',
  msg: 'message',
  pid: 1,
  process: 'main',
  ts: '2026-11-12T10:00:00.000Z',
  ...overrides,
});
const toLine = (value: LogRecord) => `${JSON.stringify(value)}\n`;
const allProcesses: LogFilter = { processes: LOG_PROCESSES };

describe('layout parity', () => {
  it('reads the files the main process writes', () => {
    expect(LOG_DIRECTORY_NAME).toBe(layout.LOG_DIRECTORY_NAME);
    expect(LOG_MANIFEST_FILE).toBe(layout.LOG_MANIFEST_FILE);
    expect(LOG_PROCESSES).toEqual(layout.LOG_PROCESSES);
    expect(LOG_LEVEL_RANK).toEqual(layout.LOG_LEVEL_RANK);
    expect(MAX_LOG_GENERATIONS).toBe(layout.MAX_LOG_GENERATIONS);
    expect(getLogFileName('main')).toBe(layout.getLogFileName('main'));
  });
});

describe('matchesFilter', () => {
  const opRecord = record({
    level: 'warn',
    ns: 'Gateway',
    operationId: 'op_1_a',
    topicId: 'tpc_a',
  });
  const line = toLine(opRecord);

  it('applies level, namespace, process and id filters', () => {
    expect(matchesFilter(opRecord, line, { ...allProcesses, minLevel: 'info' })).toBe(true);
    expect(matchesFilter(opRecord, line, { ...allProcesses, minLevel: 'error' })).toBe(false);
    expect(matchesFilter(opRecord, line, { ...allProcesses, ns: 'gate' })).toBe(true);
    expect(matchesFilter(opRecord, line, { processes: ['renderer'] })).toBe(false);
    expect(matchesFilter(opRecord, line, { ...allProcesses, operationId: 'op_1_a' })).toBe(true);
    expect(matchesFilter(opRecord, line, { ...allProcesses, topicId: 'tpc_b' })).toBe(false);
  });

  it('finds a second id that only appears in the arguments', () => {
    const value = record({ args: [{ next: 'op_2_b' }], operationId: 'op_1_a' });
    expect(matchesFilter(value, toLine(value), { ...allProcesses, operationId: 'op_2_b' })).toBe(
      true,
    );
  });

  it('bounds by time, relative or absolute', () => {
    const now = Date.parse('2026-11-12T10:10:00.000Z');
    const since = parseTimeBound('5m', now);
    expect(matchesFilter(opRecord, line, { ...allProcesses, since })).toBe(false);
    expect(parseTimeBound('2026-11-12T10:00:00.000Z')).toBe(Date.parse(opRecord.ts));
    expect(() => parseTimeBound('soon')).toThrow(/Invalid time/);
  });
});

describe('queryLogs', () => {
  it('merges processes and rotated files in time order and keeps the last matches', async () => {
    const directory = path.join(root, 'logs');
    await mkdir(directory);
    await writeFile(
      path.join(directory, 'main.jsonl.1'),
      toLine(record({ msg: 'old main', ts: '2026-11-12T10:00:01.000Z' })),
    );
    await writeFile(
      path.join(directory, 'main.jsonl'),
      toLine(record({ msg: 'new main', ts: '2026-11-12T10:00:03.000Z' })) + 'not json\n',
    );
    await writeFile(
      path.join(directory, 'renderer.jsonl'),
      toLine(record({ msg: 'renderer', process: 'renderer', ts: '2026-11-12T10:00:02.000Z' })),
    );

    const all = await queryLogs(directory, allProcesses, 10);
    expect(all.map((match) => match.record.msg)).toEqual(['old main', 'renderer', 'new main']);

    const last = await queryLogs(directory, allProcesses, 2);
    expect(last.map((match) => match.record.msg)).toEqual(['renderer', 'new main']);
  });
});

describe('createFollowCursors', () => {
  it('hands lines written during the initial tail to follow, whole and once', async () => {
    const directory = path.join(root, 'logs');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'main.jsonl');
    const partial = toLine(record({ msg: 'mid-append', ts: '2026-11-12T10:00:01.000Z' }));
    await writeFile(
      file,
      toLine(record({ msg: 'before', ts: '2026-11-12T10:00:00.000Z' })) + partial.slice(0, 10),
    );
    const filter: LogFilter = { processes: ['main'] };

    const cursors = await createFollowCursors(directory, filter);
    await appendFile(
      file,
      partial.slice(10) + toLine(record({ msg: 'during tail', ts: '2026-11-12T10:00:02.000Z' })),
    );

    const tail = await queryLogs(directory, filter, 10, cursors);
    expect(tail.map((match) => match.record.msg)).toEqual(['before']);
    const followed = (await readAppended(file, cursors.get(file)!)).map(
      (line) => JSON.parse(line).msg,
    );
    expect(followed).toEqual(['mid-append', 'during tail']);
  });
});

describe('readAppended', () => {
  it('follows a file across rotation without losing the old tail', async () => {
    const file = path.join(root, 'main.jsonl');
    await writeFile(file, 'a\nb');
    const cursor = { offset: 0, remainder: '' };

    expect(await readAppended(file, cursor)).toEqual(['a']);
    await appendFile(file, '\nc\n');
    await rename(file, `${file}.1`);
    await writeFile(file, 'd\n');

    expect(await readAppended(file, cursor)).toEqual(['b', 'c', 'd']);
  });
});

describe('discoverLogDirectories', () => {
  it('finds a managed checkout profile above the working directory', async () => {
    const logs = path.join(root, '.cache', 'desktop-user-data', 'logs');
    await mkdir(logs, { recursive: true });
    await writeFile(path.join(logs, 'manifest.json'), '{}');
    const nested = path.join(root, 'lobehub', 'apps', 'desktop');
    await mkdir(nested, { recursive: true });

    expect(await discoverLogDirectories(nested)).toContain(logs);
  });
});

describe('describeRun', () => {
  const manifest = { isPackaged: false, pid: 7, startedAt: '', userData: '' };

  it('tells a running, exited and crashed run apart', () => {
    expect(describeRun(manifest, () => true)).toBe('running (pid 7)');
    expect(describeRun({ ...manifest, endedAt: 'T' }, () => true)).toBe('exited T');
    expect(describeRun({ ...manifest, endedAt: 'T', exitCode: 0 }, () => true)).toBe('exited T');
    expect(describeRun({ ...manifest, endedAt: 'T', exitCode: 7 }, () => false)).toBe(
      'crashed (exit code 7) T',
    );
    expect(describeRun(manifest, () => false)).toBe('crashed or killed (pid 7)');
  });
});

describe('formatRecord', () => {
  it('prints one readable line', () => {
    expect(
      formatRecord(
        record({
          args: [{ a: 1 }],
          ns: 'Menu',
          source: 'app.ts:3',
          ts: '2026-11-12T10:00:00.123Z',
        }),
      ),
    ).toBe('10:00:00.123 INFO  main     [Menu] message [{"a":1}] (app.ts:3)');
  });
});
