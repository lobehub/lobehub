import { and, eq } from 'drizzle-orm';

import { releaseProjectEnvironments } from '../../models/utils/projectEnvironmentCleanup';
import { WorkspaceModel } from '../../models/workspace';
import { workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/**
 * Deleting a workspace, across the aggregates it takes with it.
 *
 * Its projects cascade away with the workspace row, but each project's
 * environment holds the workspace back through `environments.workspace_id`
 * (`restrict` — an environment something was built from has storage on the
 * execution plane to clean up first). So the environments nothing was built
 * from are released in the same transaction, and only then is the workspace
 * deleted through {@link WorkspaceModel.delete}, which keeps its own checks
 * (primary owner, pending agent transfers).
 */
export class WorkspaceDeletionRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  delete = async (id: string) =>
    this.db.transaction(async (tx) => {
      const db = tx as unknown as LobeChatDatabase;
      const [owned] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(and(eq(workspaces.id, id), eq(workspaces.primaryOwnerId, this.userId)))
        .for('update');
      if (owned) await releaseProjectEnvironments(db, { workspaceId: id });

      return new WorkspaceModel(db, this.userId).delete(id);
    });
}
