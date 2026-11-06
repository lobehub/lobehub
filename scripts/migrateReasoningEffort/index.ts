/**
 * Migrates saved reasoning effort data to the model-card `reasoningEffort`
 * spec. The per-model effort keys (`gpt5_2ReasoningEffort`,
 * `thinkingLevel3`, `opus47Effort`, …) collapse into one `reasoningEffort`
 * field in:
 *
 * - `ai_models.config.chatConfig` — the user's per-model pick
 * - `ai_models.settings.extendParams` — custom / remote models gain a spec
 * - `topics.metadata.reasoningConfig` — a topic's pinned pick
 * - `agents.agency_config.subagent.chatConfig` — sub-agent overrides
 *
 * Until it runs the app treats a legacy pick as unset and uses the card
 * default. Run --apply right before the release deploys and once more right
 * after it; the second run picks up legacy picks the old version wrote in
 * between. A row's legacy key wins over an existing `reasoningEffort` (the old
 * runtime read only the legacy key). That stays right after the deploy because
 * new-version writes strip the legacy keys, so a remaining one is always an
 * old-version pick. `conflicts` counts rows left unchanged because the model's
 * legacy key is unknown and the saved values disagree.
 *
 * Dry-run by default; pass --apply to write. Idempotent: every write is
 * guarded by the value it read, and a second run reports nothing to change.
 *
 *   bun scripts/migrateReasoningEffort/index.ts
 *   bun scripts/migrateReasoningEffort/index.ts --apply [--batch-size=1000] [--concurrency=16]
 */
import { providerCardDeclaresEffort } from 'model-bank';
import pg from 'pg';

import { isRetryableError } from './retry';
import {
  LEGACY_CONFIG_KEYS,
  LEGACY_EXTEND_PARAMS,
  migrateAiModelRow,
  migrateReasoningConfig,
  resolveLegacyEffortKey,
} from './transform';

const { Pool } = pg;

const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_CONCURRENCY = 16;
/** Heap pages per scan chunk (8 KB each, so 16 MB). */
const CHUNK_PAGES = 2048;
/**
 * Client-side per-query limit. A chunk scan or write takes a few seconds; a
 * connection that goes half-open under load would otherwise hang its query
 * for minutes before the socket errors, so the client gives up and the task
 * is retried. The server limit is a little longer, so it only cleans up
 * queries the client abandoned.
 */
const QUERY_TIMEOUT_MS = 30_000;

const intArg = (name: string, fallback: number, max: number) => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  const value = arg ? Number.parseInt(arg.slice(name.length + 3), 10) : fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`--${name} must be an integer between 1 and ${max}`);
  }
  return value;
};

const apply = process.argv.includes('--apply');
const batchSize = intArg('batch-size', DEFAULT_BATCH_SIZE, 5000);
const concurrency = intArg('concurrency', DEFAULT_CONCURRENCY, 64);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString, max: concurrency, query_timeout: QUERY_TIMEOUT_MS });
// A connection the server drops emits `error` on its client (and on the pool
// when idle); without a listener the process exits. The task using it fails
// and is retried instead.
pool.on('error', (error) => console.warn(`[pool] ${error.message}`));
pool.on('connect', (client) => {
  client.on('error', (error) => console.warn(`[client] ${error.message}`));
});

interface Stats {
  applied: number;
  changed: number;
  conflicts: number;
  scanned: number;
  skipped: number;
}

interface TableJob<Row, Change> {
  /** Rows with a legacy key whose `ctid` falls in `where` (a TID range). */
  load: (client: pg.PoolClient, where: string) => Promise<Row[]>;
  name: string;
  /** Applies a batch and returns how many rows still matched their read value. */
  save: (client: pg.PoolClient, changes: Change[]) => Promise<number>;
  table: string;
  /** Returns the change for a row, flagging an unresolved value conflict. */
  toChange: (row: Row) => { change?: Change; conflict: boolean } | undefined;
}

const startedAt = Date.now();
const elapsedSeconds = () => ((Date.now() - startedAt) / 1000).toFixed(1);

const MAX_ATTEMPTS = 5;

/**
 * Runs `run` in its own transaction so `SET LOCAL` holds on a pooled
 * (transaction-mode) connection. A dropped connection is retried: loads are
 * reads and every write is guarded by the value it read, so a rerun is safe.
 */
const inTransaction = async <T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    let client: pg.PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query(`BEGIN`);
      await client.query(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS + 5000}`);
      const result = await run(client);
      await client.query(`COMMIT`);
      client.release();
      return result;
    } catch (error) {
      // Destroys the client rather than returning a broken one to the pool.
      client?.release(error as Error);
      if (!isRetryableError(error) || attempt >= MAX_ATTEMPTS) throw error;
      console.warn(`[retry ${attempt}] ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
};

