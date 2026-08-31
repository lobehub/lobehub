import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { FtsSearchDocumentEntity } from '@lobechat/types';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import {
  FTS_SEARCH_DOCUMENT_ENTITIES,
  FTS_SEARCH_INDEX_SCHEMA_VERSION,
  FtsSearchDocumentBuilder,
} from '../../packages/database/src/repositories/ftsSearchDocument';
import { FtsSearchSyncOutboxRepository } from '../../packages/database/src/repositories/ftsSearchSyncOutbox';
import * as schema from '../../packages/database/src/schemas';
import {
  observeFtsSearchReindexRun,
  recordFtsSearchReindexBatch,
  recordFtsSearchReindexBulkRequest,
  recordFtsSearchReindexBulkRetry,
  recordFtsSearchReindexReconciliation,
} from '../../packages/observability-otel/src/modules/fts-search-reindex';
import { DiagLogLevel, register, shutdownSafely } from '../../packages/observability-otel/src/node';
import { runWithLockRetry } from '../migrateServerDB/retry';
import {
  assertFtsSearchReindexElasticsearchHostname,
  assertFtsSearchReindexRangeCollation,
  assertFtsSearchReindexTelemetryExportConfigured,
  resolveFtsSearchReindexBatchSizeByEntity,
  resolveFtsSearchReindexElasticsearchEnvironment,
  resolveFtsSearchReindexEntities,
  resolveFtsSearchReindexRangeConcurrencyByEntity,
  resolveFtsSearchReindexTelemetryEnvironment,
} from './options';
import { runFtsSearchReindexCommand } from './preparation';
import {
  type FtsSearchReindexAuditValue,
  FtsSearchReindexEntityError,
  FtsSearchReindexFileLogger,
  FtsSearchReindexFileRepository,
  FtsSearchReindexHttpClient,
  FtsSearchReindexService,
  summarizeFtsSearchReindexError,
} from './runtime';

const { Pool } = pg;

const REINDEX_BYTE_BUCKETS = [
  0, 256, 1024, 4096, 16_384, 65_536, 262_144, 1_048_576, 4_194_304, 16_777_216, 52_428_800,
];
const REINDEX_COUNT_BUCKETS = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000];
const REINDEX_DURATION_MS_BUCKETS = [
  0, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 3000, 5000, 10_000, 30_000, 60_000,
];

