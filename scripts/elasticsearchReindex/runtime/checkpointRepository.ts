import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import type {
  FtsSearchDocumentEntity,
  FtsSearchReindexEntityStatus,
  FtsSearchReindexRunStatus,
} from '@lobechat/types';
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { z } from 'zod';

import { getFtsSearchPhysicalIndexName } from '../../../packages/database/src/repositories/ftsSearchDocument';

export interface FtsSearchReindexBatchFailure {
  documentId: string;
  error: unknown;
  retryable: boolean;
}

export interface FtsSearchReindexBatchCheckpoint {
  cursor: string;
  entity: FtsSearchDocumentEntity;
  failures: FtsSearchReindexBatchFailure[];
  indexedCount: number;
  previousCursor: string | null;
  processedCount: number;
  runId: string;
}

export interface FtsSearchReindexEntityProgress {
  completedAt: string | null;
  cursor: string | null;
  entity: FtsSearchDocumentEntity;
  failedCount: number;
  indexedCount: number;
  physicalIndex: string;
  processedCount: number;
  status: FtsSearchReindexEntityStatus;
}

export interface FtsSearchReindexFailure {
  attempts: number;
  documentId: string;
  entity: FtsSearchDocumentEntity;
  error: string;
  resolvedAt: string | null;
  retryable: boolean;
}

export interface FtsSearchReindexRun {
  aliasesCreatedAt: string | null;
  /**
   * Highest allocated Outbox revision observed after backfill. This is not a committed snapshot
   * boundary, so incremental consumers must not discard rows at or below it.
   */
  backfillHighWaterRevision: number | null;
  baseRevision: number;
  /** Capture function and trigger definitions used while this reindex run was created. */
  captureFingerprint: string;
  createdAt: string;
  id: string;
  namespace: string;
  schemaVersion: number;
  status: FtsSearchReindexRunStatus;
  updatedAt: string;
}

export interface FtsSearchReindexRunState {
  progress: FtsSearchReindexEntityProgress[];
  run: FtsSearchReindexRun;
}

export interface FtsSearchReindexFileRepositoryOptions {
  readCaptureFingerprint: () => Promise<string>;
  readHighWaterRevision: () => Promise<number>;
  reserveRevisionWithWriteFence: () => Promise<number>;
  stateDirectory: string;
}

const CHECKPOINT_FORMAT_VERSION = 2;
const CHECKPOINT_FILE_PREFIX = 'reindex-';
const LOCK_RETRY_INTERVAL_MS = 50;
/** Local checkpoint operations are bounded file writes; an older lock is treated as crash residue. */
const LOCK_STALE_AFTER_MS = 30_000;
const LOCK_WAIT_TIMEOUT_MS = LOCK_STALE_AFTER_MS + 5_000;

