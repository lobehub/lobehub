// Fixture: changing a member's role also rewrites another aggregate's rows.
import { and, eq } from 'drizzle-orm';

import { tasks, workspaceMembers } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export class WorkspaceMemberModel {
  constructor(private readonly db: LobeChatDatabase) {}

  async updateRole(workspaceId: string, userId: string, role: string) {
    // alint-expect
    return this.db.transaction(async (tx) => {
      await tx
        .update(workspaceMembers)
        .set({ role })
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        );
      if (role === 'viewer') {
        await tx
          .update(tasks)
          .set({ assigneeUserId: null })
          .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.assigneeUserId, userId)));
      }
    });
  }
}
