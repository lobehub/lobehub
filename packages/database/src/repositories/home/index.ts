import { INBOX_SESSION_ID } from '@lobechat/const';
import {
  type SidebarAgentItem,
  type SidebarAgentLabel,
  type SidebarAgentListResponse,
  type SidebarGroup,
} from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { and, asc, count, desc, eq, inArray, isNull, not, or, sql } from 'drizzle-orm';

import { ChatGroupModel } from '../../models/chatGroup';
import {
  agentLabelAssignments,
  agentLabels,
  agents,
  chatGroups,
  sessionGroups,
  topics,
  users,
  workspaces,
} from '../../schemas';
import { type LobeChatDatabase } from '../../type';
import { sanitizeBm25Query } from '../../utils/bm25';
import {
  isInboxAgentIdentity,
  keywordMatchesInboxTitle,
  listedAgentWhere,
  normalizeInboxAgentMeta,
} from '../../utils/inboxAgent';
import { inJsonStringArray } from '../../utils/inJsonStringArray';
import { ilikeContains } from '../../utils/like';
import { notShareVisitorTopic } from '../../utils/shareVisitor';
import { notTrashed } from '../../utils/softDelete';
import { CHANNEL_TOPIC_TRIGGER } from '../../utils/topicVisibility';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { FtsSearchCandidateSource } from '../ftsSearch';
import {
  applyPinnedOrder,
  MAX_PINNED_ORDER_ITEMS,
  MAX_RECOMMENDED_ITEMS,
  parsePinnedOrder,
} from './pinnedOrder';