const readPositiveIntegerArgument = (name: string) => {
  const argument = process.argv.find((item) => item.startsWith(`${name}=`));
  if (!argument) return;
  const value = Number.parseInt(argument.slice(name.length + 1), 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
};

const readNonNegativeIntegerArgument = (name: string) => {
  const argument = process.argv.find((item) => item.startsWith(`${name}=`));
  if (!argument) return;
  const value = Number.parseInt(argument.slice(name.length + 1), 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
};

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const freshRun = args.has('--fresh-run');
const skipFailureArgument = process.argv.find((item) => item.startsWith('--skip-failure='));
const status = args.has('--status');
const yes = args.has('--yes');
const batchSize = readPositiveIntegerArgument('--batch-size');
const bulkConcurrency = readPositiveIntegerArgument('--bulk-concurrency');
const bulkMaxBytes = readPositiveIntegerArgument('--bulk-max-bytes');
const batchSizeByEntity = resolveFtsSearchReindexBatchSizeByEntity(process.argv.slice(2));
const entities = resolveFtsSearchReindexEntities(process.argv.slice(2));
const rangeConcurrencyByEntity = resolveFtsSearchReindexRangeConcurrencyByEntity(
  process.argv.slice(2),
);
const entityConcurrency = readPositiveIntegerArgument('--entity-concurrency');
const maxBatchesPerEntity = readPositiveIntegerArgument('--max-batches-per-entity');
const maxRequestRetries = readNonNegativeIntegerArgument('--max-request-retries');
const requestTimeoutMs = readPositiveIntegerArgument('--request-timeout-ms');
const retryBaseDelayMs = readNonNegativeIntegerArgument('--retry-base-delay-ms');
const telemetryEnvironment = resolveFtsSearchReindexTelemetryEnvironment(process.argv.slice(2));

const knownArguments = new Set(['--apply', '--fresh-run', '--status', '--yes']);
const unknownArgument = process.argv
  .slice(2)
  .find(
    (item) =>
      item.startsWith('--') &&
      !knownArguments.has(item) &&
      !item.startsWith('--batch-size=') &&
      !item.startsWith('--bulk-concurrency=') &&
      !item.startsWith('--bulk-max-bytes=') &&
      !item.startsWith('--entity-batch-size=') &&
      !item.startsWith('--entity=') &&
      !item.startsWith('--entity-concurrency=') &&
      !item.startsWith('--entity-range-concurrency=') &&
      !item.startsWith('--elasticsearch-api-key-env=') &&
      !item.startsWith('--elasticsearch-url-env=') &&
      !item.startsWith('--expected-elasticsearch-host-prefix=') &&
      !item.startsWith('--max-batches-per-entity=') &&
      !item.startsWith('--max-request-retries=') &&
      !item.startsWith('--request-timeout-ms=') &&
      !item.startsWith('--retry-base-delay-ms=') &&
      !item.startsWith('--skip-failure=') &&
      !item.startsWith('--telemetry-environment='),
  );
if (unknownArgument) throw new Error(`Unknown argument: ${unknownArgument}`);

const mutationModes = [apply, Boolean(skipFailureArgument)].filter(Boolean).length;
if (mutationModes > 1 || (status && mutationModes > 0)) {
  throw new Error('Choose exactly one of --status, --apply, or --skip-failure');
}
if (mutationModes > 0 && !yes) {
  throw new Error('Mutating commands require --yes after reviewing their documented effects');
}
if (freshRun && !apply) throw new Error('--fresh-run can only be used with --apply');

const readFailureReference = ():
  { documentId: string; entity: FtsSearchDocumentEntity } | undefined => {
  if (!skipFailureArgument) return;
  const reference = skipFailureArgument.slice('--skip-failure='.length);
  const separator = reference.indexOf(':');
  if (separator < 1 || separator === reference.length - 1) {
    throw new Error('--skip-failure must use <entity>:<document-id>');
  }
  const entityName = reference.slice(0, separator);
  const entity = FTS_SEARCH_DOCUMENT_ENTITIES.find((item) => item === entityName);
  if (!entity) throw new Error(`Unknown search entity: ${entityName}`);
  return { documentId: reference.slice(separator + 1), entity };
};

const failureReference = readFailureReference();
const { apiKeyEnvironmentName, expectedHostPrefix, urlEnvironmentName } =
  resolveFtsSearchReindexElasticsearchEnvironment(process.argv.slice(2));

const databaseUrl = process.env.DATABASE_URL;
const elasticsearchApiKey = process.env[apiKeyEnvironmentName];
const elasticsearchUrl = process.env[urlEnvironmentName];
const namespace = process.env.ES_INDEX_NAMESPACE;
const configuredStateDirectory = process.env.ES_REINDEX_STATE_DIR;
const stateDirectory = path.resolve(configuredStateDirectory ?? '.elasticsearch-reindex');

if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!namespace) throw new Error('ES_INDEX_NAMESPACE is required');
if (apply && !elasticsearchApiKey) {
  throw new Error(`${apiKeyEnvironmentName} is required with --apply`);
}
if (apply && !elasticsearchUrl) {
  throw new Error(`${urlEnvironmentName} is required with --apply`);
}
if ((apply || failureReference) && !configuredStateDirectory) {
  throw new Error('ES_REINDEX_STATE_DIR is required for reindex mutations and resume attempts');
}
if (process.env.ENABLE_TELEMETRY && !telemetryEnvironment) {
  throw new Error('--telemetry-environment is required when ENABLE_TELEMETRY is set');
}
if (process.env.ENABLE_TELEMETRY) {
  assertFtsSearchReindexTelemetryExportConfigured(process.env);
}

const telemetrySdk = process.env.ENABLE_TELEMETRY
  ? register({
      autoDetectResources: false,
      autoInstrumentations: false,
      debug: DiagLogLevel.ERROR,
      environment: telemetryEnvironment,
      histogramViews: [
        {
          boundaries: [0, 1, 2, 3, 5, 10],
          instrumentName: 'fts_search_reindex_bulk_request_attempts',
          meterName: 'fts-search-reindex',
        },
        {
          boundaries: REINDEX_BYTE_BUCKETS,
          instrumentName: 'fts_search_reindex_bulk_request_size',
          meterName: 'fts-search-reindex',
        },
        {
          boundaries: REINDEX_DURATION_MS_BUCKETS,
          instrumentName: 'fts_search_reindex_bulk_request_duration',
          meterName: 'fts-search-reindex',
        },
        {
          boundaries: REINDEX_COUNT_BUCKETS,
          instrumentName: 'fts_search_reindex_bulk_request_items',
          meterName: 'fts-search-reindex',
        },
      ],
      name: 'lobehub-fts-search-reindex',
    })
  : undefined;
const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema });
const outbox = new FtsSearchSyncOutboxRepository(db);
const repository = new FtsSearchReindexFileRepository({
  readCaptureFingerprint: () => outbox.readCaptureFingerprint(),
  readHighWaterRevision: () => outbox.readHighWaterRevision(),
  reserveRevisionWithWriteFence: () => outbox.reserveRevisionWithWriteFence(),
  stateDirectory,
});

