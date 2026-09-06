import { LIBRARY_HIDDEN_FILE_SOURCES } from '@lobechat/types';
import type { SQLWrapper } from 'drizzle-orm';
import { and, desc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';

import {
  agents,
  chatGroups,
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  messages,
  topics,
} from '../../../schemas';
import { normalizeInboxAgentMeta, normalizeInboxAgentTitle } from '../../../utils/inboxAgent';
import { notShareVisitorMessage, notShareVisitorTopic } from '../../../utils/shareVisitor';
import { buildWorkspaceWhere } from '../../../utils/workspace';
import type {
  FtsSearchAgentResult,
  FtsSearchBackendResponse,
  FtsSearchChatGroupResult,
  FtsSearchFileResult,
  FtsSearchKnowledgeBaseResult,
  FtsSearchMessageResult,
  FtsSearchTopicResult,
} from '../types';
import type { PgFtsSearchField } from './dialect';
import { buildResponse, buildSelectedResponse, mapScoresToRelevance, truncate } from './results';
import type { PgSearchFtsSearchContext } from './scope';
import { AGENT_SCOPE_CANDIDATE_POOL } from './scope';

/** Topics and messages are displayed by recency after a larger scored candidate pool is fetched. */
const RECENCY_CANDIDATE_MULTIPLIER = 4;

/**
 * Searchable fields per table. Field order is part of the emitted BM25 SQL, and
 * the weights mirror the Elasticsearch boosts so synthesized scores rank alike.
 */
const AGENT_FIELDS: PgFtsSearchField[] = [
  { column: agents.title, weight: 5 },
  { column: agents.description, weight: 2 },
  { column: agents.slug, weight: 4 },
  { column: agents.tags, jsonb: true, weight: 3 },
  { column: agents.systemRole },
];

const TOPIC_FIELDS: PgFtsSearchField[] = [
  { column: topics.title, weight: 2 },
  { column: topics.content },
  { column: topics.description },
];

const MESSAGE_FIELDS: PgFtsSearchField[] = [{ column: messages.content }];

const FILE_FIELDS: PgFtsSearchField[] = [{ column: files.name, weight: 4 }];

const CHAT_GROUP_FIELDS: PgFtsSearchField[] = [
  { column: chatGroups.title, weight: 4 },
  { column: chatGroups.description, weight: 2 },
];

const KNOWLEDGE_BASE_FIELDS: PgFtsSearchField[] = [
  { column: knowledgeBases.name, weight: 4 },
  { column: knowledgeBases.description },
];

/** Search agents by title, description, slug, tags, and system role. */
export async function searchAgents(
  context: PgSearchFtsSearchContext,
  query: string,
  limit: number,
): Promise<FtsSearchBackendResponse<FtsSearchAgentResult>> {
  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(query);
  const score = dialect.score(agents.id, AGENT_FIELDS, preparedQuery);

  const hits = db
    .select({
      avatar: agents.avatar,
      backgroundColor: agents.backgroundColor,
      createdAt: agents.createdAt,
      description: agents.description,
      id: agents.id,
      name: agents.name,
      score: score.as('score'),
      slug: agents.slug,
      tags: agents.tags,
      title: agents.title,
      updatedAt: agents.updatedAt,
      workspaceId: agents.workspaceId,
    })
    .from(agents)
    .where(and(context.scanScopeWhere(agents), dialect.match(AGENT_FIELDS, preparedQuery)))
    .orderBy(sql`${score} DESC`)
    .limit(context.scanCandidateLimit(limit))
    .as('agent_hits');

  const rows = await db
    .select({
      avatar: hits.avatar,
      backgroundColor: hits.backgroundColor,
      createdAt: hits.createdAt,
      description: hits.description,
      id: hits.id,
      score: hits.score,
      slug: hits.slug,
      tags: hits.tags,
      title: hits.title,
      updatedAt: hits.updatedAt,
    })
    .from(hits)
    .where(context.liftedScopeWhere(hits.workspaceId))
    .orderBy(desc(hits.score))
    .limit(limit);

  return buildResponse(rows, (row) => {
    const meta = normalizeInboxAgentMeta(
      { avatar: row.avatar, title: row.title },
      { slug: row.slug },
    );

    return {
      avatar: meta.avatar,
      backgroundColor: row.backgroundColor,
      createdAt: row.createdAt,
      description: row.description,
      id: row.id,
      relevance: row.relevance,
      slug: row.slug,
      tags: (row.tags as string[]) || [],
      title: meta.title || '',
      type: 'agent' as const,
      updatedAt: row.updatedAt,
    };
  });
}

/** Search topics by title, content, and description. */
export async function searchTopics(
  context: PgSearchFtsSearchContext,
  query: string,
  limit: number,
  agentId?: string,
): Promise<FtsSearchBackendResponse<FtsSearchTopicResult>> {
  const candidateLimit = limit * RECENCY_CANDIDATE_MULTIPLIER;
  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(query);
  const score = dialect.score(topics.id, TOPIC_FIELDS, preparedQuery);

  const hits = db
    .select({
      agentId: topics.agentId,
      content: topics.content,
      createdAt: topics.createdAt,
      favorite: topics.favorite,
      groupId: topics.groupId,
      id: topics.id,
      score: score.as('score'),
      sessionId: topics.sessionId,
      title: topics.title,
      updatedAt: topics.updatedAt,
      workspaceId: topics.workspaceId,
    })
    .from(topics)
    .where(
      and(
        context.scanScopeWhere(topics),
        // Agent-share visitor topics are stored under the creator's userId, so
        // the scope predicate alone would surface a visitor's conversation in
        // the creator's command-menu search.
        notShareVisitorTopic(),
        agentId && !context.liftsAgentFilter ? eq(topics.agentId, agentId) : undefined,
        dialect.match(TOPIC_FIELDS, preparedQuery),
      ),
    )
    .orderBy(sql`${score} DESC`)
    // `agent_id` is not a BM25 field, so when score ordering is valid its
    // filter lives above the scan and the pool deepens to compensate.
    .limit(
      agentId && context.liftsAgentFilter
        ? AGENT_SCOPE_CANDIDATE_POOL
        : context.scanCandidateLimit(candidateLimit),
    )
    .as('topic_hits');

  const rows = await db
    .select({
      // A matching agent row is a visibility sentinel. Foreign agent metadata
      // must never leak into the topic result.
      agentAvatar: agents.avatar,
      agentBackgroundColor: agents.backgroundColor,
      agentId: hits.agentId,
      agentMatchedId: agents.id,
      agentName: agents.name,
      agentSlug: agents.slug,
      agentTitle: agents.title,
      content: hits.content,
      createdAt: hits.createdAt,
      favorite: hits.favorite,
      groupId: hits.groupId,
      id: hits.id,
      score: hits.score,
      sessionId: hits.sessionId,
      title: hits.title,
      updatedAt: hits.updatedAt,
    })
    .from(hits)
    .leftJoin(agents, and(eq(hits.agentId, agents.id), buildWorkspaceWhere(context.scope, agents)))
    .where(
      and(
        context.liftedScopeWhere(hits.workspaceId),
        agentId ? eq(hits.agentId, agentId) : undefined,
      ),
    )
    .orderBy(desc(hits.score))
    .limit(candidateLimit);

  const scoredRows = mapScoresToRelevance(rows);
  const sortedRows = [...scoredRows]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);

  return buildSelectedResponse(scoredRows, sortedRows, (row) => ({
    agent: row.agentMatchedId
      ? {
          avatar: normalizeInboxAgentMeta(
            { avatar: row.agentAvatar, title: row.agentTitle },
            { slug: row.agentSlug },
          ).avatar,
          backgroundColor: row.agentBackgroundColor,
          title: normalizeInboxAgentTitle(row.agentTitle, {
            slug: row.agentSlug,
          }),
        }
      : null,
    agentId: row.agentId,
    createdAt: row.createdAt,
    description: truncate(row.content),
    favorite: row.favorite,
    groupId: row.groupId,
    id: row.id,
    relevance: row.relevance,
    sessionId: row.sessionId,
    title: row.title || '',
    type: 'topic' as const,
    updatedAt: row.updatedAt,
  }));
}