// Mirrors the main chat sidebar's system-topic exclusions, plus the legacy
// task_manager trigger. These topics are surfaced in their own product surfaces,
// so counting them here can leave a badge the regular agent topic list cannot clear.
const HOME_UNREAD_EXCLUDE_TRIGGERS = [
  CHANNEL_TOPIC_TRIGGER,
  'cron',
  'eval',
  'task_manager',
  'task',
  'document',
];

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
  private ftsSearchCandidateSource?: FtsSearchCandidateSource;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    ftsSearchCandidateSource?: FtsSearchCandidateSource,
  ) {
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.db = db;
    this.ftsSearchCandidateSource = ftsSearchCandidateSource;
  }

  private get scope() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  private normalizeVisibility(visibility: 'private' | 'public'): 'private' | 'public' {
    // Personal rows are all implicitly owner-private. The separate private
    // bucket only exists inside a workspace, so personal rows must stay in the
    // regular list even if they retain `visibility = 'private'` after a transfer.
    return this.workspaceId ? visibility : 'public';
  }

  /**
   * Get sidebar agent list with pinned, grouped, and ungrouped items
   *
   * @param includeLabels - whether the caller holds `agent_label:read`. The
   *   router decides; defaulting to `true` keeps personal mode and every
   *   existing caller unchanged, since that grant only exists in a workspace.
   * @param includeInbox - list the scope's inbox (Lobe AI) as an ordinary item.
   *   Off by default: released clients render the inbox as their own row.
   */
  async getSidebarAgentList(
    includeLabels = true,
    includeGroups = true,
    includeInbox = false,
  ): Promise<SidebarAgentListResponse> {
    // 1. Query all non-virtual agents, plus the scope's inbox (Lobe AI).
    //    `visibility` is selected so we can later bucket public vs. the
    //    current user's private rows; the WHERE already hides other members'
    //    private rows via the workspace-aware predicate.
    const agentList = await this.db
      .select({
        agencyConfig: agents.agencyConfig,
        sessionGroupId: agents.sessionGroupId,
        agentUserId: agents.userId,
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        description: agents.description,
        forkedFromIdentifier: sql<string | null>`${agents.params}->>'forkedFromIdentifier'`,
        id: agents.id,
        name: agents.name,
        model: agents.model,
        pinned: agents.pinned,
        slug: agents.slug,
        title: agents.title,
        updatedAt: agents.updatedAt,
        visibility: agents.visibility,
      })
      .from(agents)
      .where(
        and(
          buildWorkspaceWhere(this.scope, {
            isDeleted: agents.isDeleted,
            userId: agents.userId,
            workspaceId: agents.workspaceId,
            visibility: agents.visibility,
          }),
          includeInbox ? listedAgentWhere() : not(eq(agents.virtual, true)),
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
          isDeleted: chatGroups.isDeleted,
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

    // 2.3 Labels applied to agents — one scope-wide query, attached per item
    // in processAgentList so the list can render tags / group by label.
    //
    // Skipped when the caller lacks the label read grant: the registry is
    // gated on `agent_label:read`, and this payload carries the same label
    // names and colors, so returning it anyway would just be a second way in.
    const agentLabelsMap = includeLabels ? await this.getAgentLabelsMap() : new Map();

    // 3. Query sessionGroups (user-defined folders). Folders are the shared
    // skeleton of a workspace sidebar: every member sees the same public
    // folders, in the same shared order. Private folders stay scoped to their
    // creator through the standard visibility predicate. Items whose groupId
    // points at a folder invisible to the caller fall back to the ungrouped
    // list in processAgentList.
    const groupList = !includeGroups
      ? []
      : await this.db
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
              isDeleted: sessionGroups.isDeleted,
              userId: sessionGroups.userId,
              workspaceId: sessionGroups.workspaceId,
              visibility: sessionGroups.visibility,
            }),
          )
          .orderBy(sessionGroups.sort);

    // 4. Process and categorize
    const result = this.processAgentList(
      agentList,
      chatGroupList,
      groupList,
      memberAvatarsMap,
      agentUnread,
      groupUnread,
      agentLabelsMap,
    );

    // 5. Pinned rows follow the order chosen by drag and drop: the team order
    // in a workspace, the user's own order in personal mode.
    if (result.pinned.length > 1) {
      result.pinned = applyPinnedOrder(result.pinned, await this.getPinnedOrder());
    }

    // 6. A workspace recommends Agents to every member; until owners/admins
    // save that list, the team pins (just laid out in team order) stand in.
    if (this.workspaceId) {
      result.recommendedIds =
        (await this.getStoredRecommendedIds()) ?? result.pinned.map((item) => item.id);
    }

    return result;
  }

  /**
   * The workspace's saved recommended Agents / chat groups
   * (`settings.sidebar.recommendedAgentIds`), or `null` while owners/admins
   * never saved one.
   */
  private async getStoredRecommendedIds(): Promise<string[] | null> {
    if (!this.workspaceId) return null;

    const [row] = await this.db
      .select({
        ids: sql<unknown>`${workspaces.settings} #> '{sidebar,recommendedAgentIds}'`,
      })
      .from(workspaces)
      .where(eq(workspaces.id, this.workspaceId));
    return Array.isArray(row?.ids) ? parsePinnedOrder(row.ids) : null;
  }

  /**
   * The Agents / chat groups owners and admins recommend to every member of
   * the workspace, in their order. Until a list is saved, the team pins
   * (public rows with the shared `pinned` column, in team order) are the
   * list. Empty outside a workspace.
   */
  async getRecommendedIds(): Promise<string[]> {
    if (!this.workspaceId) return [];
    return (await this.getStoredRecommendedIds()) ?? this.getTeamPinnedIds();
  }

  /**
   * Replace the workspace's recommended list (see {@link getRecommendedIds}).
   * One UPDATE that rewrites only this key. Callers authorize the write: it
   * changes what every member is recommended.
   */
  async updateRecommendedIds(ids: string[]): Promise<void> {
    if (!this.workspaceId) return;

    const list = JSON.stringify([...new Set(ids)].slice(0, MAX_RECOMMENDED_ITEMS));
    await this.db
      .update(workspaces)
      .set({
        settings: sql`coalesce(${workspaces.settings}, '{}'::jsonb) || jsonb_build_object(
          'sidebar',
          coalesce(${workspaces.settings} -> 'sidebar', '{}'::jsonb)
            || jsonb_build_object('recommendedAgentIds', ${list}::jsonb)
        )`,
      })
      .where(eq(workspaces.id, this.workspaceId));
  }

  /**
   * Ids of the workspace's team pins — public Agents / chat groups whose
   * shared `pinned` column owners/admins set — in the team order. Members who
   * joined while team pins were shown keep them as their own pins (see
   * `WorkspaceUserSettingsModel.initializeSidebar`). Empty outside a
   * workspace.
   */
  async getTeamPinnedIds(): Promise<string[]> {
    if (!this.workspaceId) return [];

    const pinnedAgents = await this.db
      .select({ id: agents.id, updatedAt: agents.updatedAt })
      .from(agents)
      .where(
        and(
          eq(agents.workspaceId, this.workspaceId),
          eq(agents.visibility, 'public'),
          eq(agents.pinned, true),
          notTrashed(agents.isDeleted),
          sql`${agents.virtual} IS NOT TRUE`,
        ),
      );
    const pinnedGroups = await this.db
      .select({ id: chatGroups.id, updatedAt: chatGroups.updatedAt })
      .from(chatGroups)
      .where(
        and(
          eq(chatGroups.workspaceId, this.workspaceId),
          eq(chatGroups.visibility, 'public'),
          eq(chatGroups.pinned, true),
          notTrashed(chatGroups.isDeleted),
        ),
      );

    const rows = [...pinnedAgents, ...pinnedGroups].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
    if (rows.length === 0) return [];

    return applyPinnedOrder(rows, await this.getPinnedOrder()).map((row) => row.id);
  }

  /**
   * The saved order of the `pinned` bucket. In a workspace those rows are the
   * team pins every member sees, so the order is shared and lives on the
   * workspace (`settings.sidebar.teamPinnedOrder`). In personal mode they are
   * the user's own pins (`preference.sidebarPinnedOrder`).
   */
  async getPinnedOrder(): Promise<string[]> {
    if (this.workspaceId) {
      const [row] = await this.db
        .select({ order: sql<unknown>`${workspaces.settings} #> '{sidebar,teamPinnedOrder}'` })
        .from(workspaces)
        .where(eq(workspaces.id, this.workspaceId));
      return parsePinnedOrder(row?.order);
    }

    const [row] = await this.db
      .select({ order: sql<unknown>`${users.preference} -> 'sidebarPinnedOrder'` })
      .from(users)
      .where(eq(users.id, this.userId));
    return parsePinnedOrder(row?.order);
  }

  /**
   * Replace the saved order of the `pinned` bucket (see {@link getPinnedOrder}).
   * One UPDATE that rewrites only this key, so a concurrent write to any other
   * setting or preference is never lost. Callers authorize the workspace write:
   * it changes the team section for every member.
   */
  async updatePinnedOrder(ids: string[]): Promise<void> {
    const order = JSON.stringify([...new Set(ids)].slice(0, MAX_PINNED_ORDER_ITEMS));

    if (this.workspaceId) {
      await this.db
        .update(workspaces)
        .set({
          settings: sql`coalesce(${workspaces.settings}, '{}'::jsonb) || jsonb_build_object(
            'sidebar',
            coalesce(${workspaces.settings} -> 'sidebar', '{}'::jsonb)
              || jsonb_build_object('teamPinnedOrder', ${order}::jsonb)
          )`,
        })
        .where(eq(workspaces.id, this.workspaceId));
      return;
    }

    await this.db
      .update(users)
      .set({
        preference: sql`coalesce(${users.preference}, '{}'::jsonb) || jsonb_build_object('sidebarPinnedOrder', ${order}::jsonb)`,
      })
      .where(eq(users.id, this.userId));
  }

  /**
   * Labels applied to agents in the current scope, keyed by agent id. The
   * junction rows carry the same workspace scoping as the label registry, so
   * one predicate covers both personal and workspace mode.
   */
  private async getAgentLabelsMap(): Promise<Map<string, SidebarAgentLabel[]>> {
    const rows = await this.db
      .select({
        agentId: agentLabelAssignments.agentId,
        color: agentLabels.color,
        id: agentLabels.id,
        name: agentLabels.name,
      })
      .from(agentLabelAssignments)
      .innerJoin(agentLabels, eq(agentLabelAssignments.labelId, agentLabels.id))
      .where(
        buildWorkspaceWhere(this.scope, {
          userId: agentLabelAssignments.userId,
          workspaceId: agentLabelAssignments.workspaceId,
        }),
      )
      .orderBy(asc(agentLabels.name));

    const map = new Map<string, SidebarAgentLabel[]>();
    for (const { agentId, ...label } of rows) {
      const existing = map.get(agentId) || [];
      existing.push(label);
      map.set(agentId, existing);
    }
    return map;
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
    // A workspace scope matches every member's topics; the badge is the caller's own unread.
    const isMine = eq(topics.userId, this.userId);
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
            // Agent-share visitor topics keep the creator's userId — never bump
            // the creator's own unread badge for a visitor's conversation.
            notShareVisitorTopic(),
            isMine,
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
            notShareVisitorTopic(),
            isMine,
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
      agentUserId: string;
      avatar: string | null;
      backgroundColor: string | null;
      description: string | null;
      forkedFromIdentifier: string | null;
      id: string;
      name: string | null;
      model: string | null;
      pinned: boolean | null;
      sessionGroupId: string | null;
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
    agentLabelsMap: Map<string, SidebarAgentLabel[]> = new Map(),
  ): SidebarAgentListResponse {
    // Sidebar organization (folder membership + pin) is SHARED in workspace
    // mode: it reads the same `sessionGroupId` / `pinned` columns as personal
    // mode, so one member's grouping and pinning is what every member sees.
    // The only per-member layer left is show/hide, applied client-side from
    // `sidebarAgentVisibilityOverrides` / `sidebarHiddenGroupIds`.
    // Convert to unified format
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
        const visibility = this.normalizeVisibility(a.visibility);

        return {
          avatar: meta.avatar,
          backgroundColor: a.backgroundColor,
          description: a.description,
          forkedFromIdentifier: a.forkedFromIdentifier,
          groupId: a.sessionGroupId,
          heterogeneousType: a.agencyConfig?.heterogeneousProvider?.type ?? null,
          id: a.id,
          isPrivate: visibility === 'private',
          labels: agentLabelsMap.get(a.id),
          name: a.name,
          model: a.model,
          pinned: a.pinned ?? false,
          slug: a.slug,
          title: meta.title,
          type: 'agent' as const,
          unreadCount: agentUnread.get(a.id) ?? 0,
          updatedAt: a.updatedAt,
          userId: a.agentUserId,
          visibility,
        };
      }),
      ...chatGroupItems.map((g): EnrichedItem => {
        const visibility = this.normalizeVisibility(g.visibility);

        return {
          // If group has custom avatar, use it (string); otherwise fallback to member avatars (array)
          avatar: g.avatar || (memberAvatarsMap.get(g.id) ?? null),
          backgroundColor: g.backgroundColor,
          description: g.description,
          groupAvatar: g.avatar,
          groupId: g.groupId,
          id: g.id,
          isPrivate: visibility === 'private',
          pinned: g.pinned ?? false,
          title: g.title,
          type: 'group' as const,
          unreadCount: groupUnread.get(g.id) ?? 0,
          updatedAt: g.updatedAt,
          userId: g.groupUserId,
          visibility,
        };
      }),
    ];

    // Sort all items by updatedAt descending. The inbox (LobeAI) leads its
    // bucket: its row is rarely updated, so by recency alone the default
    // Agent would sink below the page-size cut and vanish from the sidebar.
    allItems.sort(
      (a, b) =>
        Number(isInboxAgentIdentity(b)) - Number(isInboxAgentIdentity(a)) ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    );

    // Categorize: pinned / grouped / ungrouped, split by visibility. Pinned
    // wins over grouping, but stays within its visibility bucket — a pinned
    // private agent must surface at the top of the Private section, not jump
    // into the shared (public) pinned list.
    const pinned: SidebarAgentItem[] = [];
    const privatePinned: SidebarAgentItem[] = [];
    const ungrouped: SidebarAgentItem[] = [];
    const privateUngrouped: SidebarAgentItem[] = [];
    const groupedMap = new Map<string, SidebarAgentItem[]>();
    const privateGroupedMap = new Map<string, SidebarAgentItem[]>();

    // Group ids that will actually render, split by visibility bucket. An
    // item whose groupId resolves to no visible folder (e.g. a folder from
    // another scope left behind by a transfer, or a deleted folder) must fall
    // back to the ungrouped list instead of being silently dropped.
    const groupIds = new Set<string>();
    const privateGroupIds = new Set<string>();
    for (const g of groupItems) {
      const visibility = this.normalizeVisibility(g.visibility);
      (visibility === 'private' ? privateGroupIds : groupIds).add(g.id);
    }

    for (const item of allItems) {
      const { groupId, isPrivate, ...sidebarItem } = item;
      const validGroupIds = isPrivate ? privateGroupIds : groupIds;
      const categoryId = groupId && validGroupIds.has(groupId) ? groupId : null;
      const cleanedItem = {
        ...cleanObject(sidebarItem),
        groupId: categoryId,
      } as SidebarAgentItem;

      if (item.pinned) {
        (isPrivate ? privatePinned : pinned).push(cleanedItem);
        continue;
      }

      if (categoryId) {
        const bucket = isPrivate ? privateGroupedMap : groupedMap;
        const existing = bucket.get(categoryId) || [];
        existing.push(cleanedItem);
        bucket.set(categoryId, existing);
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
      const visibility = this.normalizeVisibility(g.visibility);
      const target = visibility === 'private' ? privateGroups : groups;
      const itemsMap = visibility === 'private' ? privateGroupedMap : groupedMap;
      target.push({
        id: g.id,
        items: itemsMap.get(g.id) || [],
        name: g.name,
        sort: g.sort,
        visibility,
      });
    }

    return { groups, pinned, privateGroups, privatePinned, privateUngrouped, ungrouped };
  }

  /**
   * Search agents and chat groups by keyword
   * Searches in title and description fields
   *
   * @param includeInbox - also match the scope's inbox (Lobe AI); see
   *   {@link getSidebarAgentList}.
   */
  async searchAgents(keyword: string, includeInbox = false): Promise<SidebarAgentItem[]> {
    if (!keyword.trim()) return [];

    const bm25Query = sanitizeBm25Query(keyword);
    const candidateResults = this.ftsSearchCandidateSource?.ftsSearchCandidateEnabled
      ? await Promise.all([
          this.ftsSearchCandidateSource.ftsSearchCandidates({
            entity: 'agents',
            filters: { excludeVirtual: true },
            pagination: {},
            query: { fields: ['title', 'description'], text: keyword },
          }),
          this.ftsSearchCandidateSource.ftsSearchCandidates({
            entity: 'chatGroups',
            filters: {},
            pagination: {},
            query: { fields: ['title', 'description'], text: keyword },
          }),
        ])
      : undefined;
    const agentCandidateIds = candidateResults?.[0].candidates.map(({ id }) => id);
    const chatGroupCandidateIds = candidateResults?.[1].candidates.map(({ id }) => id);

    // Run agent and chat group searches in parallel
    const [agentResults, chatGroupResults] = await Promise.all([
      // 1. Search agents by title or description (BM25)
      this.db
        .select({
          avatar: agents.avatar,
          backgroundColor: agents.backgroundColor,
          description: agents.description,
          id: agents.id,
          name: agents.name,
          pinned: agents.pinned,
          slug: agents.slug,
          title: agents.title,
          updatedAt: agents.updatedAt,
          userId: agents.userId,
          visibility: agents.visibility,
        })
        .from(agents)
        .where(
          and(
            buildWorkspaceWhere(this.scope, agents),
            or(
              and(
                not(eq(agents.virtual, true)),
                agentCandidateIds
                  ? inJsonStringArray(agents.id, agentCandidateIds)
                  : sql`(${agents.title} @@@ ${bm25Query} OR ${agents.description} @@@ ${bm25Query})`,
              ),
              // The inbox is a virtual row the search index skips, so it is matched by name
              // here. Its stored title is usually blank and shown as Lobe AI, so a blank
              // title also matches that default name.
              includeInbox
                ? and(
                    eq(agents.slug, INBOX_SESSION_ID),
                    or(
                      ilikeContains(agents.title, keyword.trim()),
                      ilikeContains(agents.name, keyword.trim()),
                      ilikeContains(agents.description, keyword.trim()),
                      keywordMatchesInboxTitle(keyword)
                        ? sql`nullif(trim(${agents.title}), '') is null`
                        : undefined,
                    ),
                  )
                : undefined,
            ),
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
          userId: chatGroups.userId,
          visibility: chatGroups.visibility,
        })
        .from(chatGroups)
        .where(
          and(
            buildWorkspaceWhere(this.scope, chatGroups),
            chatGroupCandidateIds
              ? inJsonStringArray(chatGroups.id, chatGroupCandidateIds)
              : sql`(${chatGroups.title} @@@ ${bm25Query} OR ${chatGroups.description} @@@ ${bm25Query})`,
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
        const visibility = this.normalizeVisibility(a.visibility);

        return cleanObject({
          avatar: meta.avatar,
          backgroundColor: a.backgroundColor,
          description: a.description,
          id: a.id,
          name: a.name,
          pinned: a.pinned ?? false,
          slug: a.slug,
          title: meta.title,
          type: 'agent' as const,
          updatedAt: a.updatedAt,
          userId: a.userId,
          visibility,
        });
      }),
      ...chatGroupResults.map((g) => {
        const visibility = this.normalizeVisibility(g.visibility);

        return cleanObject({
          avatar: g.avatar || (memberAvatarsMap.get(g.id) ?? null),
          backgroundColor: g.backgroundColor,
          description: g.description,
          id: g.id,
          pinned: g.pinned ?? false,
          title: g.title,
          type: 'group' as const,
          updatedAt: g.updatedAt,
          userId: g.userId,
          visibility,
        });
      }),
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
