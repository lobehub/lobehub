import {
  type SidebarAgentItem,
  type SidebarAgentListResponse,
  type SidebarGroup,
} from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { and, count, desc, eq, inArray, isNull, not, or, sql } from 'drizzle-orm';

import { ChatGroupModel } from '../../models/chatGroup';
import {
  agents,
  agentsToSessions,
  chatGroups,
  sessionGroups,
  sessions,
  topics,
} from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { sanitizeBm25Query } from '../../utils/bm25';
import { normalizeInboxAgentMeta } from '../../utils/inboxAgent';
import { buildWorkspaceWhere } from '../../utils/workspace';

// Mirrors the main chat sidebar's system-topic exclusions, plus the legacy
// task_manager trigger. These topics are surfaced in their own product surfaces,
// so counting them here can leave a badge the regular agent topic list cannot clear.
const HOME_UNREAD_EXCLUDE_TRIGGERS = ['cron', 'eval', 'task_manager', 'task', 'document'];

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
  private workspaceId?: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.db = db;
  }

  private get scope() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  /**
   * Get sidebar agent list with pinned, grouped, and ungrouped items
   */
  async getSidebarAgentList(): Promise<SidebarAgentListResponse> {
    // 1. Query all agents (non-virtual) with their session info (if exists).
    //    `visibility` is selected so we can later bucket public vs. the
    //    current user's private rows; the WHERE already hides other members'
    //    private rows via the workspace-aware predicate.
    const agentList = await this.db
      .select({
        agencyConfig: agents.agencyConfig,
        agentSessionGroupId: agents.sessionGroupId,
        agentUserId: agents.userId,
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        description: agents.description,
        id: agents.id,
        pinned: agents.pinned,
        sessionGroupId: sessions.groupId,
        sessionId: sessions.id,
        sessionPinned: sessions.pinned,
        slug: agents.slug,
        title: agents.title,
        updatedAt: agents.updatedAt,
        visibility: agents.visibility,
      })
      .from(agents)
      .leftJoin(agentsToSessions, eq(agents.id, agentsToSessions.agentId))
      .leftJoin(sessions, eq(agentsToSessions.sessionId, sessions.id))
      .where(
        and(
          buildWorkspaceWhere(this.scope, {
            userId: agents.userId,
            workspaceId: agents.workspaceId,
            visibility: agents.visibility,
          }),
          not(eq(agents.virtual, true)),
        ),
      )
      .orderBy(desc(agents.updatedAt));

    // 2. Query all chatGroups (group chats)
    const chatGroupList = await this.db
      .select({
        avatar: chatGroups.avatar,
        backgroundColor: chatGroups.backgroundColor,
        description: chatGroups.description,
        groupId: chatGroups.groupId,
        groupUserId: chatGroups.userId,
        id: chatGroups.id,
        pinned: chatGroups.pinned,
        title: chatGroups.title,
        updatedAt: chatGroups.updatedAt,
        visibility: chatGroups.visibility,
      })
      .from(chatGroups)
      .where(
        buildWorkspaceWhere(this.scope, {
          userId: chatGroups.userId,
          workspaceId: chatGroups.workspaceId,
          visibility: chatGroups.visibility,
        }),
      )
      .orderBy(desc(chatGroups.updatedAt));

    // 2.1 Query member avatars for each chat group
    const memberAvatarsMap = await this.getChatGroupMemberAvatars(chatGroupList.map((g) => g.id));

    // 2.2 Unread completion counts per agent / group, derived from persisted
    // `topics.status === 'unread'`. The list query covers all agents, so this is
    // the source of truth for the sidebar badge even on agents the client hasn't
    // loaded topics for.
    const { agentUnread, groupUnread } = await this.getUnreadCounts();

    // 3. Query all sessionGroups (user-defined folders)
    const groupList = await this.db
      .select({
        id: sessionGroups.id,
        name: sessionGroups.name,
        sort: sessionGroups.sort,
        userId: sessionGroups.userId,
        visibility: sessionGroups.visibility,
      })
      .from(sessionGroups)
      .where(
        buildWorkspaceWhere(this.scope, {
          userId: sessionGroups.userId,
          workspaceId: sessionGroups.workspaceId,
          visibility: sessionGroups.visibility,
        }),
      )
      .orderBy(sessionGroups.sort);

    // 4. Process and categorize
    return this.processAgentList(
      agentList,
      chatGroupList,
      groupList,
      memberAvatarsMap,
      agentUnread,
      groupUnread,
    );
  }

  /**
   * Count topics with an unread completed generation, grouped by agent and by
   * group. Returns plain maps keyed by agentId / groupId.
   */
  private async getUnreadCounts(): Promise<{
    agentUnread: Map<string, number>;
    groupUnread: Map<string, number>;
  }> {
    const isUnread = eq(topics.status, 'unread');
    const isMainSidebarTopic = or(
      isNull(topics.trigger),
      not(inArray(topics.trigger, HOME_UNREAD_EXCLUDE_TRIGGERS)),
    );

    const [byAgent, byGroup] = await Promise.all([
      this.db
        .select({ id: topics.agentId, value: count() })
        .from(topics)
        .where(
          and(
            buildWorkspaceWhere(this.scope, topics),
            isUnread,
            isMainSidebarTopic,
            sql`${topics.agentId} is not null`,
          ),
        )
        .groupBy(topics.agentId),
      this.db
        .select({ id: topics.groupId, value: count() })
        .from(topics)
        .where(
          and(
            buildWorkspaceWhere(this.scope, topics),
            isUnread,
            isMainSidebarTopic,
            sql`${topics.groupId} is not null`,
          ),
        )
        .groupBy(topics.groupId),
    ]);

    const agentUnread = new Map<string, number>();
    for (const row of byAgent) if (row.id) agentUnread.set(row.id, row.value);

    const groupUnread = new Map<string, number>();
    for (const row of byGroup) if (row.id) groupUnread.set(row.id, row.value);

    return { agentUnread, groupUnread };
  }

  private processAgentList(
    agentItems: Array<{
      agencyConfig: { heterogeneousProvider?: { type?: string } } | null;
      agentSessionGroupId: string | null;
      agentUserId: string;
      avatar: string | null;
      backgroundColor: string | null;
      description: string | null;
      id: string;
      pinned: boolean | null;
      sessionGroupId: string | null;
      sessionId: string | null;
      sessionPinned: boolean | null;
      slug: string | null;
      title: string | null;
      updatedAt: Date;
      visibility: 'private' | 'public';
    }>,
    chatGroupItems: Array<{
      avatar: string | null;
      backgroundColor: string | null;
      description: string | null;
      groupId: string | null;
      groupUserId: string;
      id: string;
      pinned: boolean | null;
      title: string | null;
      updatedAt: Date;
      visibility: 'private' | 'public';
    }>,
    groupItems: Array<{
      id: string;
      name: string;
      sort: number | null;
      userId: string;
      visibility: 'private' | 'public';
    }>,
    memberAvatarsMap: Map<string, Array<{ avatar: string; background?: string }>>,
    agentUnread: Map<string, number> = new Map(),
    groupUnread: Map<string, number> = new Map(),
  ): SidebarAgentListResponse {
    // Convert to unified format
    // For pinned status: agents.pinned takes priority, fallback to sessions.pinned for backward compatibility
    // For groupId: agents.sessionGroupId takes priority, fallback to sessions.groupId for backward compatibility
    type EnrichedItem = SidebarAgentItem & {
      groupId: string | null;
      isPrivate: boolean;
    };

    const allItems: EnrichedItem[] = [
      ...agentItems.map((a): EnrichedItem => {
        const meta = normalizeInboxAgentMeta(
          { avatar: a.avatar, title: a.title },
          { slug: a.slug },
        );

        return {
          avatar: meta.avatar,
          backgroundColor: a.backgroundColor,
          description: a.description,
          groupId: a.agentSessionGroupId ?? a.sessionGroupId,
          heterogeneousType: a.agencyConfig?.heterogeneousProvider?.type ?? null,
          id: a.id,
          isPrivate: a.visibility === 'private',
          pinned: a.pinned ?? a.sessionPinned ?? false,
          sessionId: a.sessionId,
          slug: a.slug,
          title: meta.title,
          type: 'agent' as const,
          unreadCount: agentUnread.get(a.id) ?? 0,
          updatedAt: a.updatedAt,
          userId: a.agentUserId,
          visibility: a.visibility,
        };
      }),
      ...chatGroupItems.map((g): EnrichedItem => ({
        // If group has custom avatar, use it (string); otherwise fallback to member avatars (array)
        avatar: g.avatar ? g.avatar : (memberAvatarsMap.get(g.id) ?? null),
        backgroundColor: g.backgroundColor,
        description: g.description,
        groupAvatar: g.avatar,
        groupId: g.groupId,
        id: g.id,
        isPrivate: g.visibility === 'private',
        pinned: g.pinned ?? false,
        sessionId: null,
        title: g.title,
        type: 'group' as const,
        unreadCount: groupUnread.get(g.id) ?? 0,
        updatedAt: g.updatedAt,
        visibility: g.visibility,
      })),
    ];

    // Sort all items by updatedAt descending
    allItems.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Categorize: pinned / grouped / ungrouped, split by visibility. Pinned
    // items always bubble to the top regardless of visibility so the user can
    // surface their own private agents without leaving them buried.
    const pinned: SidebarAgentItem[] = [];
    const ungrouped: SidebarAgentItem[] = [];
    const privateUngrouped: SidebarAgentItem[] = [];
    const groupedMap = new Map<string, SidebarAgentItem[]>();
    const privateGroupedMap = new Map<string, SidebarAgentItem[]>();

    for (const item of allItems) {
      const { groupId, isPrivate, ...sidebarItem } = item;
      const cleanedItem = cleanObject(sidebarItem) as SidebarAgentItem;

      if (item.pinned) {
        pinned.push(cleanedItem);
        continue;
      }

      if (groupId) {
        const bucket = isPrivate ? privateGroupedMap : groupedMap;
        const existing = bucket.get(groupId) || [];
        existing.push(cleanedItem);
        bucket.set(groupId, existing);
      } else if (isPrivate) {
        privateUngrouped.push(cleanedItem);
      } else {
        ungrouped.push(cleanedItem);
      }
    }

    // Build groups arrays. A private folder houses only its private items;
    // a public folder houses only its public items. (A folder cannot mix
    // visibilities — items inherit their parent's scope on create.)
    const groups: SidebarGroup[] = [];
    const privateGroups: SidebarGroup[] = [];
    for (const g of groupItems) {
      const target = g.visibility === 'private' ? privateGroups : groups;
      const itemsMap = g.visibility === 'private' ? privateGroupedMap : groupedMap;
      target.push({
        id: g.id,
        items: itemsMap.get(g.id) || [],
        name: g.name,
        sort: g.sort,
        visibility: g.visibility,
      });
    }

    return { groups, pinned, privateGroups, privateUngrouped, ungrouped };
  }

  /**
   * Search agents and chat groups by keyword
   * Searches in title and description fields
   */
  async searchAgents(keyword: string): Promise<SidebarAgentItem[]> {
    if (!keyword.trim()) return [];

    const bm25Query = sanitizeBm25Query(keyword);

    // Run agent and chat group searches in parallel
    const [agentResults, chatGroupResults] = await Promise.all([
      // 1. Search agents by title or description (BM25)
      this.db
        .select({
          avatar: agents.avatar,
          backgroundColor: agents.backgroundColor,
          description: agents.description,
          id: agents.id,
          pinned: agents.pinned,
          sessionId: sessions.id,
          sessionPinned: sessions.pinned,
          slug: agents.slug,
          title: agents.title,
          updatedAt: agents.updatedAt,
        })
        .from(agents)
        .leftJoin(agentsToSessions, eq(agents.id, agentsToSessions.agentId))
        .leftJoin(sessions, eq(agentsToSessions.sessionId, sessions.id))
        .where(
          and(
            buildWorkspaceWhere(this.scope, agents),
            not(eq(agents.virtual, true)),
            sql`(${agents.title} @@@ ${bm25Query} OR ${agents.description} @@@ ${bm25Query})`,
          ),
        )
        .orderBy(desc(agents.updatedAt)),
      // 2. Search chat groups by title or description (BM25)
      this.db
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
            buildWorkspaceWhere(this.scope, chatGroups),
            sql`(${chatGroups.title} @@@ ${bm25Query} OR ${chatGroups.description} @@@ ${bm25Query})`,
          ),
        )
        .orderBy(desc(chatGroups.updatedAt)),
    ]);

    // 2.1 Query member avatars for matching chat groups
    const memberAvatarsMap = await this.getChatGroupMemberAvatars(
      chatGroupResults.map((g) => g.id),
    );

    // 3. Combine and format results
    const results: SidebarAgentItem[] = [
      ...agentResults.map((a) => {
        const meta = normalizeInboxAgentMeta(
          { avatar: a.avatar, title: a.title },
          { slug: a.slug },
        );

        return cleanObject({
          avatar: meta.avatar,
          backgroundColor: a.backgroundColor,
          description: a.description,
          id: a.id,
          pinned: a.pinned ?? a.sessionPinned ?? false,
          sessionId: a.sessionId,
          title: meta.title,
          type: 'agent' as const,
          updatedAt: a.updatedAt,
        });
      }),
      ...chatGroupResults.map((g) =>
        cleanObject({
          avatar: g.avatar ? g.avatar : (memberAvatarsMap.get(g.id) ?? null),
          backgroundColor: g.backgroundColor,
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

    const metasMap = await new ChatGroupModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).getMemberAvatarsByGroupIds(chatGroupIds);

    for (const [chatGroupId, members] of metasMap) {
      memberAvatarsMap.set(
        chatGroupId,
        members
          .filter((member) => member.avatar)
          .map((member) => ({
            avatar: member.avatar as string,
            background: member.backgroundColor ?? undefined,
          })),
      );
    }

    return memberAvatarsMap;
  }
}
