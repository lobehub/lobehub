/**
 * Backfill legacy project_working_directories rows (device_id/path, no
 * environment_instance_id) into the environment model before migration 0170
 * contracts the table.
 *
 * For every legacy row this script:
 *   1. reuses the environment_instances row for (device_id, working_directory)
 *      or creates it together with a minimal parent environment;
 *   2. links the project to that environment (project_environments);
 *   3. points the directory at the instance.
 *
 * Rows whose device is gone (device_id NULL or dangling) can never execute —
 * ProjectWorkingDirectoryModel.resolve already rejects them — and are deleted.
 *
 * Dry-run by default; pass --apply to write. Idempotent and resumable:
 * processed rows have environment_instance_id set and are skipped on reruns.
 *
 *   bunx tsx scripts/backfillProjectWorkingDirectoryInstances.ts
 *   bunx tsx scripts/backfillProjectWorkingDirectoryInstances.ts --apply --batch-size=100
 */
import pg from 'pg';

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

interface LegacyRow {
  addedByUserId: string | null;
  deviceId: string | null;
  id: string;
  name: string;
  path: string;
  projectId: string;
  projectUserId: string;
  projectWorkspaceId: string | null;
  workspaceId: string | null;
}

const run = async () => {
  let cursor = '00000000-0000-0000-0000-000000000000';
  let scanned = 0;
  let upgraded = 0;
  let createdEnvironments = 0;
  let createdInstances = 0;
  let removedOrphans = 0;

  while (true) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query<LegacyRow>(
        `
          SELECT pwd.id, pwd.project_id AS "projectId", pwd.device_id AS "deviceId",
                 pwd.path, pwd.name, pwd.workspace_id AS "workspaceId",
                 pwd.added_by_user_id AS "addedByUserId",
                 p.user_id AS "projectUserId", p.workspace_id AS "projectWorkspaceId"
          FROM project_working_directories pwd
          INNER JOIN projects p ON p.id = pwd.project_id
          WHERE pwd.environment_instance_id IS NULL
            AND pwd.id > $1
          ORDER BY pwd.id
          LIMIT $2
          FOR UPDATE OF pwd SKIP LOCKED
        `,
        [cursor, batchSize],
      );
      const rows = result.rows;

      if (rows.length === 0) {
        await client.query('COMMIT');
        break;
      }

      for (const row of rows) {
        scanned += 1;

        const device = row.deviceId
          ? await client.query<{ id: string }>('SELECT id FROM devices WHERE id = $1', [
              row.deviceId,
            ])
          : { rows: [] };

        if (!row.deviceId || device.rows.length === 0) {
          if (apply)
            await client.query('DELETE FROM project_working_directories WHERE id = $1', [row.id]);
          removedOrphans += 1;
          continue;
        }

        const existingInstance = await client.query<{ environmentId: string; id: string }>(
          `SELECT id, environment_id AS "environmentId"
           FROM environment_instances
           WHERE device_id = $1 AND working_directory = $2`,
          [row.deviceId, row.path],
        );

        let instance = existingInstance.rows[0];
        if (!instance && apply) {
          const environment = await client.query<{ id: string }>(
            `INSERT INTO environments (name, user_id, workspace_id, configuration)
             VALUES ($1, $2, $3, '{}') RETURNING id`,
            [row.name, row.projectUserId, row.projectWorkspaceId],
          );
          createdEnvironments += 1;
          const created = await client.query<{ id: string }>(
            `INSERT INTO environment_instances
               (environment_id, name, kind, device_id, working_directory, configuration_snapshot)
             VALUES ($1, $2, 'device', $3, $4, '{}') RETURNING id`,
            [environment.rows[0].id, row.name, row.deviceId, row.path],
          );
          createdInstances += 1;
          instance = { environmentId: environment.rows[0].id, id: created.rows[0].id };
        } else if (!instance) {
          // Dry-run: an instance (and likely its environment) would be created.
          createdInstances += 1;
          createdEnvironments += 1;
        }

        if (apply && instance) {
          await client.query(
            `INSERT INTO project_environments (project_id, environment_id, workspace_id, added_by_user_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [row.projectId, instance.environmentId, row.workspaceId, row.addedByUserId],
          );
          await client.query(
            `UPDATE project_working_directories
             SET environment_instance_id = $2, updated_at = NOW()
             WHERE id = $1`,
            [row.id, instance.id],
          );
        }
        upgraded += 1;
      }

      await client.query('COMMIT');

      cursor = rows.at(-1)!.id;
      console.log(
        JSON.stringify({
          apply,
          createdEnvironments,
          createdInstances,
          cursor,
          removedOrphans,
          scanned,
          upgraded,
        }),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(
    JSON.stringify({
      apply,
      complete: true,
      createdEnvironments,
      createdInstances,
      removedOrphans,
      scanned,
      upgraded,
    }),
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