const entitySchema = z.enum(FTS_SEARCH_DOCUMENT_ENTITIES);
const entityStatusSchema = z.enum(['pending', 'backfilling', 'completed']);
const runStatusSchema = z.enum([
  'backfilling',
  'ready_for_incremental_sync',
  'completed',
  'failed',
]);
const progressSchema = z.object({
  completedAt: z.string().datetime().nullable(),
  cursor: z.string().nullable(),
  entity: entitySchema,
  failedCount: z.number().int().nonnegative(),
  indexedCount: z.number().int().nonnegative(),
  physicalIndex: z.string().min(1),
  processedCount: z.number().int().nonnegative(),
  status: entityStatusSchema,
});
const failureSchema = z.object({
  attempts: z.number().int().positive(),
  documentId: z.string().min(1),
  entity: entitySchema,
  error: z.string(),
  resolvedAt: z.string().datetime().nullable(),
  retryable: z.boolean(),
});
const runSchema = z.object({
  aliasesCreatedAt: z.string().datetime().nullable(),
  backfillHighWaterRevision: z.number().int().nonnegative().nullable(),
  baseRevision: z.number().int().positive(),
  captureFingerprint: z.string().min(1),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
  namespace: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  status: runStatusSchema,
  updatedAt: z.string().datetime(),
});
const checkpointSchema = z
  .object({
    failures: z.array(failureSchema),
    formatVersion: z.literal(CHECKPOINT_FORMAT_VERSION),
    progress: z.array(progressSchema).length(FTS_SEARCH_DOCUMENT_ENTITIES.length),
    run: runSchema,
  })
  .superRefine((checkpoint, context) => {
    const entities = new Set(checkpoint.progress.map(({ entity }) => entity));
    if (entities.size !== FTS_SEARCH_DOCUMENT_ENTITIES.length) {
      context.addIssue({
        code: 'custom',
        message: 'FTS reindex checkpoint must contain each entity exactly once',
        path: ['progress'],
      });
    }
    for (const progress of checkpoint.progress) {
      const expectedIndex = getFtsSearchPhysicalIndexName(
        checkpoint.run.namespace,
        progress.entity,
        checkpoint.run.schemaVersion,
      );
      if (progress.physicalIndex !== expectedIndex) {
        context.addIssue({
          code: 'custom',
          message: `Expected physical index ${expectedIndex}`,
          path: ['progress', progress.entity, 'physicalIndex'],
        });
      }
    }
  });

type FtsSearchReindexCheckpointFile = z.infer<typeof checkpointSchema>;

const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 4000);

const now = () => new Date().toISOString();

const checkpointFileName = (namespace: string, schemaVersion: number) => {
  const safeNamespace = namespace.replaceAll(/[^\w-]/g, '_').slice(0, 80) || 'search';
  const namespaceHash = createHash('sha256').update(namespace).digest('hex').slice(0, 12);
  return `${CHECKPOINT_FILE_PREFIX}${safeNamespace}-${namespaceHash}-v${schemaVersion}.json`;
};

const stateOf = ({ progress, run }: FtsSearchReindexCheckpointFile): FtsSearchReindexRunState => ({
  progress,
  run,
});

const unresolvedFailureCount = (
  checkpoint: FtsSearchReindexCheckpointFile,
  entity: FtsSearchDocumentEntity,
) =>
  checkpoint.failures.filter((failure) => failure.entity === entity && !failure.resolvedAt).length;

const isMissingFileError = (error: unknown) => isRecord(error) && error.code === 'ENOENT';
const isExistingFileError = (error: unknown) => isRecord(error) && error.code === 'EEXIST';

/** Local, atomically written checkpoint storage for the one-shot Elasticsearch reindex CLI. */
export class FtsSearchReindexFileRepository {
  private readonly runPaths = new Map<string, string>();
  private readonly stateDirectory: string;

  constructor(private readonly options: FtsSearchReindexFileRepositoryOptions) {
    this.stateDirectory = path.resolve(options.stateDirectory);
  }

  private checkpointPath(namespace: string, schemaVersion: number) {
    return path.join(this.stateDirectory, checkpointFileName(namespace, schemaVersion));
  }

  private async findCheckpointPath(runId: string): Promise<string | undefined> {
    const checkpointPath = this.runPaths.get(runId);
    if (!checkpointPath) return;
    const checkpoint = await this.readCheckpoint(checkpointPath);
    if (checkpoint.run.id !== runId) {
      throw new Error(`FTS reindex checkpoint run ID changed unexpectedly: ${checkpointPath}`);
    }
    return checkpointPath;
  }

  private stateOf(
    checkpointPath: string,
    checkpoint: FtsSearchReindexCheckpointFile,
  ): FtsSearchReindexRunState {
    this.runPaths.set(checkpoint.run.id, checkpointPath);
    return stateOf(checkpoint);
  }