/**
 * Runs tasks with at most `concurrency` in flight. A task may enqueue more
 * tasks (a scan chunk enqueues its writes).
 */
const runQueue = (tasks: (() => Promise<void>)[]) =>
  new Promise<void>((resolve, reject) => {
    let active = 0;
    let failed = false;
    const pump = () => {
      if (failed) return;
      if (tasks.length === 0 && active === 0) return resolve();
      while (active < concurrency && tasks.length > 0) {
        const task = tasks.shift()!;
        active += 1;
        task().then(
          () => {
            active -= 1;
            pump();
          },
          (error) => {
            failed = true;
            reject(error);
          },
        );
      }
    };
    pump();
  });

/**
 * Splits each table into heap-page ranges and scans them concurrently, each
 * chunk writing its changes back in batches. A TID range scan reads only its
 * own pages, so neither the full-table run (~500k rows) nor the post-deploy
 * run (a handful of rows) walks the table more than once, and the rows of a
 * chunk need no index lookups. The last chunk is open-ended so rows on pages
 * added during the run are still read; a row an app write moves into an
 * already scanned chunk is left for the next run.
 */
const runJobs = async (jobs: TableJob<any, any>[]) => {
  const results: Record<string, Stats> = {};
  const tasks: (() => Promise<void>)[] = [];
  let pending = 0;

  for (const job of jobs) {
    const stats: Stats = { applied: 0, changed: 0, conflicts: 0, scanned: 0, skipped: 0 };
    results[job.name] = stats;
    const {
      rows: [{ pages }],
    } = await pool.query<{ pages: number }>(
      `SELECT (pg_relation_size($1::regclass) / current_setting('block_size')::int)::int AS pages`,
      [job.table],
    );

    for (let start = 0; start === 0 || start < pages; start += CHUNK_PAGES) {
      const end = start + CHUNK_PAGES;
      const where =
        `ctid >= '(${start},0)'::tid` + (end < pages ? ` AND ctid < '(${end},0)'::tid` : '');
      pending += 1;
      tasks.push(async () => {
        const rows = await inTransaction((client) => job.load(client, where));
        stats.scanned += rows.length;

        const outcomes = rows.map(job.toChange).filter((r) => !!r);
        const changes = outcomes.flatMap((r) => (r.change ? [r.change] : []));
        stats.changed += changes.length;
        stats.conflicts += outcomes.filter((r) => r.conflict).length;

        if (apply) {
          // Writes jump the queue so they overlap the remaining scans instead
          // of all starting after the last one.
          for (let offset = 0; offset < changes.length; offset += batchSize) {
            const batch = changes.slice(offset, offset + batchSize);
            tasks.unshift(async () => {
              const applied = await inTransaction((client) => job.save(client, batch));
              stats.applied += applied;
              stats.skipped += batch.length - applied;
            });
          }
        }
        pending -= 1;
        console.log(
          `[${elapsedSeconds()}s] ${job.name} chunk ${start}/${pages} scanned=${stats.scanned} changed=${stats.changed} (${pending} chunks left)`,
        );
      });
    }
  }

  await runQueue(tasks);
  return results;
};

/** `UPDATE … FROM (VALUES …)` placeholders for rows of `width` parameters. */
const valuesClause = (count: number, casts: string[]) =>
  Array.from(
    { length: count },
    (_, row) =>
      `(${casts.map((cast, col) => `$${row * casts.length + col + 1}::${cast}`).join(', ')})`,
  ).join(', ');

interface AiModelRow {
  _id: string;
  config: { chatConfig?: unknown } | null;
  id: string;
  provider_id: string;
  settings: unknown;
}

interface AiModelChange {
  chatConfig?: Record<string, unknown>;
  key: string;
  oldChatConfig: unknown;
  oldSettings: unknown;
  settings?: Record<string, unknown>;
}

const AI_MODEL_LEGACY_FILTER = `(config->'chatConfig' ?| $1::text[] OR settings->'extendParams' ?| $2::text[])`;

