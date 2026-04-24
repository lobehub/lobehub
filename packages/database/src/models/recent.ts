import { sql } from 'drizzle-orm';

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

export class RecentModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  queryRecent = async (limit: number = 10): Promise<RecentDbItem[]> => {
    const query = sql`
      SELECT * FROM (
        SELECT
          ${topics.id} as id,
          COALESCE(${topics.title}, 'Untitled Topic') as title,
          'topic' as type,
          ${topics.agentId} as route_id,
          ${topics.groupId} as route_group_id,
          ${topics.updatedAt} as updated_at,
          ${topics.metadata} as metadata
        FROM ${topics}
        LEFT JOIN ${agents} ON ${topics.agentId} = ${agents.id}
        WHERE ${topics.userId} = ${this.userId}
          AND (
            ${topics.groupId} IS NOT NULL
            OR ${agents.slug} = 'inbox'
            OR (${topics.groupId} IS NULL AND ${agents.virtual} != true)
          )

        UNION ALL

        SELECT
          ${documents.id} as id,
          COALESCE(${documents.title}, ${documents.filename}, 'Untitled Document') as title,
          'document' as type,
          NULL as route_id,
          NULL as route_group_id,
          ${documents.updatedAt} as updated_at,
          NULL as metadata
        FROM ${documents}
        WHERE ${documents.userId} = ${this.userId}
          AND ${documents.sourceType} != 'file'
          AND ${documents.knowledgeBaseId} IS NULL
          AND ${documents.fileType} != ${DOCUMENT_FOLDER_TYPE}

        UNION ALL

        SELECT
          ${tasks.id} as id,
          COALESCE(${tasks.name}, ${tasks.instruction}, 'Untitled Task') as title,
          'task' as type,
          ${tasks.assigneeAgentId} as route_id,
          NULL as route_group_id,
          ${tasks.updatedAt} as updated_at,
          NULL as metadata
        FROM ${tasks}
        WHERE ${tasks.createdByUserId} = ${this.userId}
          AND ${tasks.status} NOT IN ('completed', 'canceled')
      ) AS combined
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;

    const result = await this.db.execute(query);

    return result.rows.map((row: any) => ({
      id: row.id,
      metadata: row.metadata ?? undefined,
      routeGroupId: row.route_group_id,
      routeId: row.route_id,
      title: row.title,
      type: row.type as RecentDbItem['type'],
      updatedAt: new Date(row.updated_at),
    }));
  };
}