  private async readCheckpointIfExists(
    checkpointPath: string,
  ): Promise<FtsSearchReindexCheckpointFile | undefined> {
    let source: string;
    try {
      source = await readFile(checkpointPath, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }

    let json: unknown;
    try {
      json = JSON.parse(source);
    } catch (error) {
      throw new Error(`FTS reindex checkpoint is not valid JSON: ${checkpointPath}`, {
        cause: error,
      });
    }
    const parsed = checkpointSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`FTS reindex checkpoint is invalid: ${checkpointPath}`, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  private async readCheckpoint(checkpointPath: string): Promise<FtsSearchReindexCheckpointFile> {
    const checkpoint = await this.readCheckpointIfExists(checkpointPath);
    if (!checkpoint) throw new Error(`FTS reindex checkpoint does not exist: ${checkpointPath}`);
    return checkpoint;
  }

  private async readCaptureFingerprint(): Promise<string> {
    const fingerprint = await this.options.readCaptureFingerprint();
    if (typeof fingerprint !== 'string' || fingerprint.trim().length === 0) {
      throw new Error('Failed to read a valid search reindex capture definition fingerprint');
    }
    return fingerprint;
  }

  private assertCaptureFingerprint(
    checkpoint: FtsSearchReindexCheckpointFile,
    captureFingerprint: string,
  ): void {
    if (checkpoint.run.captureFingerprint === captureFingerprint) return;
    throw new Error(
      `FTS reindex capture definition fingerprint changed; refusing to resume checkpoint ${checkpoint.run.id}`,
    );
  }

  private async writeCheckpoint(
    checkpointPath: string,
    checkpoint: FtsSearchReindexCheckpointFile,
  ): Promise<void> {
    await mkdir(this.stateDirectory, { mode: 0o700, recursive: true });
    const temporaryPath = `${checkpointPath}.${process.pid}.${randomUUID()}.tmp`;
    let temporaryFile;
    try {
      /**
       * Persist the complete temporary file, atomically replace the checkpoint, then persist the
       * directory entry so a crash cannot expose a partially written or lost rename.
       */
      temporaryFile = await open(temporaryPath, 'wx', 0o600);
      await temporaryFile.writeFile(`${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
      await temporaryFile.sync();
      await temporaryFile.close();
      temporaryFile = undefined;
      await rename(temporaryPath, checkpointPath);
      const directory = await open(this.stateDirectory, 'r');
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
  }

  private async withCheckpointLock<Result>(
    checkpointPath: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    await mkdir(this.stateDirectory, { mode: 0o700, recursive: true });
    const lockPath = `${checkpointPath}.lock`;
    const lockToken = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    let lockFile;

    while (!lockFile) {
      try {
        lockFile = await open(lockPath, 'wx', 0o600);
        await lockFile.writeFile(lockToken, 'utf8');
        await lockFile.sync();
      } catch (error) {
        if (lockFile) {
          await lockFile.close().catch(() => {});
          await unlink(lockPath).catch(() => {});
          throw error;
        }
        if (!isExistingFileError(error)) throw error;
        const lockStat = await stat(lockPath).catch(() => undefined);
        if (lockStat && Date.now() - lockStat.mtimeMs > LOCK_STALE_AFTER_MS) {
          console.warn(
            `Taking over stale search reindex checkpoint lock (${Math.round(Date.now() - lockStat.mtimeMs)} ms): ${lockPath}`,
          );
          await unlink(lockPath).catch(() => {});
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for search reindex checkpoint lock: ${lockPath}`, {
            cause: error,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));
      }
    }

    try {
      return await operation();
    } finally {
      await lockFile.close();
      const currentToken = await readFile(lockPath, 'utf8').catch(() => undefined);
      if (currentToken === lockToken) await unlink(lockPath).catch(() => {});
    }
  }

  private async updateCheckpoint<Result>(
    runId: string,
    operation: (checkpoint: FtsSearchReindexCheckpointFile) => Result,
  ): Promise<Result> {
    const checkpointPath = await this.findCheckpointPath(runId);
    if (!checkpointPath) throw new Error(`Missing reindex run ${runId}`);

    return this.withCheckpointLock(checkpointPath, async () => {
      const checkpoint = await this.readCheckpoint(checkpointPath);
      const result = await operation(checkpoint);
      checkpoint.run.updatedAt = now();
      await this.writeCheckpoint(checkpointPath, checkpoint);
      return result;
    });
  }

  async checkpointBatch({
    cursor,
    entity,
    failures,
    indexedCount,
    previousCursor,
    processedCount,
    runId,
  }: FtsSearchReindexBatchCheckpoint): Promise<boolean> {
    return this.updateCheckpoint(runId, (checkpoint) => {
      const progress = checkpoint.progress.find((item) => item.entity === entity);
      if (!progress) throw new Error(`Missing reindex progress for ${entity}`);
      if (progress.cursor !== previousCursor) return false;

      progress.cursor = cursor;
      progress.indexedCount += indexedCount;
      progress.processedCount += processedCount;
      progress.status = 'backfilling';

      for (const failure of failures) {
        const existing = checkpoint.failures.find(
          (item) => item.entity === entity && item.documentId === failure.documentId,
        );
        if (existing) {
          existing.attempts += 1;
          existing.error = errorMessage(failure.error);
          existing.resolvedAt = null;
          existing.retryable = failure.retryable;
        } else {
          checkpoint.failures.push({
            attempts: 1,
            documentId: failure.documentId,
            entity,
            error: errorMessage(failure.error),
            resolvedAt: null,
            retryable: failure.retryable,
          });
        }
      }
      progress.failedCount = unresolvedFailureCount(checkpoint, entity);
      return true;
    });
  }

  async completeEntity(runId: string, entity: FtsSearchDocumentEntity): Promise<void> {
    await this.updateCheckpoint(runId, (checkpoint) => {
      const progress = checkpoint.progress.find((item) => item.entity === entity);
      if (!progress) throw new Error(`Missing reindex progress for ${entity}`);
      const unresolved = unresolvedFailureCount(checkpoint, entity);
      if (unresolved > 0) {
        throw new Error(`Cannot complete ${entity}: ${unresolved} reindex failures remain`);
      }
      progress.completedAt = now();
      progress.failedCount = 0;
      progress.status = 'completed';
    });
  }

  async createOrResume(
    namespace: string,
    schemaVersion: number,
  ): Promise<FtsSearchReindexRunState> {
    const checkpointPath = this.checkpointPath(namespace, schemaVersion);
    const existing = await this.readCheckpointIfExists(checkpointPath);
    if (existing) {
      this.assertCaptureFingerprint(existing, await this.readCaptureFingerprint());
      return this.stateOf(checkpointPath, existing);
    }

    /** Reserve outside the file lock so a slow database connection cannot stale the local lock. */
    const baseRevision = await this.options.reserveRevisionWithWriteFence();
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 1) {
      throw new Error('Failed to reserve a valid search reindex base revision');
    }
    return this.withCheckpointLock(checkpointPath, async () => {
      const concurrentlyCreated = await this.readCheckpointIfExists(checkpointPath);
      const captureFingerprint = await this.readCaptureFingerprint();
      if (concurrentlyCreated) {
        this.assertCaptureFingerprint(concurrentlyCreated, captureFingerprint);
        return this.stateOf(checkpointPath, concurrentlyCreated);
      }

      const timestamp = now();
      const checkpoint: FtsSearchReindexCheckpointFile = {
        failures: [],
        formatVersion: CHECKPOINT_FORMAT_VERSION,
        progress: FTS_SEARCH_DOCUMENT_ENTITIES.map((entity) => ({
          completedAt: null,
          cursor: null,
          entity,
          failedCount: 0,
          indexedCount: 0,
          physicalIndex: getFtsSearchPhysicalIndexName(namespace, entity, schemaVersion),
          processedCount: 0,
          status: 'pending',
        })),
        run: {
          aliasesCreatedAt: null,
          backfillHighWaterRevision: null,
          baseRevision,
          captureFingerprint,
          createdAt: timestamp,
          id: randomUUID(),
          namespace,
          schemaVersion,
          status: 'backfilling',
          updatedAt: timestamp,
        },
      };
      await this.writeCheckpoint(checkpointPath, checkpoint);
      return this.stateOf(checkpointPath, checkpoint);
    });
  }