const aiModelsJob: TableJob<AiModelRow, AiModelChange> = {
  load: async (client, where) =>
    (
      await client.query<AiModelRow>(
        `SELECT _id, id, provider_id, config, settings FROM ai_models
         WHERE ${where} AND ${AI_MODEL_LEGACY_FILTER}`,
        [LEGACY_CONFIG_KEYS, LEGACY_EXTEND_PARAMS],
      )
    ).rows,
  name: 'ai_models',
  save: async (client, changes) => {
    const result = await client.query(
      `UPDATE ai_models AS t SET
         config = CASE WHEN u.chat_config IS NULL THEN t.config
                  ELSE jsonb_set(t.config, '{chatConfig}', u.chat_config) END,
         settings = COALESCE(u.settings, t.settings)
       FROM (VALUES ${valuesClause(changes.length, ['uuid', 'jsonb', 'jsonb', 'jsonb', 'jsonb'])})
         AS u(key, chat_config, old_chat_config, settings, old_settings)
       WHERE t._id = u.key
         AND t.config->'chatConfig' IS NOT DISTINCT FROM u.old_chat_config
         AND t.settings IS NOT DISTINCT FROM u.old_settings`,
      changes.flatMap((c) => [
        c.key,
        c.chatConfig ? JSON.stringify(c.chatConfig) : null,
        c.oldChatConfig === undefined ? null : JSON.stringify(c.oldChatConfig),
        c.settings ? JSON.stringify(c.settings) : null,
        c.oldSettings === undefined || c.oldSettings === null
          ? null
          : JSON.stringify(c.oldSettings),
      ]),
    );
    return result.rowCount ?? 0;
  },
  table: 'ai_models',
  toChange: (row) => {
    const result = migrateAiModelRow({
      chatConfig: row.config?.chatConfig,
      cardDeclaresEffort: providerCardDeclaresEffort(row.provider_id, row.id),
      model: row.id,
      provider: row.provider_id,
      settings: row.settings,
    });
    if (!result || result.conflict) return result;
    return {
      change: {
        chatConfig: result.chatConfig,
        key: row._id,
        oldChatConfig: row.config?.chatConfig,
        oldSettings: row.settings,
        settings: result.settings,
      },
      conflict: false,
    };
  },
};

interface JsonPathRow {
  id: string;
  model: string | null;
  provider: string | null;
  value: unknown;
}

interface JsonPathChange {
  id: string;
  next: Record<string, unknown>;
  old: unknown;
}

/**
 * A job that rewrites one nested JSON object (`column` at `path`) in place.
 * `modelSql` / `providerSql` select the model the saved value belongs to.
 */
const createJsonPathJob = (
  table: string,
  column: string,
  path: string[],
  { modelSql, providerSql }: { modelSql: string; providerSql: string },
): TableJob<JsonPathRow, JsonPathChange> => {
  const accessor = `${column}${path.map((key) => `->'${key}'`).join('')}`;
  return {
    load: async (client, where) =>
      (
        await client.query<JsonPathRow>(
          `SELECT id, ${modelSql} AS model, ${providerSql} AS provider, ${accessor} AS value
           FROM ${table}
           WHERE ${where} AND ${accessor} ?| $1::text[]`,
          [LEGACY_CONFIG_KEYS],
        )
      ).rows,
    name: `${table}.${[column, ...path].join('.')}`,
    save: async (client, changes) => {
      const result = await client.query(
        `UPDATE ${table} AS t SET ${column} = jsonb_set(t.${column}, '{${path.join(',')}}', u.next)
         FROM (VALUES ${valuesClause(changes.length, ['text', 'jsonb', 'jsonb'])}) AS u(id, next, old)
         WHERE t.id = u.id AND t.${accessor} IS NOT DISTINCT FROM u.old`,
        changes.flatMap((c) => [c.id, JSON.stringify(c.next), JSON.stringify(c.old)]),
      );
      return result.rowCount ?? 0;
    },
    table,
    toChange: (row) => {
      const result = migrateReasoningConfig(
        row.value,
        resolveLegacyEffortKey({ model: row.model, provider: row.provider }),
      );
      if (!result?.next) return result;
      return { change: { id: row.id, next: result.next, old: row.value }, conflict: false };
    },
  };
};

const run = async () => {
  console.log(`--- migrateReasoningEffort ---`);
  console.log(`Mode: ${apply ? 'apply' : 'dry-run'}`);
  console.log(`DB URL env: DATABASE_URL`);
  console.log(`Batch size: ${batchSize}, concurrency: ${concurrency}`);
  const results = await runJobs([
    aiModelsJob,
    createJsonPathJob('topics', 'metadata', ['reasoningConfig'], {
      modelSql: 'model',
      providerSql: 'provider',
    }),
    createJsonPathJob('agents', 'agency_config', ['subagent', 'chatConfig'], {
      modelSql: "agency_config->'subagent'->>'model'",
      providerSql: "agency_config->'subagent'->>'provider'",
    }),
  ]);

  console.table(results);
  const total = Object.values(results).reduce(
    (sum, s) => ({
      applied: sum.applied + s.applied,
      changed: sum.changed + s.changed,
      skipped: sum.skipped + s.skipped,
    }),
    { applied: 0, changed: 0, skipped: 0 },
  );
  const elapsed = elapsedSeconds();
  console.log(
    apply
      ? `Done. applied=${total.applied} skipped=${total.skipped} elapsed=${elapsed}s`
      : `Dry run. affected=${total.changed} elapsed=${elapsed}s (pass --apply to write)`,
  );
};

try {
  await run();
} finally {
  await pool.end();
}
