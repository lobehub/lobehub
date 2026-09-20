import pg from 'pg';

const { Pool } = pg;

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 5000;

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg
  ? Number.parseInt(batchSizeArg.slice('--batch-size='.length), 10)
  : DEFAULT_BATCH_SIZE;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
  throw new Error(`--batch-size must be an integer between 1 and ${MAX_BATCH_SIZE}`);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString });

interface BackfillCandidate {
  id: string;
  share_id: string;
}

const run = async () => {
  let cursor = '';
  let matched = 0;
  let updated = 0;

  while (true) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const candidates = await client.query<BackfillCandidate>(
        `
          SELECT topic.id, share.id AS share_id
          FROM topics AS topic
          INNER JOIN agent_shares AS share ON share.agent_id = topic.agent_id
          WHERE topic.agent_share_id IS NULL
            AND topic.sender_id IS NOT NULL
            AND topic.created_at >= share.created_at
            AND topic.id > $1
          ORDER BY topic.id
          LIMIT $2
          FOR UPDATE OF topic
        `,
        [cursor, batchSize],
      );

      if (candidates.rows.length === 0) {
        await client.query('COMMIT');
        break;
      }

      let updatedInBatch = 0;
      if (apply) {
        const result = await client.query(
          `
            UPDATE topics AS topic
            SET agent_share_id = batch.share_id
            FROM unnest($1::text[], $2::uuid[]) AS batch(topic_id, share_id)
            WHERE topic.id = batch.topic_id
              AND topic.agent_share_id IS NULL
          `,
          [candidates.rows.map((row) => row.id), candidates.rows.map((row) => row.share_id)],
        );
        updatedInBatch = result.rowCount ?? 0;
      }

      await client.query('COMMIT');

      cursor = candidates.rows.at(-1)!.id;
      matched += candidates.rows.length;
      updated += updatedInBatch;
      console.log(JSON.stringify({ apply, cursor, matched, updated }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(JSON.stringify({ apply, complete: true, matched, updated }));
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
