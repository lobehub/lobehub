import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import pMap from 'p-map';

import * as EXPORT_TABLES from '../../schemas';
import { messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  notShareVisitorMessage,
  notShareVisitorTopic,
  notShareVisitorTopicRef,
} from '../../utils/shareVisitor';
import { buildWorkspaceWhere } from '../../utils/workspace';

/**
 * Agent-share visitor conversations are stored under the CREATOR's `userId`
 * with a non-null `topics.senderId`, so a plain `eq(table.userId, userId)`
 * filter would dump third-party visitor chats into the creator's data export.
 * Each conversation-carrying table therefore declares how it reaches the owning
 * topic:
 *
 * - `topicSender`: the table IS `topics` — filter on `senderId` directly.
 * - `topicRef`: the table references a topic id (messages, threads).
 * - `messageRef`: the table references a message id and has no topic column
 *   (message_plugins / message_translates keyed by `id`, message_chunks keyed
 *   by `messageId`), so the predicate is relayed one extra hop through
 *   `messages`.
 *
 * Tables without any of these (userSettings, userInstalledPlugins, agents,
 * aiModels, aiProviders, sessionGroups, sessions, and the `agentsToSessions`
 * relation) hold creator-authored configuration only — a visitor never creates
 * rows there — so they stay unfiltered and the export shape is unchanged.
 */
type ShareVisitorRef =
  { column?: undefined; via: 'topicSender' } | { column: string; via: 'messageRef' | 'topicRef' };

interface BaseTableConfig {
  /** How this table reaches the topic that decides share-visitor ownership. */
  shareVisitorRef?: ShareVisitorRef;
  table: keyof typeof EXPORT_TABLES;
  type: 'base';
  userField?: string;
}

export interface RelationTableConfig {
  relations: {
    field: string;
    sourceField?: string;
    sourceTable: keyof typeof EXPORT_TABLES;
  }[];
  table: keyof typeof EXPORT_TABLES;
  type: 'relation';
}

export const DATA_EXPORT_CONFIG = {
  baseTables: [
    // { table: 'users', userField: 'id' },
    { table: 'userSettings', userField: 'id' },
    { table: 'userInstalledPlugins' },
    { table: 'agents' },
    // { table: 'agentsFiles' },
    // { table: 'agentsKnowledgeBases' },
    // { table: 'agentsToSessions' },
    { table: 'aiModels' },
    { table: 'aiProviders' },
    // async tasks should not be included
    // { table: 'asyncTasks' },
    // { table: 'chunks' },
    // { table: 'unstructuredChunks' },
    // { table: 'embeddings' },
    // { table: 'files' },
    // { table: 'fileChunks' },
    // { table: 'filesToSessions' },
    // { table: 'knowledgeBases' },
    // { table: 'knowledgeBaseFiles' },
    { shareVisitorRef: { column: 'messageId', via: 'messageRef' }, table: 'messageChunks' },
    { shareVisitorRef: { column: 'id', via: 'messageRef' }, table: 'messagePlugins' },
    // { table: 'messageQueryChunks' },
    // { table: 'messageQueries' },
    { shareVisitorRef: { column: 'id', via: 'messageRef' }, table: 'messageTranslates' },
    // { table: 'messageTTS' },
    { shareVisitorRef: { column: 'topicId', via: 'topicRef' }, table: 'messages' },
    // { table: 'messagesFiles' },

    // next auth tables won't be included
    // { table: 'nextauthAccounts' },
    // { table: 'nextauthSessions' },
    // { table: 'nextauthAuthenticators' },
    // { table: 'nextauthVerificationTokens' },
    { table: 'sessionGroups' },
    { table: 'sessions' },
    { shareVisitorRef: { column: 'topicId', via: 'topicRef' }, table: 'threads' },
    { shareVisitorRef: { via: 'topicSender' }, table: 'topics' },
  ] as BaseTableConfig[],
  relationTables: [
    // {
    //   relations: [{ field: 'hashId', sourceField: 'fileHash', sourceTable: 'files' }],
    //   table: 'globalFiles',
    // },
    {
      relations: [
        { field: 'agentId', sourceField: 'id', sourceTable: 'agents' },
        { field: 'sessionId', sourceField: 'id', sourceTable: 'sessions' },
      ],
      table: 'agentsToSessions',
    },

    // {
    //   relations: [{ field: 'id', sourceField: 'id', sourceTable: 'messages' }],
    //   table: 'messagePlugins',
    // },
  ] as RelationTableConfig[],
};

export class DataExporterRepos {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Builds the share-visitor exclusion for a base table, reusing the shared
   * predicates in `utils/shareVisitor` so the export can never drift from the
   * rest of the creator-facing surfaces.
   */
  private buildShareVisitorCondition(
    ref: ShareVisitorRef,
    tableObj: Record<string, any>,
  ): SQL | undefined {
    if (ref.via === 'topicSender') return notShareVisitorTopic();

    const column = tableObj[ref.column];
    if (!column) return undefined;

    if (ref.via === 'topicRef') return notShareVisitorTopicRef(column);

    // `messageRef`: no topic column here, so keep only rows whose parent
    // message itself survives `notShareVisitorMessage()`. A NULL message
    // reference is trivially kept, matching the shared helpers' semantics.
    return or(
      isNull(column),
      inArray(
        column,
        this.db.select({ id: messages.id }).from(messages).where(notShareVisitorMessage()),
      ),
    );
  }

