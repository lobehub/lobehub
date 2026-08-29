import pg from 'pg';

const { Pool } = pg;

const DEFAULT_BATCH_SIZE = 500;

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const cursorArg = process.argv.find((arg) => arg.startsWith('--cursor='));
const batchSize = batchSizeArg
  ? Number.parseInt(batchSizeArg.slice('--batch-size='.length), 10)
  : DEFAULT_BATCH_SIZE;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
  throw new Error('--batch-size must be an integer between 1 and 5000');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

interface AgentRuntimeRow {
  id: string;
  runtimeKind: 'heterogeneous' | 'lobe';
  runtimeType: string | null;
  storedRuntimeKind: string;
  storedRuntimeType: string | null;
}

const pool = new Pool({ connectionString });

const run = async () => {
  let cursor = cursorArg?.slice('--cursor='.length) ?? '';
  let mismatched = 0;
  let processed = 0;
  let updated = 0;

  while (true) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query<AgentRuntimeRow>(
        `
          SELECT
            id,
            runtime_kind AS "storedRuntimeKind",
            runtime_type AS "storedRuntimeType",
            CASE
              WHEN jsonb_typeof(agency_config->'heterogeneousProvider') = 'object'
                THEN 'heterogeneous'
              ELSE 'lobe'
            END AS "runtimeKind",
            CASE
              WHEN jsonb_typeof(agency_config->'heterogeneousProvider') = 'object'
                THEN COALESCE(
                  NULLIF(agency_config->'heterogeneousProvider'->>'type', ''),
                  NULLIF(agency_config->'heterogeneousProvider'->>'adapterType', ''),
                  CASE
                    WHEN LOWER(COALESCE(agency_config->'heterogeneousProvider'->>'command', ''))
                      LIKE '%claude%' THEN 'claude-code'
                    WHEN LOWER(COALESCE(agency_config->'heterogeneousProvider'->>'command', ''))
                      LIKE '%codex%' THEN 'codex'
                    ELSE 'claude-code'
                  END
                )
              ELSE NULL
            END AS "runtimeType"
          FROM agents
          WHERE id > $1
          ORDER BY id
          LIMIT $2
          ${apply ? 'FOR UPDATE' : ''}
        `,
        [cursor, batchSize],
      );

      if (result.rows.length === 0) {
        await client.query('COMMIT');
        break;
      }

      const drifted = result.rows.filter(
        (row) =>
          row.storedRuntimeKind !== row.runtimeKind || row.storedRuntimeType !== row.runtimeType,
      );

      if (apply && drifted.length > 0) {
        const updateResult = await client.query(
          `
            UPDATE agents AS agent
            SET runtime_kind = runtime.runtime_kind,
                runtime_type = runtime.runtime_type
            FROM UNNEST($1::text[], $2::text[], $3::text[])
              AS runtime(id, runtime_kind, runtime_type)
            WHERE agent.id = runtime.id
              AND (
                agent.runtime_kind IS DISTINCT FROM runtime.runtime_kind
                OR agent.runtime_type IS DISTINCT FROM runtime.runtime_type
              )
          `,
          [
            drifted.map((row) => row.id),
            drifted.map((row) => row.runtimeKind),
            drifted.map((row) => row.runtimeType),
          ],
        );
        updated += updateResult.rowCount ?? 0;
      }

      await client.query('COMMIT');

      mismatched += drifted.length;
      processed += result.rows.length;
      cursor = result.rows.at(-1)!.id;

      console.log(JSON.stringify({ apply, cursor, mismatched, processed, updated }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(JSON.stringify({ apply, complete: true, cursor, mismatched, processed, updated }));
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
