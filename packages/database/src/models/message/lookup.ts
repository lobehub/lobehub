import { TOPIC_MESSAGE_SEARCH_LIMIT } from '@lobechat/const';
import type { DBMessageItem, IThreadType, TopicMessageSearchMatch } from '@lobechat/types';
import { ThreadType } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, inArray, isNull, lte, ne, not, or, sql } from 'drizzle-orm';

import {
  agentsToSessions,
  embeddings,
  messageQueries,
  messages,
  threads,
  topics,
} from '../../schemas';
import { sanitizeBm25Query } from '../../utils/bm25';
import { inJsonStringArray } from '../../utils/inJsonStringArray';
import { ilikeContains } from '../../utils/like';
import { searchableMessage } from '../../utils/searchableMessage';
import { notShareVisitorMessage } from '../../utils/shareVisitor';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { nonNull } from '../utils/rows';
import { MessageScope } from './scope';
import { buildMessageSearchSnippet } from './searchSnippet';

export class MessageLookupQueries extends MessageScope {
  /**
   * Build where condition for thread queries
   *
   * Returns a condition that matches both parent messages and thread messages.
   */
  buildThreadQueryCondition = async (threadId: string): Promise<SQL | undefined> => {
    // Fetch the thread info to get sourceMessageId and type
    const thread = await this.db.query.threads.findFirst({
      where: and(
        eq(threads.id, threadId),
        buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
      ),
    });

    if (!thread?.sourceMessageId || !thread?.topicId) {
      // Fallback to simple thread query if no source message
      return eq(messages.threadId, threadId);
    }

    // Get parent messages based on thread type
    const parentMessages = await this.getThreadParentMessages({
      sourceMessageId: thread.sourceMessageId,
      threadType: thread.type as IThreadType,
      topicId: thread.topicId,
    });

    const parentMessageIds = parentMessages.map((m) => m.id);

    if (parentMessageIds.length === 0) {
      return eq(messages.threadId, threadId);
    }

    // Match either thread messages or parent messages
    return or(eq(messages.threadId, threadId), inArray(messages.id, parentMessageIds));
  };

  /**
   * Build agent condition with legacy sessionId support
   */
  buildAgentCondition = async (agentId: string): Promise<SQL | undefined> => {
    // Get the associated sessionId for backward compatibility with legacy data
    const agentSession = await this.db
      .select({ sessionId: agentsToSessions.sessionId })
      .from(agentsToSessions)
      .where(and(eq(agentsToSessions.agentId, agentId), this.agentsToSessionsOwnership()))
      .limit(1);

    const associatedSessionId = agentSession[0]?.sessionId;

    // Build condition to match both new (agentId) and legacy (sessionId) data
    const agentCondition = associatedSessionId
      ? or(eq(messages.agentId, agentId), eq(messages.sessionId, associatedSessionId))
      : eq(messages.agentId, agentId);
    return or(agentCondition, this.matchLegacyInbox(agentId));
  };

  findById = async (id: string) => {
    return this.db.query.messages.findFirst({
      where: and(eq(messages.id, id), this.ownership()),
    });
  };

  /**
   * Ids among `ids` that resolve to an agent-share VISITOR message under this
   * owner — the inverse of the `notShareVisitorMessage()` predicate every
   * creator-facing read applies.
   *
   * Creator-facing write entry points use this to reject visitor targets
   * (see `assertCreatorMessageTargets` in the server router helpers). Ids that
   * match no row at all are NOT reported, so callers keep their existing no-op
   * behaviour for stale/foreign ids and only fail on rows that really belong to
   * a visitor's conversation.
   */
  findShareVisitorMessageIds = async (ids: string[]): Promise<string[]> => {
    if (ids.length === 0) return [];

    const rows = await this.db
      .select({ id: messages.id })
      .from(messages)
      // Explicitly scoped visitor-inclusive: this method's whole job is to
      // return visitor ids so the router-level `assertCreatorMessageTargets`
      // can reject them, so bypass the instance's visitor exclusion.
      .where(and(inArray(messages.id, ids), this.workspaceScope(), not(notShareVisitorMessage())));

    return rows.map((row) => row.id);
  };

  findByClientId = async (clientId: string) => {
    return this.db.query.messages.findFirst({
      where: and(eq(messages.clientId, clientId), this.ownership()),
    });
  };

  findLatestAssistantMessageByThread = async ({
    agentId,
    threadId,
    topicId,
  }: {
    agentId: string;
    threadId: string;
    topicId: string;
  }) =>
    this.db.query.messages.findFirst({
      orderBy: [desc(messages.createdAt), desc(messages.id)],
      where: and(
        this.ownership(),
        eq(messages.agentId, agentId),
        inArray(
          messages.topicId,
          this.db
            .select({ id: topics.id })
            .from(topics)
            .where(
              and(
                eq(topics.id, topicId),
                buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
              ),
            ),
        ),
        eq(messages.threadId, threadId),
        eq(messages.role, 'assistant'),
      ),
    });

