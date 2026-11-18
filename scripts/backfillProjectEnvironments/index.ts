/**
 * Bring every existing project to the one-environment rule: each project has
 * exactly one environment of its own (`environments.project_id`).
 *
 * Per project, `ProjectEnvironmentRepository.ensure` — the same routine the app
 * runs the first time it reads a project's environment, so a project the app
 * already reached is skipped here and vice versa:
 *   - its first linked environment (default, else first in order) becomes the
 *     project's own when no other project links it; otherwise a new one is
 *     made from that one's definition, or empty when nothing was linked;
 *   - the repositories of its other linked environments are merged in;
 *   - a device folder used only by this project moves with them;
 *   - the other links are removed. No environment is deleted: one the project
 *     stops linking stays in「设置 → 环境」.
 *
 * Silent: no prompt, no notification, no change to `projects` rows.
 * Dry-run by default (reports what is pending); pass --apply to write.
 * Idempotent and resumable: a settled project is not selected again.
 *
 * Run migration 0221 first.
 *
 *   bunx tsx scripts/backfillProjectEnvironments/index.ts
 *   bunx tsx scripts/backfillProjectEnvironments/index.ts --apply --batch-size=100
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { ProjectEnvironmentRepository } from '../../packages/database/src/repositories/projectEnvironment';
import * as schema from '../../packages/database/src/schemas';
import type { LobeChatDatabase } from '../../packages/database/src/type';

/**
 * Projects not yet settled: no environment of their own, a link to it that is
 * not the enabled default, or another link beside it that is not one kept for
 * a folder shared with another project.
 */
export const SELECT_UNSETTLED_PROJECTS = `
  SELECT p.id, p.name, p.user_id AS "userId", p.workspace_id AS "workspaceId",
         p.visibility
  FROM projects p
  WHERE p.id > $1
    AND (
      NOT EXISTS (SELECT 1 FROM environments e WHERE e.project_id = p.id)
      OR EXISTS (
        SELECT 1 FROM project_environments pe
        LEFT JOIN environments e ON e.id = pe.environment_id AND e.project_id = p.id
        WHERE pe.project_id = p.id
          AND (
            (e.id IS NOT NULL AND (pe.is_default = false OR pe.enabled = false))
            -- Another environment's link stays only as a non-default one kept
            -- for a folder this project shares with another project.
            OR (e.id IS NULL AND (pe.is_default OR NOT EXISTS (
              SELECT 1 FROM environment_instances i
              INNER JOIN project_working_directories w
                ON w.device_id = i.device_id AND w.path = i.working_directory
               AND w.project_id = p.id
              WHERE i.environment_id = pe.environment_id AND i.kind = 'device'
            )))
          )
      )
      OR NOT EXISTS (
        SELECT 1 FROM project_environments pe
        INNER JOIN environments e ON e.id = pe.environment_id AND e.project_id = p.id
        WHERE pe.project_id = p.id
      )
    )
  ORDER BY p.id
  LIMIT $2
`;

export interface BackfillProgress {
  failed: number;
  scanned: number;
  settled: number;
}

export interface UnsettledProject {
  id: string;
  name: string;
  userId: string;
  visibility: string;
  workspaceId: string | null;
}

export const backfillProjectEnvironments = async (
  db: LobeChatDatabase,
  query: (text: string, params: unknown[]) => Promise<{ rows: UnsettledProject[] }>,
  {
    apply,
    batchSize,
    log = () => {},
  }: { apply: boolean; batchSize: number; log?: (line: object) => void },
): Promise<BackfillProgress> => {
  const progress: BackfillProgress = { failed: 0, scanned: 0, settled: 0 };
  let cursor = '';

  for (;;) {
    const { rows } = await query(SELECT_UNSETTLED_PROJECTS, [cursor, batchSize]);
    if (rows.length === 0) break;

    for (const project of rows) {
      progress.scanned++;
      cursor = project.id;
      if (!apply) continue;
      try {
        await ProjectEnvironmentRepository.ensure(db, project);
        progress.settled++;
      } catch (error) {
        // One project's failure must not stop the rest; it is retried next run.
        progress.failed++;
        log({ error: (error as Error).message, projectId: project.id });
      }
    }
    log({ apply, cursor, ...progress });
  }

  return progress;
};

const main = async () => {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
  const batchSize = batchSizeArg
    ? Number.parseInt(batchSizeArg.slice('--batch-size='.length), 10)
    : 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new Error('--batch-size must be an integer between 1 and 1000');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new pg.Pool({ connectionString });
  try {
    const db = drizzle(pool, { schema }) as unknown as LobeChatDatabase;
    const progress = await backfillProjectEnvironments(
      db,
      (text, params) => pool.query(text, params),
      {
        apply,
        batchSize,
        log: (line) => console.log(JSON.stringify(line)),
      },
    );
    console.log(JSON.stringify({ apply, complete: true, ...progress }));
    if (progress.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

// Only when run as a script, so the test can import the loop.
if (process.argv[1]?.includes('backfillProjectEnvironments')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
