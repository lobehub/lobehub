import { and, eq } from 'drizzle-orm';

import { buildWorkspaceWhere, type Database, groups } from './schema';

export class GroupModel {
  constructor(
    private db: Database,
    private userId: string,
    private workspaceId: string,
  ) {}

  remove(id: string) {
    return this.db
      .delete(groups)
      .where(
        and(
          eq(groups.id, id),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, groups),
        ),
      );
  }
}
