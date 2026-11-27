/**
 * Backfill `topics.last_message_at` (migration 0231) from the newest
 * `updated_at` of each topic's live messages — the value the topic list used
 * to compute per request with a correlated subquery.
 *
 * Walks `topics` by primary key in bounded batches; each batch is one
 * statement that reads the newest live message per topic through
 * `messages_topic_id_updated_at_idx` and only writes rows whose value actually
 * advances, so it never regresses a value the app wrote concurrently and a
 * re-run over settled rows writes nothing. `topics.updated_at` is not touched.
 *
 * Safe to run after deployment: until a row is filled the list falls back to
 * `topics.updated_at`. Dry-run by default (counts what would change); pass
 * --apply to write. Resume an interrupted run with --after=<last printed id>.
 *
 *   bunx tsx scripts/backfillTopicLastMessageAt/index.ts
 *   bunx tsx scripts/backfillTopicLastMessageAt/index.ts --apply --batch-size=1000 --sleep-ms=50
 *   bunx tsx scripts/backfillTopicLastMessageAt/index.ts --apply --after=tpc_xxx
 */
import pg from 'pg';

const DEFAULT_BATCH_SIZE = 500;

/**
 * One batch: `$1` = exclusive id cursor, `$2` = batch size, `$3` = apply flag.
 * Returns the batch's last id (next cursor), scanned and changed row counts.
 */
export const BACKFILL_BATCH_SQL = `
  WITH batch AS (
    SELECT t.id, t.last_message_at
    FROM topics t
    WHERE t.id > $1
    ORDER BY t.id
    LIMIT $2
  ),
  latest AS (
    SELECT b.id,
           b.last_message_at,
           (
             SELECT m.updated_at
             FROM messages m
             WHERE m.topic_id = b.id AND m.is_deleted IS NOT TRUE
             ORDER BY m.updated_at DESC
             LIMIT 1
           ) AS ts
    FROM batch b
  ),
  pending AS (
    SELECT l.id, l.ts
    FROM latest l
    WHERE l.ts IS NOT NULL AND (l.last_message_at IS NULL OR l.last_message_at < l.ts)
  ),
  updated AS (
    UPDATE topics t
    SET last_message_at = p.ts
    FROM pending p
    WHERE $3::boolean
      AND t.id = p.id
      AND (t.last_message_at IS NULL OR t.last_message_at < p.ts)
    RETURNING t.id
  )
  SELECT (SELECT max(id) FROM batch) AS "lastId",
         (SELECT count(*) FROM batch)::int AS scanned,
         (SELECT count(*) FROM pending)::int AS pending,
         (SELECT count(*) FROM updated)::int AS updated
`;

interface BatchResult {
  lastId: string | null;
  pending: number;
  scanned: number;
  updated: number;
}

const readArg = (name: string) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const run = async () => {
  const apply = process.argv.includes('--apply');
  const batchSize = Number.parseInt(readArg('batch-size') ?? String(DEFAULT_BATCH_SIZE), 10);
  const sleepMs = Number.parseInt(readArg('sleep-ms') ?? '0', 10);
  let cursor = readArg('after') ?? '';

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
    throw new Error('--batch-size must be an integer between 1 and 5000');
  }
  if (!Number.isInteger(sleepMs) || sleepMs < 0) {
    throw new Error('--sleep-ms must be a non-negative integer');
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new pg.Pool({ connectionString, max: 1 });
  const totals = { pending: 0, scanned: 0, updated: 0 };
  const startedAt = Date.now();

  try {
    while (true) {
      const { rows } = await pool.query<BatchResult>(BACKFILL_BATCH_SQL, [
        cursor,
        batchSize,
        apply,
      ]);
      const batch = rows[0];
      if (!batch?.lastId) break;

      cursor = batch.lastId;
      totals.scanned += batch.scanned;
      totals.pending += batch.pending;
      totals.updated += batch.updated;

      console.log(
        `[backfillTopicLastMessageAt] after=${cursor} scanned=${totals.scanned} ` +
          `${apply ? `updated=${totals.updated}` : `wouldUpdate=${totals.pending}`} ` +
          `elapsed=${Math.round((Date.now() - startedAt) / 1000)}s`,
      );

      if (batch.scanned < batchSize) break;
      if (sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  } finally {
    await pool.end();
  }

  console.log(
    `[backfillTopicLastMessageAt] done (${apply ? 'applied' : 'dry-run'}): ` +
      `scanned=${totals.scanned} ${apply ? `updated=${totals.updated}` : `wouldUpdate=${totals.pending}`}`,
  );
};

if (process.argv[1]?.includes('backfillTopicLastMessageAt')) {
  run().catch((error) => {
    console.error('[backfillTopicLastMessageAt] failed:', error);
    process.exitCode = 1;
  });
}