/** Search messages by content. */
export async function searchMessages(
  context: PgSearchFtsSearchContext,
  query: string,
  limit: number,
  agentId?: string,
): Promise<FtsSearchBackendResponse<FtsSearchMessageResult>> {
  const candidateLimit = limit * RECENCY_CANDIDATE_MULTIPLIER;
  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(query);
  const score = dialect.score(messages.id, MESSAGE_FIELDS, preparedQuery);

  const hits = db
    .select({
      agentId: messages.agentId,
      content: messages.content,
      createdAt: messages.createdAt,
      groupId: messages.groupId,
      id: messages.id,
      model: messages.model,
      role: messages.role,
      score: score.as('score'),
      topicId: messages.topicId,
      updatedAt: messages.updatedAt,
      workspaceId: messages.workspaceId,
    })
    .from(messages)
    .where(
      and(
        context.scanScopeWhere(messages),
        ne(messages.role, 'tool'),
        // Twin of the topics guard: visitor messages inherit the creator's
        // userId and are only identifiable through their parent topic.
        notShareVisitorMessage(),
        agentId && !context.liftsAgentFilter ? eq(messages.agentId, agentId) : undefined,
        dialect.match(MESSAGE_FIELDS, preparedQuery),
      ),
    )
    .orderBy(sql`${score} DESC`)
    // `agent_id` is not a BM25 field, so when score ordering is valid its
    // filter lives above the scan and the pool deepens to compensate.
    .limit(
      agentId && context.liftsAgentFilter
        ? AGENT_SCOPE_CANDIDATE_POOL
        : context.scanCandidateLimit(candidateLimit),
    )
    .as('message_hits');

  const rows = await db
    .select({
      agentId: hits.agentId,
      agentName: agents.name,
      agentSlug: agents.slug,
      agentTitle: agents.title,
      content: hits.content,
      createdAt: hits.createdAt,
      groupId: hits.groupId,
      id: hits.id,
      model: hits.model,
      role: hits.role,
      score: hits.score,
      topicId: hits.topicId,
      updatedAt: hits.updatedAt,
    })
    .from(hits)
    .leftJoin(agents, eq(hits.agentId, agents.id))
    .where(
      and(
        context.liftedScopeWhere(hits.workspaceId),
        agentId ? eq(hits.agentId, agentId) : undefined,
      ),
    )
    .orderBy(desc(hits.score))
    .limit(candidateLimit);

  const scoredRows = mapScoresToRelevance(rows);
  const sortedRows = [...scoredRows]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);

  return buildSelectedResponse(scoredRows, sortedRows, (row) => ({
    agentId: row.agentId,
    content: row.content || '',
    createdAt: row.createdAt,
    description:
      normalizeInboxAgentTitle(row.agentTitle, {
        slug: row.agentSlug,
      }) || 'General Chat',
    groupId: row.groupId,
    id: row.id,
    model: row.model,
    relevance: row.relevance,
    role: row.role,
    title: truncate(row.content) || '',
    topicId: row.topicId,
    type: 'message' as const,
    updatedAt: row.updatedAt,
  }));
}

