/**
 * Upgrade legacy project_working_directories rows into the environment model.
 *
 * A directory resolves through its natural key: the environment_instances row
 * for (device_id, path) whose environment is linked to the directory's project
 * via project_environments. A legacy row is one where that chain is missing.
 * For each one this:
 *   1. reuses the instance for (device_id, path), or creates it together with
 *      a minimal parent environment;
 *   2. links the project to that environment (project_environments).
 *
 * Rows whose device is gone (device_id NULL or dangling) can never execute —
 * ProjectWorkingDirectoryModel.resolve already rejects them — and are deleted.
 *
 * Idempotent: an upgraded row satisfies the natural-key chain and is no longer
 * selected; the id cursor keeps a dry run from revisiting rows.
 */

export interface BackfillQueryClient {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  release?: () => void;
}

export interface BackfillPool {
  connect: () => Promise<BackfillQueryClient>;
}

export interface BackfillOptions {
  apply: boolean;
  batchSize: number;
  onBatch?: (progress: BackfillProgress & { cursor: string }) => void;
}

export interface BackfillProgress {
  createdEnvironments: number;
  createdInstances: number;
  removedOrphans: number;
  scanned: number;
  upgraded: number;
}

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

export const SELECT_LEGACY_DIRECTORIES = `
  SELECT pwd.id, pwd.project_id AS "projectId", pwd.device_id AS "deviceId",
         pwd.path, pwd.name, pwd.workspace_id AS "workspaceId",
         pwd.added_by_user_id AS "addedByUserId",
         p.user_id AS "projectUserId", p.workspace_id AS "projectWorkspaceId"
  FROM project_working_directories pwd
  INNER JOIN projects p ON p.id = pwd.project_id
  WHERE pwd.id > $1
    AND NOT EXISTS (
      SELECT 1
      FROM environment_instances ei
      INNER JOIN project_environments pe
        ON pe.environment_id = ei.environment_id AND pe.project_id = pwd.project_id
      WHERE ei.device_id = pwd.device_id AND ei.working_directory = pwd.path
    )
  ORDER BY pwd.id
  LIMIT $2
  FOR UPDATE OF pwd SKIP LOCKED
`;

export const backfillProjectWorkingDirectoryInstances = async (
  pool: BackfillPool,
  { apply, batchSize, onBatch }: BackfillOptions,
): Promise<BackfillProgress> => {
  let cursor = '00000000-0000-0000-0000-000000000000';
  const progress: BackfillProgress = {
    createdEnvironments: 0,
    createdInstances: 0,
    removedOrphans: 0,
    scanned: 0,
    upgraded: 0,
  };

  while (true) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query<LegacyRow>(SELECT_LEGACY_DIRECTORIES, [
        cursor,
        batchSize,
      ]);

      if (rows.length === 0) {
        await client.query('COMMIT');
        break;
      }

      for (const row of rows) {
        progress.scanned += 1;

        const device = row.deviceId
          ? await client.query<{ id: string }>('SELECT id FROM devices WHERE id = $1', [
              row.deviceId,
            ])
          : { rows: [] };

        if (!row.deviceId || device.rows.length === 0) {
          if (apply)
            await client.query('DELETE FROM project_working_directories WHERE id = $1', [row.id]);
          progress.removedOrphans += 1;
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
          progress.createdEnvironments += 1;
          const created = await client.query<{ id: string }>(
            `INSERT INTO environment_instances
               (environment_id, name, kind, device_id, working_directory, configuration_snapshot)
             VALUES ($1, $2, 'device', $3, $4, '{}') RETURNING id`,
            [environment.rows[0].id, row.name, row.deviceId, row.path],
          );
          progress.createdInstances += 1;
          instance = { environmentId: environment.rows[0].id, id: created.rows[0].id };
        } else if (!instance) {
          // Dry-run: an instance (and its environment) would be created.
          progress.createdInstances += 1;
          progress.createdEnvironments += 1;
        }

        if (apply && instance) {
          await client.query(
            `INSERT INTO project_environments (project_id, environment_id, workspace_id, added_by_user_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [row.projectId, instance.environmentId, row.workspaceId, row.addedByUserId],
          );
        }
        progress.upgraded += 1;
      }

      await client.query('COMMIT');

      cursor = rows.at(-1)!.id;
      onBatch?.({ ...progress, cursor });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release?.();
    }
  }

  return progress;
};
