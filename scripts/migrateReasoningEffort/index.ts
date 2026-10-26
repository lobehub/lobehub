/**
 * Migrates saved reasoning effort data to the model-card `reasoningEffort`
 * spec (LOBE-14979). The per-model effort keys (`gpt5_2ReasoningEffort`,
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
 *   bun scripts/migrateReasoningEffort/index.ts --apply --batch-size=500
 */
import type { AiModelReasoningEffortSettings } from 'model-bank';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import { ModelProvider } from 'model-bank/modelProvider';
import pg from 'pg';

import {
  LEGACY_CONFIG_KEYS,
  LEGACY_EXTEND_PARAMS,
  migrateModelSettings,
  migrateReasoningConfig,
  resolveLegacyEffortKey,
} from './transform';

const { Pool } = pg;

const DEFAULT_BATCH_SIZE = 500;

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg
  ? Number.parseInt(batchSizeArg.slice('--batch-size='.length), 10)
  : DEFAULT_BATCH_SIZE;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
  throw new Error('--batch-size must be an integer between 1 and 5000');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString });

const providerCards = new Set(LOBE_DEFAULT_MODEL_LIST.map((m) => `${m.providerId}/${m.id}`));
const cardSpecById = new Map<string, AiModelReasoningEffortSettings>();
for (const card of LOBE_DEFAULT_MODEL_LIST) {
  const spec = card.settings?.reasoningEffort;
  if (spec && !cardSpecById.has(card.id)) cardSpecById.set(card.id, spec);
}

/** Aggregators address models as `vendor/model`; their cards use the bare id. */
const findCardSpec = (id: string) =>
  cardSpecById.get(id) ?? cardSpecById.get(id.slice(id.lastIndexOf('/') + 1));

interface Stats {
  applied: number;
  changed: number;
  conflicts: number;
  scanned: number;
  skipped: number;
}

interface TableJob<Row, Change> {
  /** Rows with any legacy key after `cursor`, in key order. */
  load: (client: pg.PoolClient, cursor: string) => Promise<Row[]>;
  name: string;
  /** Applies a batch and returns how many rows still matched their read value. */
  save: (client: pg.PoolClient, changes: Change[]) => Promise<number>;
  /** Returns the change for a row, flagging an unresolved value conflict. */
  toChange: (row: Row) => { change?: Change; conflict: boolean } | undefined;
  toCursor: (row: Row) => string;
}

const runJob = async <Row, Change>(job: TableJob<Row, Change>): Promise<Stats> => {
  const stats: Stats = { applied: 0, changed: 0, conflicts: 0, scanned: 0, skipped: 0 };
  let cursor = '';

  while (true) {
    const client = await pool.connect();
    try {
      await client.query(`SET statement_timeout = '120s'`);
      const rows = await job.load(client, cursor);
      if (rows.length === 0) break;

      cursor = job.toCursor(rows.at(-1)!);
      stats.scanned += rows.length;

      const results = rows.map(job.toChange).filter((r) => !!r);
      const changes = results.flatMap((r) => (r.change ? [r.change] : []));
      stats.changed += changes.length;
      stats.conflicts += results.filter((r) => r.conflict).length;

      if (apply && changes.length > 0) {
        const applied = await job.save(client, changes);
        stats.applied += applied;
        stats.skipped += changes.length - applied;
      }
    } finally {
      client.release();
    }

    console.log(`[${job.name}] scanned=${stats.scanned} changed=${stats.changed}`);
  }

  return stats;
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

const aiModelsJob: TableJob<AiModelRow, AiModelChange> = {
  load: async (client, cursor) =>
    (
      await client.query<AiModelRow>(
        `SELECT _id, id, provider_id, config, settings FROM ai_models
         WHERE ($1 = '' OR _id > $1::uuid)
           AND (config->'chatConfig' ?| $2::text[] OR settings->'extendParams' ?| $3::text[])
         ORDER BY _id LIMIT $4`,
        [cursor, LEGACY_CONFIG_KEYS, LEGACY_EXTEND_PARAMS, batchSize],
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
  toChange: (row) => {
    const effortKey = resolveLegacyEffortKey({
      extendParams: (row.settings as { extendParams?: unknown } | null)?.extendParams,
      model: row.id,
      provider: row.provider_id,
    });
    const chatConfig = migrateReasoningConfig(row.config?.chatConfig, effortKey);
    const settings = migrateModelSettings(row.settings, {
      cardSpec: findCardSpec(row.id),
      // LobeHub's model list is managed server-side; its cards always apply.
      hasProviderCard:
        row.provider_id === ModelProvider.LobeHub ||
        providerCards.has(`${row.provider_id}/${row.id}`),
    });
    if (!chatConfig && !settings) return;
    if (!chatConfig?.next && !settings) return { conflict: true };
    return {
      change: {
        chatConfig: chatConfig?.next,
        key: row._id,
        oldChatConfig: row.config?.chatConfig,
        oldSettings: row.settings,
        settings,
      },
      conflict: !!chatConfig?.conflict,
    };
  },
  toCursor: (row) => row._id,
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
    load: async (client, cursor) =>
      (
        await client.query<JsonPathRow>(
          `SELECT id, ${modelSql} AS model, ${providerSql} AS provider, ${accessor} AS value
           FROM ${table}
           WHERE id > $1 AND ${accessor} ?| $2::text[]
           ORDER BY id LIMIT $3`,
          [cursor, LEGACY_CONFIG_KEYS, batchSize],
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
    toChange: (row) => {
      const result = migrateReasoningConfig(
        row.value,
        resolveLegacyEffortKey({ model: row.model, provider: row.provider }),
      );
      if (!result?.next) return result;
      return { change: { id: row.id, next: result.next, old: row.value }, conflict: false };
    },
    toCursor: (row) => row.id,
  };
};

const run = async () => {
  console.log(`--- migrateReasoningEffort ---`);
  console.log(`Mode: ${apply ? 'apply' : 'dry-run'}`);
  console.log(`DB URL env: DATABASE_URL`);
  console.log(`Batch size: ${batchSize}`);
  const startedAt = Date.now();

  const results: Record<string, Stats> = {
    'ai_models': await runJob(aiModelsJob),
    'topics.metadata.reasoningConfig': await runJob(
      createJsonPathJob('topics', 'metadata', ['reasoningConfig'], {
        modelSql: 'model',
        providerSql: 'provider',
      }),
    ),
    'agents.agency_config.subagent.chatConfig': await runJob(
      createJsonPathJob('agents', 'agency_config', ['subagent', 'chatConfig'], {
        modelSql: "agency_config->'subagent'->>'model'",
        providerSql: "agency_config->'subagent'->>'provider'",
      }),
    ),
  };

  console.table(results);
  const total = Object.values(results).reduce(
    (sum, s) => ({
      applied: sum.applied + s.applied,
      changed: sum.changed + s.changed,
      skipped: sum.skipped + s.skipped,
    }),
    { applied: 0, changed: 0, skipped: 0 },
  );
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
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
