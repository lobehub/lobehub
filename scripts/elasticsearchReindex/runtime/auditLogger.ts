import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { isRecord } from '@lobechat/utils/object';

import type { FtsSearchReindexProgressEvent } from './reindexService';

type JsonPrimitive = boolean | null | number | string;
export type FtsSearchReindexAuditValue =
  JsonPrimitive | FtsSearchReindexAuditValue[] | { [key: string]: FtsSearchReindexAuditValue };

export interface FtsSearchReindexAuditEvent {
  [key: string]: FtsSearchReindexAuditValue;
  type: string;
}

export interface FtsSearchReindexFileLoggerOptions {
  runId: string;
  sessionId: string;
  stateDirectory: string;
}

const FORBIDDEN_FIELD_PATTERN =
  /(?:api.?key|database.?url|dsn|elasticsearch.?url|password|secret|token|url)$/i;
const URL_PATTERN = /\b[a-z][a-z\d+.-]*:\/\/[^\s)\]}"']+/gi;
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /(api.?key|authorization|credential|password|secret|token)\s*[:=]\s*[^\s,;]+/gi;

export const summarizeFtsSearchReindexError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(URL_PATTERN, '[redacted-url]')
    .replaceAll(CREDENTIAL_ASSIGNMENT_PATTERN, '$1=[redacted]')
    .slice(0, 1000);
};

const assertCredentialSafe = (value: unknown, fieldPath = 'event'): void => {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertCredentialSafe(item, `${fieldPath}[${index}]`);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_PATTERN.test(key)) {
      throw new Error(`FTS reindex audit log refuses credential-shaped field ${fieldPath}.${key}`);
    }
    assertCredentialSafe(child, `${fieldPath}.${key}`);
  }
};

/** Private append-only operational audit log stored beside the durable reindex checkpoint. */
export class FtsSearchReindexFileLogger {
  readonly eventsPath: string;
  readonly runDirectory: string;
  readonly summaryPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: FtsSearchReindexFileLoggerOptions) {
    const safeRunId = options.runId.replaceAll(/[^\w-]/g, '_').slice(0, 128) || 'run';
    this.runDirectory = path.join(path.resolve(options.stateDirectory), 'runs', safeRunId);
    this.eventsPath = path.join(this.runDirectory, 'events.jsonl');
    this.summaryPath = path.join(this.runDirectory, 'summary.json');
  }

  private enqueue(operation: () => Promise<void>) {
    const result = this.writeQueue.then(operation);
    /** A failed append is returned to its caller without poisoning every later audit write. */
    this.writeQueue = result.catch(() => {});
    return result;
  }

  private async ensureRunDirectory() {
    await mkdir(this.runDirectory, { mode: 0o700, recursive: true });
  }

  append(event: FtsSearchReindexAuditEvent | FtsSearchReindexProgressEvent) {
    assertCredentialSafe(event);
    const record = {
      ...event,
      at: new Date().toISOString(),
      runId: this.options.runId,
      sessionId: this.options.sessionId,
    };
    return this.enqueue(async () => {
      await this.ensureRunDirectory();
      const file = await open(this.eventsPath, 'a', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
    });
  }

  writeSummary<Summary extends { [key: string]: FtsSearchReindexAuditValue }>(summary: Summary) {
    assertCredentialSafe(summary, 'summary');
    const record = {
      ...summary,
      runId: this.options.runId,
      updatedAt: new Date().toISOString(),
    };
    return this.enqueue(async () => {
      await this.ensureRunDirectory();
      const temporaryPath = `${this.summaryPath}.${process.pid}.${randomUUID()}.tmp`;
      let temporaryFile;
      try {
        temporaryFile = await open(temporaryPath, 'wx', 0o600);
        await temporaryFile.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
        await temporaryFile.sync();
        await temporaryFile.close();
        temporaryFile = undefined;
        await rename(temporaryPath, this.summaryPath);
        const directory = await open(this.runDirectory, 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      } catch (error) {
        await temporaryFile?.close().catch(() => {});
        await unlink(temporaryPath).catch(() => {});
        throw error;
      }
    });
  }
}