  /**
   * The agent relay hop (`metadata.agentSender.hop`) of the newest user
   * message in a conversation — the main transcript, or one thread — or
   * undefined when a person wrote it. Read when an agent turn sends to another
   * conversation, to count how many agent → agent sends led to it.
   */
  findLatestUserTurnHop = async ({
    threadId,
    topicId,
  }: {
    threadId?: string;
    topicId: string;
  }): Promise<number | undefined> => {
    const [row] = await this.db
      .select({ hop: sql<null | string>`${messages.metadata}->'agentSender'->>'hop'` })
      .from(messages)
      .where(
        and(
          this.ownership(),
          eq(messages.topicId, topicId),
          threadId ? eq(messages.threadId, threadId) : isNull(messages.threadId),
          eq(messages.role, 'user'),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1);

    const hop = Number(row?.hop);
    return Number.isInteger(hop) && hop > 0 ? hop : undefined;
  };

  /**
   * Resolve the `role='verify'` delivery-checker card for an Agent Run (created
   * with `metadata.verifyOperationId = operationId`). Used by auto-repair to
   * persist the failure feedback onto the card it belongs to.
   */
  findVerifyMessageByOperationId = async (operationId: string) => {
    return this.db.query.messages.findFirst({
      where: and(
        this.ownership(),
        eq(messages.role, 'verify'),
        sql`${messages.metadata}->>'verifyOperationId' = ${operationId}`,
      ),
      orderBy: [desc(messages.createdAt)],
    });
  };

  /**
   * Resolve the newest assistant row an Agent Run produced, by the creation
   * provenance `call_llm` stamps on every assistant row it creates or reuses
   * (`metadata.operationId`). Scoped by `topicId` so the JSONB predicate runs
   * inside the topic's own (indexed) rows rather than across the whole table.
   *
   * Used by the completion lifecycle to recover the run's real final reply
   * when the runtime state no longer carries this run's messages — the
   * topic-wide "latest assistant" would be an earlier turn's reply.
   */
  findLatestAssistantByOperationId = async ({
    operationId,
    topicId,
  }: {
    operationId: string;
    topicId: string;
  }) => {
    return this.db.query.messages.findFirst({
      where: and(
        this.ownership(),
        inArray(
          messages.topicId,
          this.db
            .select({ id: topics.id })
            .from(topics)
            .where(
              and(
                eq(topics.id, topicId),
                buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics),
              ),
            ),
        ),
        eq(messages.role, 'assistant'),
        sql`${messages.metadata}->>'operationId' = ${operationId}`,
      ),
      orderBy: [desc(messages.createdAt)],
    });
  };

