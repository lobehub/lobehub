import pg from 'pg';

/**
 * Switches bot wake off for the bots of heterogeneous agents (Claude Code, Codex) that never chose.
 *
 * Bot wake is stored as an off switch (`settings.botWakeDisabled`), so a bot without it speaks up
 * on its own. A heterogeneous agent has to opt in instead: new bots get the switch written on
 * create, and this covers the ones that already exist. Run it before deploying the release that
 * reads `botWakeDisabled`. It only touches bots without the key, so it is safe to rerun and never
 * overrides an owner's choice.
 *
 * Usage: DATABASE_URL=... bunx tsx scripts/backfillHeterogeneousBotWakeOff.ts [--apply] [--batch-size=100]
 * Without `--apply` it only counts.
 */

const { Pool } = pg;

const DEFAULT_BATCH_SIZE = 100;

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const batchSize = batchSizeArg
  ? Number.parseInt(batchSizeArg.slice('--batch-size='.length), 10)
  : DEFAULT_BATCH_SIZE;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
  throw new Error('--batch-size must be an integer between 1 and 1000');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString });

const run = async () => {
  let cursor: string | null = null;
  let processed = 0;
  let switchedOff = 0;

  while (true) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query<{ id: string }>(
        `
          SELECT p.id
          FROM agent_bot_providers AS p
          INNER JOIN agents AS a ON a.id = p.agent_id
          WHERE a.agency_config ? 'heterogeneousProvider'
            AND jsonb_typeof(a.agency_config -> 'heterogeneousProvider') = 'object'
            AND NOT (COALESCE(p.settings, '{}'::jsonb) ? 'botWakeDisabled')
            AND ($1::uuid IS NULL OR p.id > $1::uuid)
          ORDER BY p.id
          LIMIT $2
          FOR UPDATE OF p SKIP LOCKED
        `,
        [cursor, batchSize],
      );
      const ids = result.rows.map((row) => row.id);

      if (ids.length === 0) {
        await client.query('COMMIT');
        break;
      }

      const updated = apply
        ? await client.query(
            `
              UPDATE agent_bot_providers
              SET settings = COALESCE(settings, '{}'::jsonb) || '{"botWakeDisabled": true}'::jsonb,
                  updated_at = NOW()
              WHERE id = ANY($1::uuid[])
                AND NOT (COALESCE(settings, '{}'::jsonb) ? 'botWakeDisabled')
            `,
            [ids],
          )
        : undefined;

      await client.query('COMMIT');

      processed += ids.length;
      switchedOff += updated?.rowCount ?? 0;
      cursor = ids.at(-1)!;

      console.log(JSON.stringify({ apply, cursor, processed, switchedOff }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(JSON.stringify({ apply, complete: true, processed, switchedOff }));
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
