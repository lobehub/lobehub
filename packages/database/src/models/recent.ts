import type { ChatTopicStatus, TaskStatus } from '@lobechat/types';
import { and, desc, eq, inArray, isNotNull, isNull, ne, not, or, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';

import { agents, DOCUMENT_FOLDER_TYPE, documents, messages, tasks, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

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
  ): Promise<RecentDbItem[]> => {
    const scope = { userId: this.userId, workspaceId: this.workspaceId };
    const requestedTypes = types ? new Set(types) : undefined;

    // `tasks` uses `createdByUserId` instead of `userId`, so apply the
    // workspace-aware predicate inline.
    const taskScopeWhere = this.workspaceId
      ? eq(tasks.workspaceId, this.workspaceId)
      : and(eq(tasks.createdByUserId, this.userId), isNull(tasks.workspaceId));

    const lastAssistantMessageSubquery = this.db
      .select({
        value: sql<string>`left(${messages.content}, ${LAST_MESSAGE_PREVIEW_LENGTH + 1})`,
      })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, topics.id),
          eq(messages.role, 'assistant'),
          buildWorkspaceWhere(scope, messages),
          ne(messages.content, ''),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    const topicArm = this.db
      .select({
        description: withTopicPreview
          ? topics.description
          : sql<string | null>`NULL`.as('description'),
        id: topics.id,
        lastAssistantMessage: withTopicPreview
          ? sql<string | null>`(${lastAssistantMessageSubquery})`.as('last_assistant_message')
          : sql<string | null>`NULL`.as('last_assistant_message'),
        metadata: sql<any>`${topics.metadata}`.as('metadata'),
        routeGroupId: sql<string | null>`${topics.groupId}`.as('route_group_id'),
        routeId: sql<string | null>`${topics.agentId}`.as('route_id'),
        status: sql<TaskStatus | null>`NULL`.as('status'),
        title: sql<string>`COALESCE(${topics.title}, 'Untitled Topic')`.as('title'),
        type: sql<RecentDbItem['type']>`'topic'`.as('type'),
        updatedAt: topics.updatedAt,
      })
      .from(topics)
      .leftJoin(agents, eq(topics.agentId, agents.id))
      .where(
        requestedTypes && !requestedTypes.has('topic')
          ? sql`false`
          : and(
              buildWorkspaceWhere(scope, topics),
              or(
                isNotNull(topics.groupId),
                eq(agents.slug, 'inbox'),
                and(isNull(topics.groupId), ne(agents.virtual, true)),
              ),
              or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
              or(isNull(topics.status), not(inArray(topics.status, TOPIC_INBOX_STATUSES))),
            ),
      );

    const documentArm = this.db
      .select({
        description: sql<string | null>`NULL`.as('description'),
        id: documents.id,
        lastAssistantMessage: sql<string | null>`NULL`.as('last_assistant_message'),
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
      })
      .from(documents)
      .where(
        requestedTypes && !requestedTypes.has('document')
          ? sql`false`
          : and(
              buildWorkspaceWhere(scope, documents),
              not(inArray(documents.sourceType, TOOL_DOCUMENT_SOURCE_TYPES)),
              isNull(documents.knowledgeBaseId),
              ne(documents.fileType, DOCUMENT_FOLDER_TYPE),
            ),
      );

    const taskArm = this.db
      .select({
        description: sql<string | null>`NULL`.as('description'),
        id: tasks.id,
        lastAssistantMessage: sql<string | null>`NULL`.as('last_assistant_message'),
        metadata: sql<any>`NULL`.as('metadata'),
        routeGroupId: sql<string | null>`NULL`.as('route_group_id'),
        routeId: sql<string | null>`${tasks.assigneeAgentId}`.as('route_id'),
        status: sql<TaskStatus | null>`${tasks.status}`.as('status'),
        title: sql<string>`COALESCE(${tasks.name}, ${tasks.instruction}, 'Untitled Task')`.as(
          'title',
        ),
        type: sql<RecentDbItem['type']>`'task'`.as('type'),
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(
        requestedTypes && !requestedTypes.has('task')
          ? sql`false`
          : and(taskScopeWhere, not(inArray(tasks.status, TASK_FINAL_STATUSES))),
      );

    const rows = await unionAll(topicArm, documentArm, taskArm)
      .orderBy(desc(sql`updated_at`))
      .limit(limit);

    return rows.map((row) => ({
      description: row.description,
      id: row.id,
      lastAssistantMessage:
        row.lastAssistantMessage && row.lastAssistantMessage.length > LAST_MESSAGE_PREVIEW_LENGTH
          ? `${row.lastAssistantMessage.slice(0, LAST_MESSAGE_PREVIEW_LENGTH)}…`
          : row.lastAssistantMessage,
      metadata: row.metadata ?? undefined,
      routeGroupId: row.routeGroupId,
      routeId: row.routeId,
      status: row.status,
      title: row.title,
      type: row.type,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt as any),
    }));
  };
}