/** Search files by name. */
export async function searchFiles(
  context: PgSearchFtsSearchContext,
  query: string,
  limit: number,
  excludeKbIds?: string[],
): Promise<FtsSearchBackendResponse<FtsSearchFileResult>> {
  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(query);
  const score = dialect.score(files.id, FILE_FIELDS, preparedQuery);
  // A file linked to any restricted KB is fully hidden. The subquery avoids
  // leaking it through a different joined membership row.
  const excludeKb = (fileId: SQLWrapper) =>
    excludeKbIds && excludeKbIds.length > 0
      ? notInArray(
          fileId,
          db
            .select({ fileId: knowledgeBaseFiles.fileId })
            .from(knowledgeBaseFiles)
            .where(inArray(knowledgeBaseFiles.knowledgeBaseId, excludeKbIds)),
        )
      : undefined;

  const hits = db
    .select({
      createdAt: files.createdAt,
      fileType: files.fileType,
      id: files.id,
      name: files.name,
      score: score.as('score'),
      size: files.size,
      updatedAt: files.updatedAt,
      url: files.url,
      workspaceId: files.workspaceId,
    })
    .from(files)
    .where(
      and(
        context.scanScopeWhere(files),
        ne(files.fileType, 'custom/document'),
        // Hidden acceptance evidence must stay out of library search too.
        or(isNull(files.source), notInArray(files.source, LIBRARY_HIDDEN_FILE_SOURCES)),
        context.liftsExclusionFilter ? undefined : excludeKb(files.id),
        dialect.match(FILE_FIELDS, preparedQuery),
      ),
    )
    .orderBy(sql`${score} DESC`)
    .limit(context.scanCandidateLimit(limit))
    .as('file_hits');

  const rows = await db
    .select({
      content: documents.content,
      createdAt: hits.createdAt,
      fileType: hits.fileType,
      id: hits.id,
      knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
      name: hits.name,
      score: hits.score,
      size: hits.size,
      updatedAt: hits.updatedAt,
      url: hits.url,
    })
    .from(hits)
    .leftJoin(documents, eq(hits.id, documents.fileId))
    .leftJoin(knowledgeBaseFiles, eq(hits.id, knowledgeBaseFiles.fileId))
    .where(
      and(
        context.liftedScopeWhere(hits.workspaceId),
        context.liftsExclusionFilter ? excludeKb(hits.id) : undefined,
      ),
    )
    .orderBy(desc(hits.score))
    .limit(limit);

  return buildResponse(rows, (row) => ({
    createdAt: row.createdAt,
    description: truncate(row.content),
    fileType: row.fileType,
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    name: row.name,
    relevance: row.relevance,
    size: row.size,
    title: row.name,
    type: 'file' as const,
    updatedAt: row.updatedAt,
    url: row.url,
  }));
}