const logErrorSummary = (message: string, error: unknown) => {
  console.error(message, summarizeFtsSearchReindexError(error));
};

const readStatus = async () => {
  const state = await repository.getTargetRun(namespace, FTS_SEARCH_INDEX_SCHEMA_VERSION);
  const unresolvedFailures = state ? await repository.listUnresolvedFailures(state.run.id) : [];
  const outboxStats = await outbox.stats();
  const entityStats: Record<string, FtsSearchReindexAuditValue> = Object.fromEntries(
    Object.entries(outboxStats.entities).map(([entity, stats]) => [entity, { ...stats }]),
  );
  return {
    namespace,
    outbox: {
      dead: outboxStats.dead,
      entities: entityStats,
      expiredLeases: outboxStats.expiredLeases,
      highWaterRevision: outboxStats.highWaterRevision,
      inFlight: outboxStats.inFlight,
      oldestActiveRevision: outboxStats.oldestActiveRevision,
      oldestReadyAgeSeconds: outboxStats.oldestReadyAgeSeconds,
      pending: outboxStats.pending,
      ready: outboxStats.ready,
      revisionLag: outboxStats.revisionLag,
      retrying: outboxStats.retrying,
    },
    run: state
      ? {
          baseRevision: state.run.baseRevision,
          backfillHighWaterRevision: state.run.backfillHighWaterRevision,
          entities: state.progress.map((progress) => ({
            cursor: progress.cursor,
            entity: progress.entity,
            failedCount: progress.failedCount,
            indexedCount: progress.indexedCount,
            physicalIndex: progress.physicalIndex,
            processedCount: progress.processedCount,
            status: progress.status,
          })),
          id: state.run.id,
          schemaVersion: state.run.schemaVersion,
          status: state.run.status,
          unresolvedFailures: unresolvedFailures.map(
            ({ attempts, documentId, entity, error, retryable }) => ({
              attempts,
              documentId,
              entity,
              errorSummary: summarizeFtsSearchReindexError(error),
              retryable,
            }),
          ),
        }
      : null,
    stateDirectory,
  };
};

