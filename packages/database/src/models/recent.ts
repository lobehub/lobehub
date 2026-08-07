import type { ChatTopicStatus, TaskStatus } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import removeMarkdown from 'remove-markdown';

import {
  agents,
  agentsToSessions,
  chatGroups,
  DOCUMENT_FOLDER_TYPE,
  documents,
  messages,
  tasks,
  topics,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export type RecentView = 'mine' | 'team';

export interface RecentDbItem {
  description?: string | null;
  id: string;
  lastAssistantMessage?: string | null;
  metadata?: any;
  routeGroupId: string | null;
  routeId: string | null;
  /** Task lifecycle status when `type === 'task'`; null for topic/document. */
  status: TaskStatus | null;
  title: string;
  type: 'topic' | 'document' | 'task';
  updatedAt: Date;
  /** The member who owns (created) this item — for author attribution in team views. */
  userId: string;
}

// Mirrors `MAIN_SIDEBAR_EXCLUDE_TRIGGERS` in `src/const/topic.ts` plus the
// legacy `task_manager` trigger from the previous Task Manager panel.
// System-trigger topics live in their own surfaces and would clutter Recent.
const SYSTEM_TOPIC_TRIGGERS = ['cron', 'eval', 'task_manager', 'task', 'document'];

// Excluded so tool-owned document rows don't surface as generic recent docs;
// only user-authored pages ('api') and legacy 'topic' rows remain.
const TOOL_DOCUMENT_SOURCE_TYPES = ['agent', 'agent-signal', 'file', 'web'] as const;

const TASK_FINAL_STATUSES = ['completed', 'canceled'];
const TOPIC_INBOX_STATUSES: ChatTopicStatus[] = ['running', 'unread'];
const LAST_MESSAGE_PREVIEW_LENGTH = 2000;

// Best-effort markdown → plain text; previews render in a plain-text row, so
// syntax noise (**, #, []() …) would show up literally.
const toPlainTextPreview = (markdown: string): string => {
  try {
    return removeMarkdown(markdown).trimEnd();
  } catch {
    return markdown;
  }
};

export class RecentModel {
  private userId: string;
  private workspaceId?: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  queryRecent = async (
    limit: number = 10,
    types?: RecentDbItem['type'][],
    withTopicPreview?: boolean,
    view?: RecentView,
  ): Promise<RecentDbItem[]> => {
    const workspaceId = this.workspaceId;
    const scope = { userId: this.userId, workspaceId };
    const requestedTypes = types ? new Set(types) : undefined;

    // The team feed is shared activity, not merely "mineOnly off": own private
    // resources belong in Mine but must not surface beside workspace content.
    // In personal mode the view is inert because every ownership predicate is
    // already pinned to the caller.
    const teamAgentWhere =
      workspaceId && view === 'team'
        ? or(isNull(agents.visibility), eq(agents.visibility, 'public'))
        : undefined;
    const teamGroupWhere =
      workspaceId && view === 'team'
        ? or(isNull(chatGroups.visibility), eq(chatGroups.visibility, 'public'))
        : undefined;
    const teamDocumentWhere =
      workspaceId && view === 'team'
        ? or(isNull(documents.visibility), eq(documents.visibility, 'public'))
        : undefined;
    const teamTaskWhere =
      workspaceId && view === 'team'
        ? or(isNull(tasks.visibility), eq(tasks.visibility, 'public'))
        : undefined;
    const mineTopicWhere = view === 'mine' ? eq(topics.userId, this.userId) : undefined;
    const mineDocumentWhere = view === 'mine' ? eq(documents.userId, this.userId) : undefined;
    const mineTaskWhere = view === 'mine' ? eq(tasks.createdByUserId, this.userId) : undefined;

    const agentAccessWhere = and(buildWorkspaceWhere(scope, agents), teamAgentWhere) as SQL;
    const groupAccessWhere = and(buildWorkspaceWhere(scope, chatGroups), teamGroupWhere) as SQL;
    const noDirectTopicResource = and(isNull(topics.groupId), isNull(topics.agentId));
    const linkedWorkspaceAgents = (currentWorkspaceId: string, extraCondition?: SQL) =>
      this.db
        .select({ agentId: agentsToSessions.agentId })
        .from(agentsToSessions)
        .innerJoin(agents, eq(agents.id, agentsToSessions.agentId))
        .where(
          and(
            eq(agentsToSessions.sessionId, topics.sessionId),
            eq(agents.workspaceId, currentWorkspaceId),
            extraCondition,
          ),
        );
    const linkedSessionAccessWhere = workspaceId
      ? and(
          noDirectTopicResource,
          isNotNull(topics.sessionId),
          exists(linkedWorkspaceAgents(workspaceId)),
          notExists(linkedWorkspaceAgents(workspaceId, not(agentAccessWhere))),
        )
      : undefined;
    const topicResourceWhere = or(
      and(isNotNull(topics.groupId), groupAccessWhere),
      and(isNull(topics.groupId), isNotNull(topics.agentId), agentAccessWhere),
      linkedSessionAccessWhere,
    );
    const linkedSessionRouteWhere = workspaceId
      ? and(
          noDirectTopicResource,
          exists(
            linkedWorkspaceAgents(
              workspaceId,
              or(eq(agents.slug, 'inbox'), ne(agents.virtual, true)),
            ),
          ),
        )
      : undefined;
    const topicRouteWhere = or(
      isNotNull(topics.groupId),
      eq(agents.slug, 'inbox'),
      and(isNull(topics.groupId), isNotNull(topics.agentId), ne(agents.virtual, true)),
      linkedSessionRouteWhere,
    );
    const routeAgentId = workspaceId
      ? sql<string | null>`COALESCE(${topics.agentId}, (${linkedWorkspaceAgents(
          workspaceId,
          or(eq(agents.slug, 'inbox'), ne(agents.virtual, true)),
        )
          .orderBy(asc(agentsToSessions.agentId))
          .limit(1)}))`
      : topics.agentId;
    const taskScopeWhere = buildWorkspaceWhere(scope, {
      userId: tasks.createdByUserId,
      visibility: tasks.visibility,
      workspaceId: tasks.workspaceId,
    });

    const topicArm = this.db
      .select({
        description: withTopicPreview
          ? topics.description
          : sql<string | null>`NULL`.as('description'),
        id: topics.id,
        metadata: sql<any>`${topics.metadata}`.as('metadata'),
        routeGroupId: sql<string | null>`${topics.groupId}`.as('route_group_id'),
        routeId: sql<string | null>`${routeAgentId}`.as('route_id'),
        status: sql<TaskStatus | null>`NULL`.as('status'),
        title: sql<string>`COALESCE(${topics.title}, 'Untitled Topic')`.as('title'),
        type: sql<RecentDbItem['type']>`'topic'`.as('type'),
        updatedAt: topics.updatedAt,
        userId: topics.userId,
      })
      .from(topics)
      .leftJoin(agents, eq(topics.agentId, agents.id))
      .leftJoin(chatGroups, eq(topics.groupId, chatGroups.id))
      .where(
        requestedTypes && !requestedTypes.has('topic')
          ? sql`false`
          : and(
              buildWorkspaceWhere(scope, topics),
              mineTopicWhere,
              topicResourceWhere,
              topicRouteWhere,
              or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
              or(isNull(topics.status), not(inArray(topics.status, TOPIC_INBOX_STATUSES))),
            ),
      );

    const documentArm = this.db
      .select({
        description: sql<string | null>`NULL`.as('description'),
        id: documents.id,
        metadata: sql<any>`NULL`.as('metadata'),
        routeGroupId: sql<string | null>`NULL`.as('route_group_id'),
        routeId: sql<string | null>`NULL`.as('route_id'),
        status: sql<TaskStatus | null>`NULL`.as('status'),
        title:
          sql<string>`COALESCE(${documents.title}, ${documents.filename}, 'Untitled Document')`.as(
            'title',
          ),
        type: sql<RecentDbItem['type']>`'document'`.as('type'),
        updatedAt: documents.updatedAt,
        userId: documents.userId,
      })
      .from(documents)
      .where(
        requestedTypes && !requestedTypes.has('document')
          ? sql`false`
          : and(
              buildWorkspaceWhere(scope, documents),
              mineDocumentWhere,
              teamDocumentWhere,
              not(inArray(documents.sourceType, TOOL_DOCUMENT_SOURCE_TYPES)),
              isNull(documents.knowledgeBaseId),
              ne(documents.fileType, DOCUMENT_FOLDER_TYPE),
            ),
      );

    const taskArm = this.db
      .select({
        description: sql<string | null>`NULL`.as('description'),
        id: tasks.id,
        metadata: sql<any>`NULL`.as('metadata'),
        routeGroupId: sql<string | null>`NULL`.as('route_group_id'),
        routeId: sql<string | null>`${tasks.assigneeAgentId}`.as('route_id'),
        status: sql<TaskStatus | null>`${tasks.status}`.as('status'),
        title: sql<string>`COALESCE(${tasks.name}, ${tasks.instruction}, 'Untitled Task')`.as(
          'title',
        ),
        type: sql<RecentDbItem['type']>`'task'`.as('type'),
        updatedAt: tasks.updatedAt,
        userId: sql<string>`${tasks.createdByUserId}`.as('user_id'),
      })
      .from(tasks)
      .where(
        requestedTypes && !requestedTypes.has('task')
          ? sql`false`
          : and(
              taskScopeWhere,
              mineTaskWhere,
              teamTaskWhere,
              not(inArray(tasks.status, TASK_FINAL_STATUSES)),
            ),
      );

    const rows = await unionAll(topicArm, documentArm, taskArm)
      .orderBy(desc(sql`updated_at`))
      .limit(limit);

    // Previews are fetched in a second batched query scoped to the final page
    // — inlining a correlated subquery in the topic arm would evaluate it for
    // every topic the user owns before the sort/limit prunes to `limit` rows.
    const previewByTopicId = withTopicPreview
      ? await this.queryLastAssistantPreviews(
          rows.filter((row) => row.type === 'topic').map((row) => row.id),
        )
      : new Map<string, string>();

    return rows.map((row) => {
      const preview = previewByTopicId.get(row.id) ?? null;
      return {
        description: row.description,
        id: row.id,
        lastAssistantMessage:
          preview && preview.length > LAST_MESSAGE_PREVIEW_LENGTH
            ? `${preview.slice(0, LAST_MESSAGE_PREVIEW_LENGTH)}…`
            : preview,
        metadata: row.metadata ?? undefined,
        routeGroupId: row.routeGroupId,
        routeId: row.routeId,
        status: row.status,
        title: row.title,
        type: row.type,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt as any),
        userId: row.userId,
      };
    });
  };

  private queryLastAssistantPreviews = async (topicIds: string[]): Promise<Map<string, string>> => {
    if (topicIds.length === 0) return new Map();

    const rows = await this.db
      .selectDistinctOn([messages.topicId], {
        topicId: messages.topicId,
        value: sql<string>`left(${messages.content}, ${LAST_MESSAGE_PREVIEW_LENGTH + 1})`,
      })
      .from(messages)
      .where(
        and(
          inArray(messages.topicId, topicIds),
          eq(messages.role, 'assistant'),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages),
          ne(messages.content, ''),
        ),
      )
      .orderBy(messages.topicId, desc(messages.createdAt));

    return new Map(
      rows
        .filter((row) => row.topicId !== null)
        .map((row) => [row.topicId!, toPlainTextPreview(row.value)]),
    );
  };
}