  private removeUserId(data: any[]) {
    return data.map((item) => {
      const { userId: _, ...rest } = item;
      return rest;
    });
  }

  private async queryTable(config: RelationTableConfig, existingData: Record<string, any[]>) {
    const { table } = config;
    const tableObj = EXPORT_TABLES[table];
    if (!tableObj) throw new Error(`Table ${table} not found`);

    try {
      const conditions = [];

      // Process each relation condition
      for (const relation of config.relations) {
        const sourceData = existingData[relation.sourceTable] || [];

        // If source data is empty, this table may not be able to query any data
        if (sourceData.length === 0) {
          console.info(
            `Source table ${relation.sourceTable} has no data, skipping query for ${table}`,
          );
          return [];
        }

        const sourceIds = sourceData.map((item) => item[relation.sourceField || 'id']);
        conditions.push(inArray(tableObj[relation.field], sourceIds));
      }

      // If table has userId field and is not the users table, add user filter.
      // workspace-audit: this branch only runs for non-relation tables; relation
      // tables (which carry workspace_id) are already constrained by the FK
      // `inArray(sourceIds)` above, where sourceIds come from base tables that ARE
      // workspace-scoped (see queryBaseTables / buildWorkspaceWhere) — so relation
      // rows are transitively workspace-scoped and need no userId/workspaceId filter here.
      if ('userId' in tableObj && table !== 'users' && !config.relations) {
        conditions.push(eq(tableObj.userId, this.userId));
      }

      // Combine all conditions
      const where = conditions.length === 1 ? conditions[0] : and(...conditions);

      // @ts-expect-error query
      const result = await this.db.query[table].findMany({ where });

      // Only remove userId field for tables queried with userId
      console.info(`Successfully exported table: ${table}, count: ${result.length}`);
      return config.relations ? result : this.removeUserId(result);
    } catch (error) {
      console.error(`Error querying table ${table}:`, error);
      return [];
    }
  }

  private async queryBaseTables(config: BaseTableConfig) {
    const { table } = config;
    const tableObj = EXPORT_TABLES[table];
    if (!tableObj) throw new Error(`Table ${table} not found`);

    try {
      if (this.workspaceId && !('workspaceId' in tableObj)) {
        return [];
      }

      // If there's relation config, use relation query

      // Default to querying with userId, use userField for special cases
      const userField = config.userField || 'userId';
      const ownershipWhere =
        'workspaceId' in tableObj
          ? buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, tableObj)
          : eq(tableObj[userField], this.userId);

      const shareVisitorWhere = config.shareVisitorRef
        ? this.buildShareVisitorCondition(config.shareVisitorRef, tableObj)
        : undefined;

      const where = shareVisitorWhere ? and(ownershipWhere, shareVisitorWhere) : ownershipWhere;

      // Plain select builder instead of `db.query...findMany` whenever a
      // share-visitor predicate is involved: the relational query API
      // re-qualifies raw SQL fragments to the outer table alias, which breaks
      // the `topics`-referencing NOT EXISTS inside the shared helpers (same
      // caveat as `MessageModel.queryBySessionId`).
      const result = shareVisitorWhere
        ? await this.db.select().from(tableObj).where(where)
        : // @ts-expect-error query
          await this.db.query[table].findMany({ where });

      // Only remove userId field for tables queried with userId
      console.info(`Successfully exported table: ${table}, count: ${result.length}`);
      return this.removeUserId(result);
    } catch (error) {
      console.error(`Error querying table ${table}:`, error);
      return [];
    }
  }

  async export(concurrency = 10) {
    const result: Record<string, any[]> = {};

    // 1. First query all base tables concurrently
    console.info('Querying base tables...');
    const baseResults = await pMap(
      DATA_EXPORT_CONFIG.baseTables,
      async (config) => ({ data: await this.queryBaseTables(config), table: config.table }),
      { concurrency },
    );

    // Update result set
    baseResults.forEach(({ table, data }) => {
      result[table] = data;
    });

    // 2. Then query all relation tables concurrently

    const relationResults = await pMap(
      DATA_EXPORT_CONFIG.relationTables,
      async (config) => {
        // Check if all dependent source tables have data
        const allSourcesHaveData = config.relations.every(
          (relation) => (result[relation.sourceTable] || []).length > 0,
        );

        if (!allSourcesHaveData) {
          console.info(`Skipping table ${config.table} as some source tables have no data`);
          return { data: [], table: config.table };
        }

        return {
          data: await this.queryTable(config, result),
          table: config.table,
        };
      },
      { concurrency },
    );

    // Update result set
    relationResults.forEach(({ table, data }) => {
      result[table] = data;
    });

    return result;
  }
}