/** Search chat groups by title and description. */
export async function searchChatGroups(
  context: PgSearchFtsSearchContext,
  query: string,
  limit: number,
): Promise<FtsSearchBackendResponse<FtsSearchChatGroupResult>> {
  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(query);
  const score = dialect.score(chatGroups.id, CHAT_GROUP_FIELDS, preparedQuery);

  const hits = db
    .select({
      avatar: chatGroups.avatar,
      backgroundColor: chatGroups.backgroundColor,
      createdAt: chatGroups.createdAt,
      description: chatGroups.description,
      id: chatGroups.id,
      score: score.as('score'),
      title: chatGroups.title,
      updatedAt: chatGroups.updatedAt,
      workspaceId: chatGroups.workspaceId,
    })
    .from(chatGroups)
    .where(and(context.scanScopeWhere(chatGroups), dialect.match(CHAT_GROUP_FIELDS, preparedQuery)))
    .orderBy(sql`${score} DESC`)
    .limit(context.scanCandidateLimit(limit))
    .as('chat_group_hits');

  const rows = await db
    .select({
      avatar: hits.avatar,
      backgroundColor: hits.backgroundColor,
      createdAt: hits.createdAt,
      description: hits.description,
      id: hits.id,
      score: hits.score,
      title: hits.title,
      updatedAt: hits.updatedAt,
    })
    .from(hits)
    .where(context.liftedScopeWhere(hits.workspaceId))
    .orderBy(desc(hits.score))
    .limit(limit);

  return buildResponse(rows, (row) => ({
    avatar: row.avatar,
    backgroundColor: row.backgroundColor,
    createdAt: row.createdAt,
    description: row.description,
    id: row.id,
    relevance: row.relevance,
    title: row.title || '',
    type: 'chatGroup' as const,
    updatedAt: row.updatedAt,
  }));
}

/** Search knowledge bases by name and description. */
export async function searchKnowledgeBases(
  context: PgSearchFtsSearchContext,
  query: string,
  limit: number,
  excludeIds?: string[],
): Promise<FtsSearchBackendResponse<FtsSearchKnowledgeBaseResult>> {
  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(query);
  const score = dialect.score(knowledgeBases.id, KNOWLEDGE_BASE_FIELDS, preparedQuery);
  const excludeIdsWhere = (id: SQLWrapper) =>
    excludeIds && excludeIds.length > 0 ? notInArray(id, excludeIds) : undefined;

  const hits = db
    .select({
      avatar: knowledgeBases.avatar,
      createdAt: knowledgeBases.createdAt,
      description: knowledgeBases.description,
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      score: score.as('score'),
      updatedAt: knowledgeBases.updatedAt,
      workspaceId: knowledgeBases.workspaceId,
    })
    .from(knowledgeBases)
    .where(
      and(
        context.scanScopeWhere(knowledgeBases),
        context.liftsExclusionFilter ? undefined : excludeIdsWhere(knowledgeBases.id),
        dialect.match(KNOWLEDGE_BASE_FIELDS, preparedQuery),
      ),
    )
    .orderBy(sql`${score} DESC`)
    .limit(context.scanCandidateLimit(limit))
    .as('knowledge_base_hits');

  const rows = await db
    .select({
      avatar: hits.avatar,
      createdAt: hits.createdAt,
      description: hits.description,
      id: hits.id,
      name: hits.name,
      score: hits.score,
      updatedAt: hits.updatedAt,
    })
    .from(hits)
    .where(
      and(
        context.liftedScopeWhere(hits.workspaceId),
        // ParadeDB keeps excluded knowledge bases out of the inner scored scan so
        // TopN ranking remains intact; restricted rows only consume pool slots.
        context.liftsExclusionFilter ? excludeIdsWhere(hits.id) : undefined,
      ),
    )
    .orderBy(desc(hits.score))
    .limit(limit);

  return buildResponse(rows, (row) => ({
    avatar: row.avatar,
    createdAt: row.createdAt,
    description: row.description,
    id: row.id,
    relevance: row.relevance,
    title: row.name,
    type: 'knowledgeBase' as const,
    updatedAt: row.updatedAt,
  }));
}