  async getTargetRun(
    namespace: string,
    schemaVersion: number,
  ): Promise<FtsSearchReindexRunState | undefined> {
    const checkpointPath = this.checkpointPath(namespace, schemaVersion);
    const checkpoint = await this.readCheckpointIfExists(checkpointPath);
    return checkpoint ? this.stateOf(checkpointPath, checkpoint) : undefined;
  }

  async getRun(runId: string): Promise<FtsSearchReindexRunState | undefined> {
    const checkpointPath = await this.findCheckpointPath(runId);
    if (!checkpointPath) return;
    return this.stateOf(checkpointPath, await this.readCheckpoint(checkpointPath));
  }

  async listUnresolvedFailures(runId: string, entity?: FtsSearchDocumentEntity) {
    const checkpointPath = await this.findCheckpointPath(runId);
    if (!checkpointPath) throw new Error(`Missing reindex run ${runId}`);
    const checkpoint = await this.readCheckpoint(checkpointPath);
    return checkpoint.failures.filter(
      (failure) => !failure.resolvedAt && (!entity || failure.entity === entity),
    );
  }

  async markReadyForIncrementalSync(runId: string): Promise<void> {
    /** Read outside the file lock so a slow database connection cannot stale the local lock. */
    const highWaterRevision = await this.options.readHighWaterRevision();
    if (!Number.isSafeInteger(highWaterRevision) || highWaterRevision < 0) {
      throw new Error('Failed to read a valid search reindex high-water revision');
    }
    await this.updateCheckpoint(runId, (checkpoint) => {
      const incomplete = checkpoint.progress.find((progress) => progress.status !== 'completed');
      const unresolved = checkpoint.failures.find((failure) => !failure.resolvedAt);
      if (incomplete || unresolved) {
        throw new Error(
          'Cannot create aliases before every reindex entity and failure is complete',
        );
      }
      checkpoint.run.aliasesCreatedAt = now();
      checkpoint.run.backfillHighWaterRevision = highWaterRevision;
      checkpoint.run.status = 'ready_for_incremental_sync';
    });
  }

