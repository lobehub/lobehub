import { and, eq, inArray } from 'drizzle-orm';

import { buildWorkspaceWhere, type Database, memberships } from './schema';

export class GroupModel {
  constructor(
    private db: Database,
    private userId: string,
    private workspaceId: string,
  ) {}

  remove(groupId: string, agentIds: string[]) {
    return this.db
      .delete(memberships)
      .where(
        and(
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, memberships),
          eq(memberships.groupId, groupId),
          inArray(memberships.agentId, agentIds),
        ),
      );
  }
}
