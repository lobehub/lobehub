// Fixture: another table updated only through the authorized group's own junction rows.
import { and, eq, inArray, ne } from 'drizzle-orm';

import { agents, buildWorkspaceWhere, chatGroups, chatGroupsAgents, type Database } from './schema';

export class ChatGroupModel {
  constructor(
    private db: Database,
    private userId: string,
    private workspaceId?: string,
  ) {}

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, chatGroups);

  async setVisibility(id: string, visibility: 'private' | 'public') {
    const [updated] = await this.db
      .update(chatGroups)
      .set({ updatedAt: new Date(), visibility })
      .where(and(eq(chatGroups.id, id), this.ownership()))
      .returning();
    if (!updated) return null;

    // Keep the group's synthetic supervisor in lockstep with the group.
    await this.db
      .update(agents)
      .set({ updatedAt: new Date(), visibility })
      .where(
        and(
          ne(agents.visibility, visibility),
          inArray(
            agents.id,
            this.db
              .select({ id: chatGroupsAgents.agentId })
              .from(chatGroupsAgents)
              .where(
                and(eq(chatGroupsAgents.chatGroupId, id), eq(chatGroupsAgents.role, 'supervisor')),
              ),
          ),
        ),
      );
    return updated;
  }
}
