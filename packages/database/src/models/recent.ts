import { and, desc, eq, inArray, isNotNull, isNull, ne, not, or, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';

import { agents, DOCUMENT_FOLDER_TYPE, documents, tasks, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';

export interface RecentDbItem {
  id: string;
  metadata?: any;
  routeGroupId: string | null;
  routeId: string | null;
  title: string;
  type: 'topic' | 'document' | 'task';
  updatedAt: Date;
}

// Mirrors `MAIN_SIDEBAR_EXCLUDE_TRIGGERS` in `src/const/topic.ts` plus the
// legacy `task_manager` trigger from the previous Task Manager panel.
// System-trigger topics live in their own surfaces and would clutter Recent.
const SYSTEM_TOPIC_TRIGGERS = ['cron', 'eval', 'task_manager', 'task'];

// Excluded so file uploads and web-browsing tool scrapes don't surface as
// "recent docs"; only user-authored pages ('api') and legacy 'topic' rows remain.
const TOOL_DOCUMENT_SOURCE_TYPES = ['file', 'web'] as const;

const TASK_FINAL_STATUSES = ['completed', 'canceled'];

export class RecentModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  queryRecent = async (limit: number = 10): Promise<RecentDbItem[]> => {
    const topicArm = this.db
      .select({
        id: topics.id,
        metadata: sql<any>`${topics.metadata}`.as('metadata'),
        routeGroupId: sql<string | null>`${topics.groupId}`.as('route_group_id'),
        routeId: sql<string | null>`${topics.agentId}`.as('route_id'),
        title: sql<string>`COALESCE(${topics.title}, 'Untitled Topic')`.as('title'),
        type: sql<RecentDbItem['type']>`'topic'`.as('type'),
        updatedAt: topics.updatedAt,
      })
      .from(topics)
      .leftJoin(agents, eq(topics.agentId, agents.id))
      .where(
        and(
          eq(topics.userId, this.userId),
          or(
            isNotNull(topics.groupId),
            eq(agents.slug, 'inbox'),
            and(isNull(topics.groupId), ne(agents.virtual, true)),
          ),
          or(isNull(topics.trigger), not(inArray(topics.trigger, SYSTEM_TOPIC_TRIGGERS))),
        ),
      );

    const documentArm = this.db
      .select({
        id: documents.id,
        metadata: sql<any>`NULL`.as('metadata'),
        routeGroupId: sql<string | null>`NULL`.as('route_group_id'),
        routeId: sql<string | null>`NULL`.as('route_id'),
        title:
          sql<string>`COALESCE(${documents.title}, ${documents.filename}, 'Untitled Document')`.as(
            'title',
          ),
        type: sql<RecentDbItem['type']>`'document'`.as('type'),
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.userId, this.userId),
          not(inArray(documents.sourceType, TOOL_DOCUMENT_SOURCE_TYPES)),
          isNull(documents.knowledgeBaseId),
          ne(documents.fileType, DOCUMENT_FOLDER_TYPE),
        ),
      );

    const taskArm = this.db
      .select({
        id: tasks.id,
        metadata: sql<any>`NULL`.as('metadata'),
        routeGroupId: sql<string | null>`NULL`.as('route_group_id'),
        routeId: sql<string | null>`${tasks.assigneeAgentId}`.as('route_id'),
        title: sql<string>`COALESCE(${tasks.name}, ${tasks.instruction}, 'Untitled Task')`.as(
          'title',
        ),
        type: sql<RecentDbItem['type']>`'task'`.as('type'),
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.createdByUserId, this.userId),
          not(inArray(tasks.status, TASK_FINAL_STATUSES)),
        ),
      );

    const rows = await unionAll(topicArm, documentArm, taskArm)
      .orderBy(desc(sql`updated_at`))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      metadata: row.metadata ?? undefined,
      routeGroupId: row.routeGroupId,
      routeId: row.routeId,
      title: row.title,
      type: row.type,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt as any),
    }));
  };
}
