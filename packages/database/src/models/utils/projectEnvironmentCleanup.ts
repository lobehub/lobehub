import { count, eq, sql } from 'drizzle-orm';

import { environmentInstances, environments, projectEnvironments } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/**
 * Clears the way for an account or workspace deletion through the environments
 * of the projects it takes with it.
 *
 * Every project has an environment of its own, and `environments.user_id` /
 * `workspace_id` are `restrict` — deliberately, because an environment that was
 * built from has storage on the execution plane that someone must remove first.
 * One nothing was built from has nothing outside this database, so it goes with
 * its project instead of blocking the deletion; one with instances still blocks
 * it, as every environment did before.
 *
 * For an account, a project environment its user made in someone else's
 * project (possible only for rows migrated from linked environments) is handed
 * to that project's owner rather than removed: the project outlives the
 * account.
 *
 * Two statements, not one: the links reference the environments with
 * `restrict`, which is checked per statement.
 */
export const releaseProjectEnvironments = async (
  db: LobeChatDatabase,
  scope: { userId: string } | { workspaceId: string },
) => {
  if ('userId' in scope) {
    await db.execute(sql`
      UPDATE environments e SET user_id = p.user_id, updated_at = now()
      FROM projects p
      WHERE e.project_id = p.id AND e.user_id = ${scope.userId} AND p.user_id <> ${scope.userId}
    `);
  }

  const owned =
    'userId' in scope
      ? sql`e.user_id = ${scope.userId}`
      : sql`e.workspace_id = ${scope.workspaceId}`;
  const unbuilt = sql`
    SELECT e.id FROM environments e
    WHERE e.project_id IS NOT NULL AND ${owned}
      AND NOT EXISTS (SELECT 1 FROM environment_instances i WHERE i.environment_id = e.id)
  `;

  await db.execute(sql`DELETE FROM project_environments WHERE environment_id IN (${unbuilt})`);
  await db.execute(sql`DELETE FROM environments WHERE id IN (${unbuilt})`);
};

/**
 * Deals with a project's environment before the project row goes —
 * `environments.project_id` is `restrict`, so the project cannot be deleted
 * while its environment still points at it.
 *
 * Nothing built from it: the environment goes, with its links. Something
 * built: it stays, standalone, for its creator to clean up from
 * 「设置 → 环境」 — its builds live on the execution plane, and dropping the
 * row first would leave storage nobody can name. It is released under a name
 * of its own (`<name> (<id prefix>)`), since its project-derived name may
 * already belong to a standalone environment of the same creator.
 */
export const releaseProjectEnvironment = async (db: LobeChatDatabase, projectId: string) => {
  const [own] = await db
    .select()
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .limit(1);
  if (!own) return;

  const [{ value: instances }] = await db
    .select({ value: count() })
    .from(environmentInstances)
    .where(eq(environmentInstances.environmentId, own.id));

  if (instances === 0) {
    await db.delete(projectEnvironments).where(eq(projectEnvironments.environmentId, own.id));
    await db.delete(environments).where(eq(environments.id, own.id));
    return;
  }

  const suffix = ` (${own.id.slice(0, 8)})`;
  await db
    .update(environments)
    .set({
      name: `${own.name.slice(0, 255 - suffix.length)}${suffix}`,
      projectId: null,
      updatedAt: new Date(),
    })
    .where(eq(environments.id, own.id));
};