  /**
   * The newest assistant replies of a topic's latest turn — every main-thread
   * assistant row written after the main thread's last user message — newest
   * first, content only.
   *
   * Used by the task lifecycle to find a run's final report when the run's very
   * last reply is only a trailing remark. Heterogeneous runs (Claude Code,
   * Codex) carry no `metadata.operationId` on their rows, so the latest user
   * message (the run prompt) is what bounds the run inside its topic.
   * Subagent rows share the topic under their own `threadId`, so both the
   * boundary and the replies are read from the main thread only.
   */
  listLatestTurnAssistantContents = async ({
    limit,
    topicId,
  }: {
    limit: number;
    topicId: string;
  }): Promise<{ content: string | null; createdAt: Date }[]> => {
    const lastUserAt = this.db
      .select({ createdAt: sql`max(${messages.createdAt})` })
      .from(messages)
      .where(
        and(
          this.ownership(),
          eq(messages.topicId, topicId),
          isNull(messages.threadId),
          eq(messages.role, 'user'),
        ),
      );

    return this.db
      .select({ content: messages.content, createdAt: messages.createdAt })
      .from(messages)
      .where(
        and(
          this.ownership(),
          inArray(
            messages.topicId,
            this.db
              .select({ id: topics.id })
              .from(topics)
              .where(
                and(
                  eq(topics.id, topicId),
                  buildWorkspaceWhere(
                    { userId: this.userId, workspaceId: this.workspaceId },
                    topics,
                  ),
                ),
              ),
          ),
          isNull(messages.threadId),
          eq(messages.role, 'assistant'),
          sql`${messages.createdAt} >= coalesce((${lastUserAt}), '-infinity'::timestamptz)`,
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit);
  };

  /**
   * Get parent messages for a thread
   *
   * @param params - Parameters for getting parent messages
   * @param params.sourceMessageId - The ID of the source message that started the thread
   * @param params.topicId - The topic ID the thread belongs to
   * @param params.threadType - The type of thread (Continuation, Standalone, or Isolation)
   * @returns Parent messages based on thread type:
   *   - Continuation: All messages from the topic up to and including the source message
   *   - Standalone: Only the source message itself
   *   - Isolation: No parent messages (completely isolated thread)
   */
  getThreadParentMessages = async (params: {
    sourceMessageId: string;
    threadType: IThreadType;
    topicId: string;
  }): Promise<DBMessageItem[]> => {
    const { sourceMessageId, topicId, threadType } = params;

    // For Isolation type, return empty array (no parent messages)
    if (threadType === ThreadType.Isolation) {
      return [];
    }

    // For Standalone type, only return the source message
    if (threadType === ThreadType.Standalone) {
      const sourceMessage = await this.db.query.messages.findFirst({
        where: and(eq(messages.id, sourceMessageId), this.ownership()),
      });

      return sourceMessage ? [sourceMessage as DBMessageItem] : [];
    }

    // For Continuation type, get the source message first to know its createdAt
    const sourceMessage = await this.db.query.messages.findFirst({
      where: and(eq(messages.id, sourceMessageId), this.ownership()),
    });

    if (!sourceMessage) return [];

    // Get all main conversation messages up to and including the source message
    // Use `or` with explicit id match to handle timestamp precision issues
    // (JavaScript Date has millisecond precision, but PostgreSQL timestamptz has microsecond precision)
    const result = await this.db
      .select()
      .from(messages)
      .where(
        and(
          this.ownership(),
          eq(messages.topicId, topicId),
          isNull(messages.threadId), // Only main conversation messages (not in any thread)
          or(
            lte(messages.createdAt, sourceMessage.createdAt),
            eq(messages.id, sourceMessageId), // Ensure source message is always included
          ),
        ),
      )
      .orderBy(asc(messages.createdAt));

    return result as DBMessageItem[];
  };

  findMessageQueriesById = async (messageId: string) => {
    const result = await this.db
      .select({
        embeddings: embeddings.embeddings,
        id: messageQueries.id,
        query: messageQueries.rewriteQuery,
        rewriteQuery: messageQueries.rewriteQuery,
        userQuery: messageQueries.userQuery,
      })
      .from(messageQueries)
      .where(and(eq(messageQueries.messageId, messageId)))
      .leftJoin(embeddings, eq(embeddings.id, messageQueries.embeddingsId));

    if (result.length === 0) return undefined;

    return result[0];
  };

  // Plain select builder instead of `db.query...findMany`: the relational
  // query API re-qualifies raw SQL fragments to the outer table alias, which
  // breaks the `topics`-referencing NOT EXISTS inside `notShareVisitorMessage`.
  queryBySessionId = async (sessionId?: string | null) => {
    const result = await this.db
      .select()
      .from(messages)
      // Visitor messages have no sessionId, so the null-session (inbox) branch
      // would otherwise sweep them in.
      .where(and(this.ownership(), this.matchSession(sessionId), notShareVisitorMessage()))
      .orderBy(asc(messages.createdAt));

    return result as DBMessageItem[];
  };

  /**
   * Literal, case-insensitive find over one topic's mainline (thread rows are
   * left out), oldest first: the order the conversation reads in. Tool results
   * are skipped because the conversation renders them as tool cards, not text.
   */
  searchInTopic = async ({
    keyword,
    limit = TOPIC_MESSAGE_SEARCH_LIMIT,
    topicId,
  }: {
    keyword: string;
    limit?: number;
    topicId: string;
  }): Promise<TopicMessageSearchMatch[]> => {
    const needle = keyword.trim();
    if (!needle) return [];

    const rows = await this.db
      .select({
        content: messages.content,
        createdAt: messages.createdAt,
        id: messages.id,
        role: messages.role,
      })
      .from(messages)
      .where(
        and(
          this.ownership(),
          eq(messages.topicId, topicId),
          isNull(messages.threadId),
          ne(messages.role, 'tool'),
          ilikeContains(messages.content, needle),
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(limit);

    return rows.map(({ content, ...row }) => ({
      ...row,
      // The ILIKE filter on `content` drops NULL rows.
      ...buildMessageSearchSnippet(nonNull(content, 'messages.content'), needle),
    }));
  };

  queryByKeyword = async (keyword: string) => {
    if (!keyword.trim()) return [];

    const bm25Query = sanitizeBm25Query(keyword);
    const candidateResult = this.ftsSearchCandidateSource?.ftsSearchCandidateEnabled
      ? await this.ftsSearchCandidateSource.ftsSearchCandidates({
          entity: 'messages',
          filters: {},
          pagination: {},
          query: { fields: ['content'], text: keyword },
        })
      : undefined;
    const candidateIds = candidateResult?.candidates.map(({ id }) => id);
    const result = await this.db
      .select()
      .from(messages)
      .where(
        and(
          this.ownership(),
          notShareVisitorMessage(),
          searchableMessage(),
          candidateIds
            ? inJsonStringArray(messages.id, candidateIds)
            : sql`${messages.content} @@@ ${bm25Query}`,
        ),
      )
      .orderBy(desc(messages.createdAt));

    return result as DBMessageItem[];
  };
}
