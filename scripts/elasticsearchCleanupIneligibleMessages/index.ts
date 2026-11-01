import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { and, asc, count, gt, not, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { FtsSearchSyncOutboxRepository } from '../../packages/database/src/repositories/ftsSearchSyncOutbox';
import { messages } from '../../packages/database/src/schemas';
import * as schema from '../../packages/database/src/schemas';
import type { LobeChatDatabase } from '../../packages/database/src/type';
import { searchableMessage } from '../../packages/database/src/utils/searchableMessage';

const { Pool } = pg;

interface CleanupCheckpoint {
  complete: boolean;
  cursor: string | null;
  databaseName: string;
  queued: number;
  version: 2;
}

const readCheckpoint = async (file: string, databaseName: string): Promise<CleanupCheckpoint> => {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as CleanupCheckpoint;
    if (
      value.version !== 2 ||
      value.databaseName !== databaseName ||
      typeof value.queued !== 'number' ||
      !Number.isSafeInteger(value.queued) ||
      value.queued < 0 ||
      (value.cursor !== null && typeof value.cursor !== 'string') ||
      typeof value.complete !== 'boolean'
    ) {
      throw new Error('Invalid ineligible-message cleanup checkpoint');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { complete: false, cursor: null, databaseName, queued: 0, version: 2 };
    }
    throw error;
  }
};

const saveCheckpoint = async (file: string, checkpoint: CleanupCheckpoint) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, { mode: 0o600 });
  await rename(temporary, file);
};

const positiveInteger = (argument: string) => {
  const value = Number(argument);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Expected a positive integer');
  return value;
};

/** Enqueues current source IDs; the normal sync worker writes fenced soft tombstones. */
export const runCleanupBatch = async (
  db: LobeChatDatabase,
  afterId: string | null,
  limit: number,
) => {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(not(searchableMessage()), afterId ? gt(messages.id, afterId) : undefined))
    .orderBy(asc(messages.id))
    .limit(limit);
  const ids = rows.map(({ id }) => id);
  if (ids.length > 0) {
    const documentIds = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    await db.execute(sql`
      SELECT enqueue_fts_search_sync_outbox('messages', ARRAY[${documentIds}]::text[], 10::smallint)
    `);
  }
  return { complete: ids.length < limit, cursor: ids.at(-1) ?? afterId, queued: ids.length };
};

const parseOptions = (args: readonly string[]) => {
  const allowed = new Set(['--status', '--apply', '--yes', '--all-workers-upgraded']);
  for (const argument of args) {
    if (
      !allowed.has(argument) &&
      !['--state-file=', '--batch-size=', '--max-batches=', '--delay-ms='].some((prefix) =>
        argument.startsWith(prefix),
      )
    ) {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  const value = (prefix: string) =>
    args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  const apply = args.includes('--apply');
  if (apply && args.includes('--status')) throw new Error('Choose --status or --apply');
  const stateFile = value('--state-file=');
  if (
    apply &&
    (!args.includes('--yes') || !args.includes('--all-workers-upgraded') || !stateFile)
  ) {
    throw new Error('--apply requires --yes, --all-workers-upgraded, and --state-file');
  }
  return {
    apply,
    batchSize: positiveInteger(value('--batch-size=') ?? '250'),
    delayMs: Number(value('--delay-ms=') ?? '1000'),
    maxBatches: positiveInteger(value('--max-batches=') ?? '1'),
    stateFile,
  };
};

/** Read-only by default; apply is a separate operator action after all sync binaries are updated. */
export const runIneligibleMessageCleanupCli = async (args = process.argv.slice(2)) => {
  const options = parseOptions(args);
  if (!Number.isSafeInteger(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay-ms must be a non-negative integer');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema });
    const outbox = new FtsSearchSyncOutboxRepository(db);
    await outbox.assertCaptureInfrastructure();
    const databaseResult = await db.execute(sql`SELECT current_database() AS name`);
    const databaseName = databaseResult.rows[0].name as string;
    if (!options.apply) {
      const [total] = await db
        .select({ count: count() })
        .from(messages)
        .where(not(searchableMessage()));
      console.log(JSON.stringify({ ineligibleSourceRows: total.count, type: 'preview' }));
      return;
    }

    let checkpoint = await readCheckpoint(options.stateFile!, databaseName);
    for (let batch = 0; batch < options.maxBatches && !checkpoint.complete; batch++) {
      const result = await runCleanupBatch(db, checkpoint.cursor, options.batchSize);
      checkpoint = {
        complete: result.complete,
        cursor: result.cursor,
        databaseName,
        queued: checkpoint.queued + result.queued,
        version: 2,
      };
      await saveCheckpoint(options.stateFile!, checkpoint);
      console.log(
        JSON.stringify({
          complete: checkpoint.complete,
          queued: result.queued,
          totalQueued: checkpoint.queued,
          type: 'cleanup_batch',
        }),
      );
      if (!checkpoint.complete && batch + 1 < options.maxBatches && options.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
    }
  } finally {
    await pool.end();
  }
};