  async resolveFailures(
    runId: string,
    entity: FtsSearchDocumentEntity,
    documentIds: string[],
  ): Promise<number> {
    if (documentIds.length === 0) return 0;
    return this.updateCheckpoint(runId, (checkpoint) => {
      const documentIdSet = new Set(documentIds);
      const resolved = checkpoint.failures.filter(
        (failure) =>
          failure.entity === entity && documentIdSet.has(failure.documentId) && !failure.resolvedAt,
      );
      const resolvedAt = now();
      for (const failure of resolved) failure.resolvedAt = resolvedAt;

      const progress = checkpoint.progress.find((item) => item.entity === entity);
      if (!progress) throw new Error(`Missing reindex progress for ${entity}`);
      progress.failedCount = unresolvedFailureCount(checkpoint, entity);
      progress.indexedCount += resolved.length;
      return resolved.length;
    });
  }

  /** Resolves one failure by explicit operator decision without counting it as indexed. */
  async skipFailure(
    runId: string,
    entity: FtsSearchDocumentEntity,
    documentId: string,
  ): Promise<boolean> {
    return this.updateCheckpoint(runId, (checkpoint) => {
      const failure = checkpoint.failures.find(
        (item) =>
          item.entity === entity &&
          item.documentId === documentId &&
          !item.resolvedAt &&
          !item.retryable,
      );
      if (!failure) return false;
      failure.error = `Skipped by operator: ${failure.error}`.slice(0, 4000);
      failure.resolvedAt = now();

      const progress = checkpoint.progress.find((item) => item.entity === entity);
      if (!progress) throw new Error(`Missing reindex progress for ${entity}`);
      progress.failedCount = unresolvedFailureCount(checkpoint, entity);
      return true;
    });
  }
}
