// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FtsSearchReindexFileLogger, summarizeFtsSearchReindexError } from '../auditLogger';

let stateDirectory: string;

beforeEach(async () => {
  stateDirectory = await mkdtemp(path.join(tmpdir(), 'search-reindex-logger-test-'));
});

afterEach(async () => {
  await rm(stateDirectory, { force: true, recursive: true });
});

describe('FtsSearchReindexFileLogger', () => {
  it('appends ordered JSONL events and atomically writes a private summary', async () => {
    const logger = new FtsSearchReindexFileLogger({
      runId: 'run-1',
      sessionId: 'session-1',
      stateDirectory,
    });

    await Promise.all([
      logger.append({ entity: 'agents', processed: 100, type: 'batch_checkpointed' }),
      logger.append({ entity: 'topics', processed: 50, type: 'batch_checkpointed' }),
    ]);
    await logger.writeSummary({ failed: 0, indexed: 150, status: 'backfilling' });

    const runDirectory = path.join(stateDirectory, 'runs', 'run-1');
    const events = (await readFile(path.join(runDirectory, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events).toMatchObject([
      { entity: 'agents', processed: 100, runId: 'run-1', sessionId: 'session-1' },
      { entity: 'topics', processed: 50, runId: 'run-1', sessionId: 'session-1' },
    ]);
    await expect(readFile(path.join(runDirectory, 'summary.json'), 'utf8')).resolves.toContain(
      '"indexed": 150',
    );
    expect((await stat(runDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(runDirectory, 'events.jsonl'))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(runDirectory, 'summary.json'))).mode & 0o777).toBe(0o600);
  });

  it('refuses credential-shaped fields before writing an audit event', async () => {
    const logger = new FtsSearchReindexFileLogger({
      runId: 'run-1',
      sessionId: 'session-1',
      stateDirectory,
    });

    expect(() => logger.append({ apiKey: 'secret', type: 'unsafe_event' })).toThrow(
      'credential-shaped field',
    );
  });

  it('redacts connection URLs and credential assignments from failure summaries', () => {
    const summary = summarizeFtsSearchReindexError(
      new Error('connect postgres://operator:private@database.example.com/app token=private-token'),
    );

    expect(summary).toContain('[redacted-url]');
    expect(summary).toContain('token=[redacted]');
    expect(summary).not.toContain('operator');
    expect(summary).not.toContain('private');
  });
});
