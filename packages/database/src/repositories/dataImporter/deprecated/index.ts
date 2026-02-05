import type { ImporterEntryData } from '@lobechat/types';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { sanitizeUTF8 } from '@/utils/sanitizeUTF8';

import {
  agents,
  agentsToSessions,
  messagePlugins,
  messages,
  messageTranslates,
  sessionGroups,
  sessions,
  topics,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';

interface ImportResult {
  added: number;
  errors: number;
  skips: number;
  updated?: number;
}

export class DeprecatedDataImporterRepos {
  private userId: string;
  private db: LobeChatDatabase;

  /**
   * The version of the importer that this module supports
   */
  supportVersion = 7;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  importData = async (data: ImporterEntryData) => {
    if (data.version > this.supportVersion) throw new Error('Unsupported version');

    const sessionGroupResult: ImportResult = { added: 0, errors: 0, skips: 0 };
    const sessionResult: ImportResult = { added: 0, errors: 0, skips: 0 };
    const topicResult: ImportResult = { added: 0, errors: 0, skips: 0 };
    const messageResult: ImportResult = { added: 0, errors: 0, skips: 0 };

    let sessionGroupIdMap: Record<string, string> = {};
    let sessionIdMap: Record<string, string> = {};
    let topicIdMap: Record<string, string> = {};

    await this.db.transaction(async (trx) => {
      // import sessionGroups
      if (data.sessionGroups && data.sessionGroups.length > 0) {
        const query = await trx.query.sessionGroups.findMany({
          where: and(
            eq(sessionGroups.userId, this.userId),
            inArray(
              sessionGroups.clientId,
              data.sessionGroups.map(({ id }) => id),
            ),
          ),
        });

        sessionGroupResult.skips = query.length;

        const mapArray = await trx
          .insert(sessionGroups)
          .values(
            data.sessionGroups.map(({ id, createdAt, updatedAt, ...res }) => ({
              ...res,
              clientId: id,
              createdAt: new Date(createdAt),
              updatedAt: new Date(updatedAt),
              userId: this.userId,
            })),
          )
          .onConflictDoUpdate({
            set: { updatedAt: new Date() },
            target: [sessionGroups.clientId, sessionGroups.userId],
          })
          .returning({ clientId: sessionGroups.clientId, id: sessionGroups.id });

        sessionGroupResult.added = mapArray.length - query.length;

        sessionGroupIdMap = Object.fromEntries(mapArray.map(({ clientId, id }) => [clientId, id]));
      }

      // import sessions
      if (data.sessions && data.sessions.length > 0) {
        const query = await trx.query.sessions.findMany({
          where: and(
            eq(sessions.userId, this.userId),
            inArray(
              sessions.clientId,
              data.sessions.map(({ id }) => id),
            ),
          ),
        });

        sessionResult.skips = query.length;

        const mapArray = await trx
          .insert(sessions)
          .values(
            data.sessions.map(({ id, createdAt, updatedAt, group, ...res }) => ({
              ...res,
              clientId: id,
              createdAt: new Date(createdAt),
              groupId: group ? sessionGroupIdMap[group] : null,
              updatedAt: new Date(updatedAt),
              userId: this.userId,
            })),
          )
          .onConflictDoUpdate({
            set: { updatedAt: new Date() },
            target: [sessions.clientId, sessions.userId],
          })
          .returning({ clientId: sessions.clientId, id: sessions.id });

        // get the session client-server id map
        sessionIdMap = Object.fromEntries(mapArray.map(({ clientId, id }) => [clientId, id]));

        // update added count
        sessionResult.added = mapArray.length - query.length;

        const shouldInsertSessionAgents = data.sessions
          // filter out existing session, only insert new ones
          .filter((s) => query.every((q) => q.clientId !== s.id));

        // Only insert agent when new sessions are needed
        if (shouldInsertSessionAgents.length > 0) {
          const agentMapArray = await trx
            .insert(agents)
            .values(
              shouldInsertSessionAgents.map(({ config, meta }) => ({
                ...config,
                ...meta,
                userId: this.userId,
              })),
            )
            .returning({ id: agents.id });

          await trx.insert(agentsToSessions).values(
            shouldInsertSessionAgents.map(({ id }, index) => ({
              agentId: agentMapArray[index].id,
              sessionId: sessionIdMap[id],
              userId: this.userId,
            })),
          );
        }
      }

      // import topics
      if (data.topics && data.topics.length > 0) {
        const skipQuery = await trx.query.topics.findMany({
          where: and(
            eq(topics.userId, this.userId),
            inArray(
              topics.clientId,
              data.topics.map(({ id }) => id),
            ),
          ),
        });
        topicResult.skips = skipQuery.length;

        const mapArray = await trx
          .insert(topics)
          .values(
            data.topics.map(({ id, createdAt, updatedAt, sessionId, favorite, ...res }) => ({
              ...res,
              clientId: id,
              createdAt: new Date(createdAt),
              favorite: Boolean(favorite),
              sessionId: sessionId ? sessionIdMap[sessionId] : null,
              updatedAt: new Date(updatedAt),
              userId: this.userId,
            })),
          )
          .onConflictDoUpdate({
            set: { updatedAt: new Date() },
            target: [topics.clientId, topics.userId],
          })
          .returning({ clientId: topics.clientId, id: topics.id });

        topicIdMap = Object.fromEntries(mapArray.map(({ clientId, id }) => [clientId, id]));

        topicResult.added = mapArray.length - skipQuery.length;
      }

      // import messages
      if (data.messages && data.messages.length > 0) {
        // 1. find skip ones
        console.time('find messages');
        const skipQuery = await trx.query.messages.findMany({
          where: and(
            eq(messages.userId, this.userId),
            inArray(
              messages.clientId,
              data.messages.map(({ id }) => id),
            ),
          ),
        });
        console.timeEnd('find messages');

        messageResult.skips = skipQuery.length;

        // filter out existing messages, only insert new ones
        const shouldInsertMessages = data.messages.filter((s) =>
          skipQuery.every((q) => q.clientId !== s.id),
        );

        // 2. insert messages
        if (shouldInsertMessages.length > 0) {
          const inertValues = shouldInsertMessages.map(
            ({ id, extra, createdAt, updatedAt, sessionId, topicId, content, ...res }) => ({
              ...res,
              clientId: id,
              content: sanitizeUTF8(content),
              createdAt: new Date(createdAt),
              model: extra?.fromModel,
              parentId: null,
              provider: extra?.fromProvider,
              sessionId: sessionId ? sessionIdMap[sessionId] : null,
              topicId: topicId ? topicIdMap[topicId] : null, // Temporarily set to NULL
              updatedAt: new Date(updatedAt),
              userId: this.userId,
            }),
          );

          console.time('insert messages');
          const BATCH_SIZE = 100; // Number of records to insert per batch

          for (let i = 0; i < inertValues.length; i += BATCH_SIZE) {
            const batch = inertValues.slice(i, i + BATCH_SIZE);
            await trx.insert(messages).values(batch);
          }

          console.timeEnd('insert messages');

          const messageIdArray = await trx
            .select({ clientId: messages.clientId, id: messages.id })
            .from(messages)
            .where(
              and(
                eq(messages.userId, this.userId),
                inArray(
                  messages.clientId,
                  data.messages.map(({ id }) => id),
                ),
              ),
            );

          const messageIdMap = Object.fromEntries(
            messageIdArray.map(({ clientId, id }) => [clientId, id]),
          );

          // 3. update parentId for messages
          console.time('execute updates parentId');
          const parentIdUpdates = shouldInsertMessages
            .filter((msg) => msg.parentId) // Only process messages with parentId
            .map((msg) => {
              if (messageIdMap[msg.parentId as string])
                return sql`WHEN ${messages.clientId} = ${msg.id} THEN ${messageIdMap[msg.parentId as string]} `;

              return undefined;
            })
            .filter(Boolean);

          if (parentIdUpdates.length > 0) {
            await trx
              .update(messages)
              .set({
                parentId: sql`CASE ${sql.join(parentIdUpdates)} END`,
              })
              .where(
                inArray(
                  messages.clientId,
                  data.messages.map((msg) => msg.id),
                ),
              );

            // if needed, you can print the sql and params
            // const SQL = updateQuery.toSQL();
            // console.log('sql:', SQL.sql);
            // console.log('params:', SQL.params);
          }
          console.timeEnd('execute updates parentId');

          // 4. insert message plugins
          const pluginInserts = shouldInsertMessages.filter((msg) => msg.plugin);
          if (pluginInserts.length > 0) {
            await trx.insert(messagePlugins).values(
              pluginInserts.map((msg) => ({
                apiName: msg.plugin?.apiName,
                arguments: msg.plugin?.arguments,
                id: messageIdMap[msg.id],
                identifier: msg.plugin?.identifier,
                state: msg.pluginState,
                toolCallId: msg.tool_call_id,
                type: msg.plugin?.type,
                userId: this.userId,
              })),
            );
          }

          // 5. insert message translate
          const translateInserts = shouldInsertMessages.filter((msg) => msg.extra?.translate);
          if (translateInserts.length > 0) {
            await trx.insert(messageTranslates).values(
              translateInserts.map((msg) => ({
                id: messageIdMap[msg.id],
                ...msg.extra?.translate,
                userId: this.userId,
              })),
            );
          }

          // TODO: Need to handle TTS and image insertion in the future (currently difficult to handle due to file-related parts)
        }

        messageResult.added = shouldInsertMessages.length;
      }
    });

    return {
      messages: messageResult,
      sessionGroups: sessionGroupResult,
      sessions: sessionResult,
      topics: topicResult,
    };
  };
}
