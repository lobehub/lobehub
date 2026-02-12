import type { SidebarAgentItem, SidebarAgentListResponse, SidebarGroup } from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { and, desc, eq, ilike, inArray, not, or } from 'drizzle-orm';

import {
  agents,
  agentsToSessions,
  chatGroups,
  chatGroupsAgents,
  sessionGroups,
  sessions,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';

// Re-export types for backward compatibility
export type {
  SidebarAgentItem,
  SidebarAgentListResponse,
  SidebarGroup,
  SidebarItemType,
} from '@lobechat/types';

/**
 * Home Repository - provides sidebar agent list data
 */
export class HomeRepository {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * Get sidebar agent list with pinned, grouped, and ungrouped items
   */
  async getSidebarAgentList(): Promise<SidebarAgentListResponse> {
    // 1. Query all agents (non-virtual) with their session info (if exists)
    const agentList = await this.db
      .select({
        agentSessionGroupId: agents.sessionGroupId,
        avatar: agents.avatar,
        description: agents.description,
        id: agents.id,
        pinned: agents.pinned,
        sessionGroupId: sessions.groupId,
        sessionId: sessions.id,
        sessionPinned: sessions.pinned,
        title: agents.title,
        updatedAt: agents.updatedAt,
      })
      .from(agents)
      .leftJoin(agentsToSessions, eq(agents.id, agentsToSessions.agentId))
      .leftJoin(sessions, eq(agentsToSessions.sessionId, sessions.id))
      .where(and(eq(agents.userId, this.userId), not(eq(agents.virtual, true))))
      .orderBy(desc(agents.updatedAt));

    // 2. Query all chatGroups (group chats)
    const chatGroupList = await this.db
      .select({
        avatar: chatGroups.avatar,
        backgroundColor: chatGroups.backgroundColor,
        description: chatGroups.description,
        groupId: chatGroups.groupId,
        id: chatGroups.id,
        pinned: chatGroups.pinned,
        title: chatGroups.title,
        updatedAt: chatGroups.updatedAt,
      })
      .from(chatGroups)
      .where(eq(chatGroups.userId, this.userId))
      .orderBy(desc(chatGroups.updatedAt));

    // 2.1 Query member avatars for each chat group
    const memberAvatarsMap = await this.getChatGroupMemberAvatars(chatGroupList.map((g) => g.id));

    // 3. Query all sessionGroups (user-defined folders)
    const groupList = await this.db
      .select({
        id: sessionGroups.id,
        name: sessionGroups.name,
        sort: sessionGroups.sort,
      })
      .from(sessionGroups)
      .where(eq(sessionGroups.userId, this.userId))
      .orderBy(sessionGroups.sort);

    // 4. Process and categorize
    return this.processAgentList(agentList, chatGroupList, groupList, memberAvatarsMap);
  }

  private processAgentList(
    agentItems: Array<{
      agentSessionGroupId: string | null;
      avatar: string | null;
      description: string | null;
      id: string;
      pinned: boolean | null;
      sessionGroupId: string | null;
      sessionId: string | null;
      sessionPinned: boolean | null;
      title: string | null;
      updatedAt: Date;
    }>,
    chatGroupItems: Array<{
      avatar: string | null;
      backgroundColor: string | null;
      description: string | null;
      groupId: string | null;
      id: string;
      pinned: boolean | null;
      title: string | null;
      updatedAt: Date;
    }>,
    groupItems: Array<{
      id: string;
      name: string;
      sort: number | null;
    }>,
    memberAvatarsMap: Map<string, Array<{ avatar: string; background?: string }>>,
  ): SidebarAgentListResponse {
    // Convert to unified format
    // For pinned status: agents.pinned takes priority, fallback to sessions.pinned for backward compatibility
    // For groupId: agents.sessionGroupId takes priority, fallback to sessions.groupId for backward compatibility
    const allItems: Array<SidebarAgentItem & { groupId: string | null }> = [
      ...agentItems.map((a) => ({
        avatar: a.avatar,
        description: a.description,
        groupId: a.agentSessionGroupId ?? a.sessionGroupId,
        id: a.id,
        pinned: a.pinned ?? a.sessionPinned ?? false,
        sessionId: a.sessionId,
        title: a.title,
        type: 'agent' as const,
        updatedAt: a.updatedAt,
      })),
      ...chatGroupItems.map((g) => ({
        // If group has custom avatar, use it (string); otherwise fallback to member avatars (array)
        avatar: g.avatar ? g.avatar : (memberAvatarsMap.get(g.id) ?? null),
        backgroundColor: g.avatar ? g.backgroundColor : null,
        description: g.description,
        groupId: g.groupId,
        id: g.id,
        pinned: g.pinned ?? false,
        sessionId: null,
        title: g.title,
        type: 'group' as const,
        updatedAt: g.updatedAt,
      })),
    ];

    // Sort all items by updatedAt descending
    allItems.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Categorize: pinned / grouped / ungrouped
    const pinned: SidebarAgentItem[] = [];
    const ungrouped: SidebarAgentItem[] = [];
    const groupedMap = new Map<string, SidebarAgentItem[]>();

    for (const item of allItems) {
      const { groupId, ...sidebarItem } = item;
      const cleanedItem = cleanObject(sidebarItem) as SidebarAgentItem;

      if (item.pinned) {
        pinned.push(cleanedItem);
      } else if (groupId) {
        const existing = groupedMap.get(groupId) || [];
        existing.push(cleanedItem);
        groupedMap.set(groupId, existing);
      } else {
        ungrouped.push(cleanedItem);
      }
    }

    // Build groups array with items
    const groups: SidebarGroup[] = groupItems.map((g) => ({
      id: g.id,
      items: groupedMap.get(g.id) || [],
      name: g.name,
      sort: g.sort,
    }));

    return { groups, pinned, ungrouped };
  }

  /**
   * Search agents and chat groups by keyword
   * Searches in title and description fields
   */
  async searchAgents(keyword: string): Promise<SidebarAgentItem[]> {
    if (!keyword.trim()) return [];

    const searchPattern = `%${keyword.toLowerCase()}%`;

    // 1. Search agents by title or description
    const agentResults = await this.db
      .select({
        avatar: agents.avatar,
        description: agents.description,
        id: agents.id,
        pinned: agents.pinned,
        sessionId: sessions.id,
        sessionPinned: sessions.pinned,
        title: agents.title,
        updatedAt: agents.updatedAt,
      })
      .from(agents)
      .leftJoin(agentsToSessions, eq(agents.id, agentsToSessions.agentId))
      .leftJoin(sessions, eq(agentsToSessions.sessionId, sessions.id))
      .where(
        and(
          eq(agents.userId, this.userId),
          not(eq(agents.virtual, true)),
          or(ilike(agents.title, searchPattern), ilike(agents.description, searchPattern)),
        ),
      )
      .orderBy(desc(agents.updatedAt));

    // 2. Search chat groups by title or description
    const chatGroupResults = await this.db
      .select({
        avatar: chatGroups.avatar,
        backgroundColor: chatGroups.backgroundColor,
        description: chatGroups.description,
        id: chatGroups.id,
        pinned: chatGroups.pinned,
        title: chatGroups.title,
        updatedAt: chatGroups.updatedAt,
      })
      .from(chatGroups)
      .where(
        and(
          eq(chatGroups.userId, this.userId),
          or(ilike(chatGroups.title, searchPattern), ilike(chatGroups.description, searchPattern)),
        ),
      )
      .orderBy(desc(chatGroups.updatedAt));

    // 2.1 Query member avatars for matching chat groups
    const memberAvatarsMap = await this.getChatGroupMemberAvatars(
      chatGroupResults.map((g) => g.id),
    );

    // 3. Combine and format results
    const results: SidebarAgentItem[] = [
      ...agentResults.map((a) =>
        cleanObject({
          avatar: a.avatar,
          description: a.description,
          id: a.id,
          pinned: a.pinned ?? a.sessionPinned ?? false,
          sessionId: a.sessionId,
          title: a.title,
          type: 'agent' as const,
          updatedAt: a.updatedAt,
        }),
      ),
      ...chatGroupResults.map((g) =>
        cleanObject({
          avatar: g.avatar ? g.avatar : (memberAvatarsMap.get(g.id) ?? null),
          backgroundColor: g.avatar ? g.backgroundColor : null,
          description: g.description,
          id: g.id,
          pinned: g.pinned ?? false,
          title: g.title,
          type: 'group' as const,
          updatedAt: g.updatedAt,
        }),
      ),
    ] as SidebarAgentItem[];

    // Sort by updatedAt descending
    results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return results;
  }

  /**
   * Query member avatars for chat groups
   */
  private async getChatGroupMemberAvatars(
    chatGroupIds: string[],
  ): Promise<Map<string, Array<{ avatar: string; background?: string }>>> {
    const memberAvatarsMap = new Map<string, Array<{ avatar: string; background?: string }>>();

    if (chatGroupIds.length === 0) return memberAvatarsMap;

    const memberAvatars = await this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        chatGroupId: chatGroupsAgents.chatGroupId,
      })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(inArray(chatGroupsAgents.chatGroupId, chatGroupIds))
      .orderBy(chatGroupsAgents.order);

    for (const member of memberAvatars) {
      const existing = memberAvatarsMap.get(member.chatGroupId) || [];
      if (member.avatar) {
        existing.push({
          avatar: member.avatar,
          background: member.backgroundColor ?? undefined,
        });
      }
      memberAvatarsMap.set(member.chatGroupId, existing);
    }

    return memberAvatarsMap;
  }
}
