import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type {
  ChatGroupAgentItem,
  ChatGroupItem,
  NewChatGroup,
  NewChatGroupAgent,
} from '../schemas';
import { chatGroups, chatGroupsAgents } from '../schemas';
import type { LobeChatDatabase } from '../type';

export class ChatGroupModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }
  // ******* Query Methods ******* //

  async findById(id: string): Promise<ChatGroupItem | undefined> {
    const item = await this.db.query.chatGroups.findFirst({
      where: and(eq(chatGroups.id, id), eq(chatGroups.userId, this.userId)),
    });

    return item;
  }

  async query(): Promise<ChatGroupItem[]> {
    return this.db.query.chatGroups.findMany({
      orderBy: [desc(chatGroups.updatedAt)],
      where: eq(chatGroups.userId, this.userId),
    });
  }

  /**
   * Get a chat group by the forkedFromIdentifier stored in config
   * @param forkedFromIdentifier - The source group's market identifier
   * @returns group id if exists, null otherwise
   */
  async getGroupByForkedFromIdentifier(forkedFromIdentifier: string): Promise<string | null> {
    const result = await this.db.query.chatGroups.findFirst({
      columns: { id: true },
      orderBy: [desc(chatGroups.updatedAt)],
      where: and(
        eq(chatGroups.userId, this.userId),
        sql`${chatGroups.config}->>'forkedFromIdentifier' = ${forkedFromIdentifier}`,
      ),
    });
    return result?.id ?? null;
  }

  async queryWithMemberDetails(): Promise<any[]> {
    const groups = await this.query();
    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.id);

    const groupAgents = await this.db.query.chatGroupsAgents.findMany({
      where: inArray(chatGroupsAgents.chatGroupId, groupIds),
      with: { agent: true },
    });

    const groupAgentMap = new Map<string, any[]>();

    for (const groupAgent of groupAgents) {
      if (!groupAgent.agent) continue;

      const groupList = groupAgentMap.get(groupAgent.chatGroupId) || [];
      groupList.push(groupAgent.agent);
      groupAgentMap.set(groupAgent.chatGroupId, groupList);
    }

    return groups.map((group) => ({
      ...group,
      agents: groupAgentMap.get(group.id) || [],
    }));
  }

  async findGroupWithAgents(groupId: string): Promise<{
    agents: ChatGroupAgentItem[];
    group: ChatGroupItem;
  } | null> {
    const group = await this.findById(groupId);
    if (!group) return null;

    const agents = await this.db.query.chatGroupsAgents.findMany({
      orderBy: [chatGroupsAgents.order],
      where: eq(chatGroupsAgents.chatGroupId, groupId),
    });

    return { agents, group };
  }

  // ******* Create Methods ******* //

  async create(params: Omit<NewChatGroup, 'userId'>): Promise<ChatGroupItem> {
    const [result] = await this.db
      .insert(chatGroups)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  }

  async createWithAgents(
    groupParams: Omit<NewChatGroup, 'userId'>,
    agentIds: string[],
  ): Promise<{ agents: NewChatGroupAgent[]; group: ChatGroupItem }> {
    const group = await this.create(groupParams);

    if (agentIds.length === 0) {
      return { agents: [], group };
    }

    const agentParams: NewChatGroupAgent[] = agentIds.map((agentId, index) => ({
      agentId,
      chatGroupId: group.id,
      order: index,
      userId: this.userId,
    }));

    const agents = await this.db.insert(chatGroupsAgents).values(agentParams).returning();

    return { agents, group };
  }

  // ******* Update Methods ******* //

  async update(id: string, value: Partial<ChatGroupItem>): Promise<ChatGroupItem> {
    const [result] = await this.db
      .update(chatGroups)
      .set(value)
      .where(and(eq(chatGroups.id, id), eq(chatGroups.userId, this.userId)))
      .returning();

    if (!result) {
      throw new Error('Chat group not found or access denied');
    }

    return result;
  }

  async addAgentToGroup(
    groupId: string,
    agentId: string,
    options?: { order?: number; role?: string },
  ): Promise<NewChatGroupAgent> {
    const params: NewChatGroupAgent = {
      agentId,
      chatGroupId: groupId,
      order: options?.order || 0,
      role: options?.role || 'assistant',
      userId: this.userId,
    };

    const [result] = await this.db.insert(chatGroupsAgents).values(params).returning();
    return result;
  }

  /**
   * Add multiple agents to a group.
   * Automatically skips agents that are already in the group.
   *
   * @returns Object containing:
   * - `added`: Agents that were newly added to the group
   * - `existing`: Agent IDs that were already in the group (skipped)
   */
  async addAgentsToGroup(
    groupId: string,
    agentIds: string[],
  ): Promise<{ added: NewChatGroupAgent[]; existing: string[] }> {
    const group = await this.findById(groupId);
    if (!group) throw new Error('Group not found');

    const existingAgents = await this.getGroupAgents(groupId);
    const existingAgentIds = new Set(existingAgents.map((a) => a.agentId));

    const newAgentIds = agentIds.filter((id) => !existingAgentIds.has(id));
    const existingIds = agentIds.filter((id) => existingAgentIds.has(id));

    if (newAgentIds.length === 0) {
      return { added: [], existing: existingIds };
    }

    const newAgents: NewChatGroupAgent[] = newAgentIds.map((agentId) => ({
      agentId,
      chatGroupId: groupId,
      enabled: true,
      userId: this.userId,
    }));

    const added = await this.db.insert(chatGroupsAgents).values(newAgents).returning();

    return { added, existing: existingIds };
  }

  async removeAgentFromGroup(groupId: string, agentId: string): Promise<void> {
    await this.db
      .delete(chatGroupsAgents)
      .where(and(eq(chatGroupsAgents.chatGroupId, groupId), eq(chatGroupsAgents.agentId, agentId)));
  }

  /**
   * Batch remove multiple agents from a group.
   * More efficient than calling removeAgentFromGroup multiple times.
   */
  async removeAgentsFromGroup(groupId: string, agentIds: string[]): Promise<void> {
    if (agentIds.length === 0) return;

    await this.db
      .delete(chatGroupsAgents)
      .where(
        and(eq(chatGroupsAgents.chatGroupId, groupId), inArray(chatGroupsAgents.agentId, agentIds)),
      );
  }

  async updateAgentInGroup(
    groupId: string,
    agentId: string,
    updates: Partial<Pick<NewChatGroupAgent, 'order' | 'role'>>,
  ): Promise<NewChatGroupAgent> {
    const [result] = await this.db
      .update(chatGroupsAgents)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(chatGroupsAgents.chatGroupId, groupId), eq(chatGroupsAgents.agentId, agentId)))
      .returning();

    return result;
  }

  // ******* Delete Methods ******* //

  async delete(id: string): Promise<ChatGroupItem> {
    // Agents are automatically deleted due to CASCADE constraint
    const [result] = await this.db
      .delete(chatGroups)
      .where(and(eq(chatGroups.id, id), eq(chatGroups.userId, this.userId)))
      .returning();

    if (!result) {
      throw new Error('Chat group not found or access denied');
    }

    return result;
  }

  async deleteAll(): Promise<void> {
    await this.db.delete(chatGroups).where(eq(chatGroups.userId, this.userId));
  }

  // ******* Agent Query Methods ******* //

  async getGroupAgents(groupId: string): Promise<ChatGroupAgentItem[]> {
    return this.db.query.chatGroupsAgents.findMany({
      orderBy: [chatGroupsAgents.order],
      where: eq(chatGroupsAgents.chatGroupId, groupId),
    });
  }

  async getEnabledGroupAgents(groupId: string): Promise<ChatGroupAgentItem[]> {
    return this.db.query.chatGroupsAgents.findMany({
      orderBy: [chatGroupsAgents.order],
      where: and(eq(chatGroupsAgents.chatGroupId, groupId), eq(chatGroupsAgents.enabled, true)),
    });
  }

  async getGroupsWithAgents(agentIds?: string[]): Promise<ChatGroupItem[]> {
    if (!agentIds || agentIds.length === 0) {
      return this.query();
    }

    // Find groups containing any of the specified agents
    const groupIds = await this.db
      .selectDistinct({ chatGroupId: chatGroupsAgents.chatGroupId })
      .from(chatGroupsAgents)
      .where(
        and(eq(chatGroupsAgents.userId, this.userId), inArray(chatGroupsAgents.agentId, agentIds)),
      );

    if (groupIds.length === 0) return [];

    return this.db.query.chatGroups.findMany({
      orderBy: [desc(chatGroups.updatedAt)],
      where: and(
        inArray(
          chatGroups.id,
          groupIds.map((g) => g.chatGroupId),
        ),
        eq(chatGroups.userId, this.userId),
      ),
    });
  }
}
