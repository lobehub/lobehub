import type { SearchDocumentEntity } from '@lobechat/types';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import {
  SEARCH_DOCUMENT_ENTITIES,
  SEARCH_INDEX_SCHEMA_VERSION,
  SearchDocumentBuilder,
} from '../../packages/database/src/repositories/searchDocument';
import {
  SearchReindexHttpClient,
  SearchReindexRepository,
  SearchReindexService,
} from '../../packages/database/src/repositories/searchReindex';
import { SearchSyncOutboxRepository } from '../../packages/database/src/repositories/searchSyncOutbox';
import * as schema from '../../packages/database/src/schemas';

const { Pool } = pg;

const readPositiveIntegerArgument = (name: string) => {
  const argument = process.argv.find((item) => item.startsWith(`${name}=`));
  if (!argument) return;
  const value = Number.parseInt(argument.slice(name.length + 1), 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
};

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const disableCapture = args.has('--disable-capture');
const skipFailureArgument = process.argv.find((item) => item.startsWith('--skip-failure='));
const status = args.has('--status');
const yes = args.has('--yes');
const batchSize = readPositiveIntegerArgument('--batch-size');
const bulkMaxBytes = readPositiveIntegerArgument('--bulk-max-bytes');

const knownArguments = new Set(['--apply', '--disable-capture', '--status', '--yes']);
const unknownArgument = process.argv
  .slice(2)
  .find(
    (item) =>
      item.startsWith('--') &&
      !knownArguments.has(item) &&
      !item.startsWith('--batch-size=') &&
      !item.startsWith('--bulk-max-bytes=') &&
      !item.startsWith('--skip-failure='),
  );
if (unknownArgument) throw new Error(`Unknown argument: ${unknownArgument}`);

const mutationModes = [apply, disableCapture, Boolean(skipFailureArgument)].filter(Boolean).length;
if (mutationModes > 1 || (status && mutationModes > 0)) {
  throw new Error('Choose exactly one of --status, --apply, --disable-capture, or --skip-failure');
}
if (mutationModes > 0 && !yes) {
  throw new Error('Mutating commands require --yes after reviewing their documented effects');
}

const readFailureReference = ():
  { documentId: string; entity: SearchDocumentEntity } | undefined => {
  if (!skipFailureArgument) return;
  const reference = skipFailureArgument.slice('--skip-failure='.length);
  const separator = reference.indexOf(':');
  if (separator < 1 || separator === reference.length - 1) {
    throw new Error('--skip-failure must use <entity>:<document-id>');
  }
  const entityName = reference.slice(0, separator);
  const entity = SEARCH_DOCUMENT_ENTITIES.find((item) => item === entityName);
  if (!entity) throw new Error(`Unknown search entity: ${entityName}`);
  return { documentId: reference.slice(separator + 1), entity };
};

const failureReference = readFailureReference();

const databaseUrl = process.env.DATABASE_URL;
const elasticsearchApiKey = process.env.ES_API_KEY;
const elasticsearchUrl = process.env.ES_URL;
const namespace = process.env.ES_INDEX_NAMESPACE;

if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!namespace) throw new Error('ES_INDEX_NAMESPACE is required');
if (apply && !elasticsearchApiKey) throw new Error('ES_API_KEY is required with --apply');
if (apply && !elasticsearchUrl) throw new Error('ES_URL is required with --apply');

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema });
const repository = new SearchReindexRepository(db);
const outbox = new SearchSyncOutboxRepository(db);

const printStatus = async () => {
  const state = await repository.getLatestRun(namespace);
  const captureEnabled = await outbox.isCaptureEnabled();
  const unresolvedFailures = state ? await repository.listUnresolvedFailures(state.run.id) : [];
  const outboxStats = await outbox.stats();
  console.log(
    JSON.stringify(
      {
        namespace,
        outbox: {
          captureEnabled,
          dead: outboxStats.dead,
          highWaterRevision: outboxStats.highWaterRevision,
          oldestActiveRevision: outboxStats.oldestActiveRevision,
          pending: outboxStats.pending,
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
              unresolvedFailures: unresolvedFailures.map(
                ({ attempts, documentId, entity, retryable }) => ({
                  attempts,
                  documentId,
                  entity,
                  retryable,
                }),
              ),
              schemaVersion: state.run.schemaVersion,
              status: state.run.status,
            }
          : null,
      },
      null,
      2,
    ),
  );
};

const run = async () => {
  if (disableCapture) {
    await outbox.disableCapture();
    await printStatus();
    return;
  }

  if (failureReference) {
    const state = await repository.getLatestRun(namespace);
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
    return;
  }

  if (!apply) {
    await printStatus();
    return;
  }

  await outbox.enableCapture();
  const client = new SearchReindexHttpClient({
    apiKey: elasticsearchApiKey!,
    url: elasticsearchUrl!,
  });
  const service = new SearchReindexService(new SearchDocumentBuilder(db), repository, client, {
    batchSize,
    bulkMaxBytes,
    onProgress: (event) => console.log(JSON.stringify(event)),
  });
  const result = await service.run(namespace, SEARCH_INDEX_SCHEMA_VERSION);
  console.log(JSON.stringify(result));
  await printStatus();
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