const printStatus = async () => {
  const currentStatus = await readStatus();
  console.log(JSON.stringify(currentStatus, null, 2));
  return currentStatus;
};

let auditLogger: FtsSearchReindexFileLogger | undefined;
const executionStartedAt = Date.now();

const run = async () => {
  if (failureReference) {
    await runFtsSearchReindexCommand({
      command: 'skip-failure',
      installCaptureInfrastructure: () => outbox.installCaptureInfrastructure(),
      runWithLockRetry,
      run: async () => {
        const state = await repository.getTargetRun(namespace, FTS_SEARCH_INDEX_SCHEMA_VERSION);
        if (!state) throw new Error(`No reindex run exists for namespace ${namespace}`);
        const skipped = await repository.skipFailure(
          state.run.id,
          failureReference.entity,
          failureReference.documentId,
        );
        if (!skipped) {
          throw new Error('The requested unresolved, non-retryable reindex failure was not found');
        }
        await printStatus();
      },
    });
    return;
  }

  if (!apply) {
    await runFtsSearchReindexCommand({
      command: 'status',
      installCaptureInfrastructure: () => outbox.installCaptureInfrastructure(),
      runWithLockRetry,
      run: printStatus,
    });
    return;
  }

  if (Object.values(rangeConcurrencyByEntity).some((concurrency) => concurrency > 1)) {
    const collationResult = await pool.query<{ datcollate: string }>(
      'SELECT datcollate FROM pg_database WHERE datname = current_database()',
    );
    const databaseCollation = collationResult.rows[0]?.datcollate;
    if (!databaseCollation) throw new Error('Failed to read the PostgreSQL database collation');
    assertFtsSearchReindexRangeCollation(databaseCollation, rangeConcurrencyByEntity);
  }

  const endpointHostname = new URL(elasticsearchUrl!).hostname;
  assertFtsSearchReindexElasticsearchHostname(endpointHostname, expectedHostPrefix);
  const existing = await repository.getTargetRun(namespace, FTS_SEARCH_INDEX_SCHEMA_VERSION);
  if (!existing && !freshRun) {
    throw new Error(
      `No checkpoint exists in ${stateDirectory}; pass --fresh-run only for a new, empty Elasticsearch target`,
    );
  }
  if (existing && freshRun) {
    throw new Error(`Checkpoint ${existing.run.id} already exists; omit --fresh-run to resume it`);
  }
  const prepared = await runFtsSearchReindexCommand({
    command: 'apply',
    installCaptureInfrastructure: () => outbox.installCaptureInfrastructure(),
    runWithLockRetry,
    run: async () => {
      console.log(
        JSON.stringify({
          endpointEnvName: urlEnvironmentName,
          endpointHostname,
          expectedHostPrefix: expectedHostPrefix ?? null,
          type: 'reindex_target',
        }),
      );
      return repository.createOrResume(namespace, FTS_SEARCH_INDEX_SCHEMA_VERSION);
    },
  });
  if (existing && existing.run.status !== 'ready_for_incremental_sync') {
    await outbox.fenceSourceWrites();
  }
  auditLogger = new FtsSearchReindexFileLogger({
    runId: prepared.run.id,
    sessionId: randomUUID(),
    stateDirectory,
  });
  await auditLogger.append({
    batchSize: batchSize ?? 500,
    bulkConcurrency: bulkConcurrency ?? 1,
    bulkMaxBytes: bulkMaxBytes ?? 50 * 1024 * 1024,
    credentialEnvName: apiKeyEnvironmentName,
    endpointHostname,
    endpointEnvName: urlEnvironmentName,
    expectedHostPrefix: expectedHostPrefix ?? null,
    batchSizeByEntity,
    entities: entities ?? [...FTS_SEARCH_DOCUMENT_ENTITIES],
    entityConcurrency: entityConcurrency ?? 1,
    rangeConcurrencyByEntity,
    maxBatchesPerEntity: maxBatchesPerEntity ?? null,
    maxRequestRetries: maxRequestRetries ?? 4,
    mode: existing ? 'resume' : 'fresh',
    requestTimeoutMs: requestTimeoutMs ?? 30_000,
    retryBaseDelayMs: retryBaseDelayMs ?? 500,
    schemaVersion: prepared.run.schemaVersion,
    type: 'session_started',
  });
  console.log(
    JSON.stringify({
      eventsPath: auditLogger.eventsPath,
      runId: prepared.run.id,
      schemaVersion: prepared.run.schemaVersion,
      stateDirectory,
      summaryPath: auditLogger.summaryPath,
      type: existing ? 'reindex_resumed' : 'reindex_started',
    }),
  );

  const client = new FtsSearchReindexHttpClient({
    apiKey: elasticsearchApiKey!,
    requestTimeoutMs,
    url: elasticsearchUrl!,
  });
  const service = new FtsSearchReindexService(
    new FtsSearchDocumentBuilder(db),
    repository,
    client,
    {
      batchSize,
      bulkConcurrency,
      bulkMaxBytes,
      batchSizeByEntity,
      entities,
      entityConcurrency,
      rangeConcurrencyByEntity,
      maxBatchesPerEntity,
      maxRequestRetries,
      onProgress: async (event) => {
        if (event.type === 'batch') {
          recordFtsSearchReindexBatch({
            checkpoint: event.checkpoint,
            entity: event.entity,
            failed: event.failed,
            indexed: event.indexed,
            scanned: event.processed,
          });
        }
        if (event.type === 'reconciliation') {
          recordFtsSearchReindexReconciliation(event);
        }
        if (event.type === 'bulk_retry') {
          recordFtsSearchReindexBulkRetry(event.entity);
        }
        if (event.type === 'bulk_completed') {
          recordFtsSearchReindexBulkRequest(event);
        }
        console.log(JSON.stringify(event));
        await auditLogger!.append(event);
      },
      retryBaseDelayMs,
      validateIncrementalSyncSource: () => outbox.assertCaptureInfrastructure(),
    },
  );
  const result = await service.run(namespace, FTS_SEARCH_INDEX_SCHEMA_VERSION);
  console.log(JSON.stringify(result));
  const currentStatus = await printStatus();
  await auditLogger.append({
    elapsedMs: Date.now() - executionStartedAt,
    status: result.status,
    type: 'session_completed',
  });
  await auditLogger.writeSummary({
    elapsedMs: Date.now() - executionStartedAt,
    runStatus: result.status,
    status: currentStatus,
  });
};

observeFtsSearchReindexRun(run)
  .catch(async (error) => {
    const rootError = error instanceof FtsSearchReindexEntityError ? error.cause : error;
    logErrorSummary('❌ Elasticsearch reindex failed:', rootError);
    if (auditLogger) {
      const failure = {
        elapsedMs: Date.now() - executionStartedAt,
        entity: error instanceof FtsSearchReindexEntityError ? error.entity : null,
        errorSummary: summarizeFtsSearchReindexError(rootError),
        errorType: rootError instanceof Error ? rootError.name.slice(0, 128) : 'UnknownError',
        type: 'session_failed' as const,
      };
      await auditLogger
        .append(failure)
        .catch((logError) => logErrorSummary('Failed to append reindex audit event:', logError));
      const currentStatus = await readStatus().catch((statusError) => {
        logErrorSummary('Failed to read reindex status after failure:', statusError);
        return null;
      });
      await auditLogger
        .writeSummary({ failure, status: currentStatus })
        .catch((logError) => logErrorSummary('Failed to write reindex audit summary:', logError));
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } finally {
      /** Flush terminal run metrics and the root trace before the short-lived CLI exits. */
      if (telemetrySdk) await shutdownSafely(telemetrySdk);
    }
  });
