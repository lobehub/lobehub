import { LIBRARY_HIDDEN_FILE_SOURCES } from '@lobechat/types';
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  agents,
  chatGroups,
  DOCUMENT_FOLDER_TYPE,
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  messages,
  sessions,
  topics,
  userMemories,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { normalizeInboxAgentMeta, normalizeInboxAgentTitle } from '../../../utils/inboxAgent';
import { notShareVisitorMessage, notShareVisitorTopic } from '../../../utils/shareVisitor';
import { buildWorkspaceWhere } from '../../../utils/workspace';
import type {
  FtsSearchAgentResult,
  FtsSearchBackendScope,
  FtsSearchChatGroupResult,
  FtsSearchFileResult,
  FtsSearchFolderResult,
  FtsSearchKnowledgeBaseDocumentHit,
  FtsSearchKnowledgeBaseResult,
  FtsSearchMemoryResult,
  FtsSearchMessageResult,
  FtsSearchPageResult,
  FtsSearchTopicResult,
} from '../types';
import type { FtsSearchCandidateHit, FtsSearchHydratedScore } from './types';

const DEFAULT_SNIPPET_MAX_LENGTH = 200;
const FILE_DESCRIPTION_MAX_LENGTH = 200;
const KNOWLEDGE_BASE_DOCUMENT_SNIPPET_MAX_LENGTH = 300;

const truncate = (
  content: string | null | undefined,
  maxLength: number = DEFAULT_SNIPPET_MAX_LENGTH,
) => {
  if (!content) return null;
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength)}...`;
};

/** Select one extra character so truncation preserves exact ellipsis behavior without loading full content. */
const documentContentPreview = (maxLength: number) =>
  sql<string | null>`left(${documents.content}, ${maxLength + 1})`;

const visibleParent = (
  foreignKey: Parameters<typeof isNull>[0],
  id: Parameters<typeof isNotNull>[0],
) => or(isNull(foreignKey), isNotNull(id)) as SQL;

const messageTopicAgents = alias(agents, 'search_message_topic_agents');
const messageTopicChatGroups = alias(chatGroups, 'search_message_topic_chat_groups');
const messageTopicSessions = alias(sessions, 'search_message_topic_sessions');

const attachScores = <T extends { id: string }>(rows: T[], hits: FtsSearchCandidateHit[]) => {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const hydrated = hits.flatMap((hit) => {
    const row = rowById.get(hit.id);
    return row ? [{ ...row, rank: hit.rank, score: hit.score ?? 0 }] : [];
  });
  const maxScore = Math.max(0, ...hydrated.map(({ score }) => score));

  return hydrated.map((row): T & FtsSearchCandidateHit & FtsSearchHydratedScore => ({
    ...row,
    relevance: maxScore > 0 ? 1 + 2 * (1 - row.score / maxScore) : 3,
  }));
};

export const hydrateUserMemories = async (
  db: LobeChatDatabase,
  hits: FtsSearchCandidateHit[],
  scope: FtsSearchBackendScope,
  limit: number,
): Promise<FtsSearchMemoryResult[]> => {
  if (hits.length === 0) return [];

  const rows = await db
    .select({
      createdAt: userMemories.createdAt,
      id: userMemories.id,
      memoryLayer: userMemories.memoryLayer,
      summary: userMemories.summary,
      title: userMemories.title,
      updatedAt: userMemories.updatedAt,
    })
    .from(userMemories)
    .where(
      and(
        inArray(
          userMemories.id,
          hits.map(({ id }) => id),
        ),
        eq(userMemories.userId, scope.userId),
      ),
    );

  return attachScores(rows, hits)
    .slice(0, limit)
    .map((row) => ({
      createdAt: row.createdAt,
      description: truncate(row.summary),
      id: row.id,
      memoryLayer: row.memoryLayer,
      relevance: row.relevance,
      title: row.title || 'Untitled Memory',
      type: 'memory' as const,
      updatedAt: row.updatedAt,
    }));
};

export const hydrateAgents = async (
  db: LobeChatDatabase,
  hits: FtsSearchCandidateHit[],
  scope: FtsSearchBackendScope,
  limit: number,
): Promise<FtsSearchAgentResult[]> => {
  if (hits.length === 0) return [];

  const rows = await db
    .select({
      avatar: agents.avatar,
      backgroundColor: agents.backgroundColor,
      createdAt: agents.createdAt,
      description: agents.description,
      id: agents.id,
      slug: agents.slug,
      tags: agents.tags,
      title: agents.title,
      updatedAt: agents.updatedAt,
    })
    .from(agents)
    .where(
      and(
        inArray(
          agents.id,
          hits.map(({ id }) => id),
        ),
        buildWorkspaceWhere(scope, agents),
      ),
    );

  return attachScores(rows, hits)
    .slice(0, limit)
    .map((row) => {
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
};

export const hydrateChatGroups = async (
  db: LobeChatDatabase,
  hits: FtsSearchCandidateHit[],
  scope: FtsSearchBackendScope,
  limit: number,
): Promise<FtsSearchChatGroupResult[]> => {
  if (hits.length === 0) return [];

  const rows = await db
    .select({
      avatar: chatGroups.avatar,
      backgroundColor: chatGroups.backgroundColor,
      createdAt: chatGroups.createdAt,
      description: chatGroups.description,
      id: chatGroups.id,
      title: chatGroups.title,
      updatedAt: chatGroups.updatedAt,
    })
    .from(chatGroups)
    .where(
      and(
        inArray(
          chatGroups.id,
          hits.map(({ id }) => id),
        ),
        buildWorkspaceWhere(scope, chatGroups),
      ),
    );

  return attachScores(rows, hits)
    .slice(0, limit)
    .map((row) => ({
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
};

export const hydrateTopics = async (
  db: LobeChatDatabase,
  hits: FtsSearchCandidateHit[],
  scope: FtsSearchBackendScope,
  limit: number,
  agentId?: string,
): Promise<FtsSearchTopicResult[]> => {
  if (hits.length === 0) return [];

  const rows = await db
    .select({
      agentAvatar: agents.avatar,
      agentBackgroundColor: agents.backgroundColor,
      agentId: topics.agentId,
      agentMatchedId: agents.id,
      agentSlug: agents.slug,
      agentTitle: agents.title,
      content: topics.content,
      createdAt: topics.createdAt,
      favorite: topics.favorite,
      groupId: topics.groupId,
      groupMatchedId: chatGroups.id,
      id: topics.id,
      sessionId: topics.sessionId,
      sessionMatchedId: sessions.id,
      title: topics.title,
      updatedAt: topics.updatedAt,
    })
    .from(topics)
    .leftJoin(agents, and(eq(topics.agentId, agents.id), buildWorkspaceWhere(scope, agents)))
    .leftJoin(
      chatGroups,
      and(eq(topics.groupId, chatGroups.id), buildWorkspaceWhere(scope, chatGroups)),
    )
    .leftJoin(
      sessions,
      and(eq(topics.sessionId, sessions.id), buildWorkspaceWhere(scope, sessions)),
    )
    .where(
      and(
        inArray(
          topics.id,
          hits.map(({ id }) => id),
        ),
        buildWorkspaceWhere(scope, topics),
        // The ES index carries no `senderId`, but hydration is the only path
        // from a candidate id to real content, so filtering agent-share visitor
        // topics here is enough to keep them out of the creator's results.
        notShareVisitorTopic(),
        agentId ? eq(topics.agentId, agentId) : undefined,
        visibleParent(topics.agentId, agents.id),
        visibleParent(topics.groupId, chatGroups.id),
        visibleParent(topics.sessionId, sessions.id),
      ),
    );

  return attachScores(rows, hits)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, limit)
    .map((row) => ({
      agent: row.agentMatchedId
        ? {
            avatar: normalizeInboxAgentMeta(
              { avatar: row.agentAvatar, title: row.agentTitle },
              { slug: row.agentSlug },
            ).avatar,
            backgroundColor: row.agentBackgroundColor,
            title: normalizeInboxAgentTitle(row.agentTitle, { slug: row.agentSlug }),
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
};

export const hydrateMessages = async (
  db: LobeChatDatabase,
  hits: FtsSearchCandidateHit[],
  scope: FtsSearchBackendScope,
  limit: number,
  agentId?: string,
): Promise<FtsSearchMessageResult[]> => {
  if (hits.length === 0) return [];

  const rows = await db
    .select({
      agentId: messages.agentId,
      agentMatchedId: agents.id,
      agentSlug: agents.slug,
      agentTitle: agents.title,
      content: messages.content,
      createdAt: messages.createdAt,
      groupId: messages.groupId,
      groupMatchedId: chatGroups.id,
      id: messages.id,
      model: messages.model,
      role: messages.role,
      sessionId: messages.sessionId,
      sessionMatchedId: sessions.id,
      topicId: messages.topicId,
      topicMatchedId: topics.id,
      updatedAt: messages.updatedAt,
    })
    .from(messages)
    .leftJoin(agents, and(eq(messages.agentId, agents.id), buildWorkspaceWhere(scope, agents)))
    .leftJoin(
      chatGroups,
      and(eq(messages.groupId, chatGroups.id), buildWorkspaceWhere(scope, chatGroups)),
    )
    .leftJoin(
      sessions,
      and(eq(messages.sessionId, sessions.id), buildWorkspaceWhere(scope, sessions)),
    )
    .leftJoin(topics, and(eq(messages.topicId, topics.id), buildWorkspaceWhere(scope, topics)))
    .leftJoin(
      messageTopicAgents,
      and(
        eq(topics.agentId, messageTopicAgents.id),
        buildWorkspaceWhere(scope, messageTopicAgents),
      ),
    )
    .leftJoin(
      messageTopicChatGroups,
      and(
        eq(topics.groupId, messageTopicChatGroups.id),
        buildWorkspaceWhere(scope, messageTopicChatGroups),
      ),
    )
    .leftJoin(
      messageTopicSessions,
      and(
        eq(topics.sessionId, messageTopicSessions.id),
        buildWorkspaceWhere(scope, messageTopicSessions),
      ),
    )
    .where(
      and(
        inArray(
          messages.id,
          hits.map(({ id }) => id),
        ),
        buildWorkspaceWhere(scope, messages),
        ne(messages.role, 'tool'),
        // Twin of the topics guard in `hydrateTopics`.
        notShareVisitorMessage(),
        agentId ? eq(messages.agentId, agentId) : undefined,
        visibleParent(messages.agentId, agents.id),
        visibleParent(messages.groupId, chatGroups.id),
        visibleParent(messages.sessionId, sessions.id),
        visibleParent(messages.topicId, topics.id),
        /** A topic is itself a permission container; validate its parents even when the message omits direct foreign keys. */
        visibleParent(topics.agentId, messageTopicAgents.id),
        visibleParent(topics.groupId, messageTopicChatGroups.id),
        visibleParent(topics.sessionId, messageTopicSessions.id),
      ),
    );

  return attachScores(rows, hits)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, limit)
    .map((row) => ({
      agentId: row.agentId,
      content: row.content || '',
      createdAt: row.createdAt,
      description:
        normalizeInboxAgentTitle(row.agentTitle, { slug: row.agentSlug }) || 'General Chat',
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
};

/**
 * Omitting scope is intentionally conservative for exclusion checks: any restricted membership
 * hides the result. Authorization checks must pass scope so unrelated memberships cannot grant access.
 */
const getKnowledgeBaseIdsByFile = async (
  db: LobeChatDatabase,
  fileIds: string[],
  scope?: FtsSearchBackendScope,
): Promise<Map<string, string[]>> => {
  if (fileIds.length === 0) return new Map();

  const rows = await db
    .select({
      fileId: knowledgeBaseFiles.fileId,
      knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
    })
    .from(knowledgeBaseFiles)
    .where(
      and(
        inArray(knowledgeBaseFiles.fileId, fileIds),
        scope ? buildWorkspaceWhere(scope, knowledgeBaseFiles) : undefined,
      ),
    );
  const idsByFile = new Map<string, Set<string>>();
  for (const { fileId, knowledgeBaseId } of rows) {
    const ids = idsByFile.get(fileId) ?? new Set<string>();
    ids.add(knowledgeBaseId);
    idsByFile.set(fileId, ids);
  }

  return new Map(
    [...idsByFile.entries()].map(([fileId, ids]) => [fileId, [...ids].sort()] as const),
  );
};

export const hydrateFiles = async (
  db: LobeChatDatabase,
  hits: FtsSearchCandidateHit[],
  scope: FtsSearchBackendScope,
  limit: number,
  excludeKnowledgeBaseIds: string[] = [],
): Promise<FtsSearchFileResult[]> => {
  if (hits.length === 0) return [];

  const rows = await db
    .select({
      createdAt: files.createdAt,
      fileType: files.fileType,
      id: files.id,
      name: files.name,
      size: files.size,
      updatedAt: files.updatedAt,
      url: files.url,
    })
    .from(files)
    .where(
      and(
        inArray(
          files.id,
          hits.map(({ id }) => id),
        ),
        buildWorkspaceWhere(scope, files),
        ne(files.fileType, 'custom/document'),
        or(isNull(files.source), notInArray(files.source, LIBRARY_HIDDEN_FILE_SOURCES)),
      ),
    );
  const fileIds = rows.map(({ id }) => id);
  const knowledgeBaseIdsByFile = await getKnowledgeBaseIdsByFile(db, fileIds);
  const excluded = new Set(excludeKnowledgeBaseIds);
  const authorizedRows = rows.filter(({ id }) =>
    (knowledgeBaseIdsByFile.get(id) ?? []).every(
      (knowledgeBaseId) => !excluded.has(knowledgeBaseId),
    ),
  );
  const scoredRows = attachScores(authorizedRows, hits).slice(0, limit);
  const selectedFileIds = scoredRows.map(({ id }) => id);
  const documentRows =
    selectedFileIds.length === 0
      ? []
      : await db
          .select({
            content: documentContentPreview(FILE_DESCRIPTION_MAX_LENGTH),
            fileId: documents.fileId,
            id: documents.id,
          })
          .from(documents)
          .where(
            and(inArray(documents.fileId, selectedFileIds), buildWorkspaceWhere(scope, documents)),
          );
  const contentByFile = new Map<string, string | null>();
  for (const row of documentRows.toSorted((left, right) => left.id.localeCompare(right.id))) {
    if (row.fileId && !contentByFile.has(row.fileId)) contentByFile.set(row.fileId, row.content);
  }

  return scoredRows.map((row) => ({
    createdAt: row.createdAt,
    description: truncate(contentByFile.get(row.id), FILE_DESCRIPTION_MAX_LENGTH),
    fileType: row.fileType,
    id: row.id,
    knowledgeBaseId: knowledgeBaseIdsByFile.get(row.id)?.[0] ?? null,
    name: row.name,
    relevance: row.relevance,
    size: row.size,
    title: row.name,
    type: 'file' as const,
    updatedAt: row.updatedAt,
    url: row.url,
  }));
};

export const hydrateFolders = async (
  db: LobeChatDatabase,
  hits: FtsSearchCandidateHit[],
  scope: FtsSearchBackendScope,
  limit: number,
  excludeKnowledgeBaseIds: string[] = [],
): Promise<FtsSearchFolderResult[]> => {
  if (hits.length === 0) return [];

  const rows = await db
    .select({
      createdAt: documents.createdAt,
      description: documents.description,
      fileId: documents.fileId,
      filename: documents.filename,
      id: documents.id,
      knowledgeBaseId: documents.knowledgeBaseId,
      slug: documents.slug,
      title: documents.title,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        inArray(
          documents.id,
          hits.map(({ id }) => id),
        ),
        buildWorkspaceWhere(scope, documents),
        eq(documents.fileType, DOCUMENT_FOLDER_TYPE),
      ),
    );
  const knowledgeBaseIdsByFile = await getKnowledgeBaseIdsByFile(
    db,
    rows.flatMap(({ fileId }) => (fileId ? [fileId] : [])),
  );
  const excluded = new Set(excludeKnowledgeBaseIds);
  const authorizedRows = rows.filter((row) => {
    const knowledgeBaseIds = [
      ...(row.knowledgeBaseId ? [row.knowledgeBaseId] : []),
      ...(row.fileId ? (knowledgeBaseIdsByFile.get(row.fileId) ?? []) : []),
    ];
    return knowledgeBaseIds.every((knowledgeBaseId) => !excluded.has(knowledgeBaseId));
  });

  return attachScores(authorizedRows, hits)
    .slice(0, limit)
    .map((row) => ({
      createdAt: row.createdAt,
      description: row.description,
      id: row.id,
      knowledgeBaseId: row.knowledgeBaseId,
      relevance: row.relevance,
      slug: row.slug,
      title: row.title || row.filename || 'Untitled',
      type: 'folder' as const,
      updatedAt: row.updatedAt,
    }));
};

export const hydratePages = async (
  db: LobeChatDatabase,
  hits: FtsSearchCandidateHit[],
  scope: FtsSearchBackendScope,
  limit: number,
  excludeKnowledgeBaseIds: string[] = [],
): Promise<FtsSearchPageResult[]> => {
  if (hits.length === 0) return [];

  const rows = await db
    .select({
      createdAt: documents.createdAt,
      fileId: documents.fileId,
      filename: documents.filename,
      id: documents.id,
      knowledgeBaseId: documents.knowledgeBaseId,
      title: documents.title,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        inArray(
          documents.id,
          hits.map(({ id }) => id),
        ),
        buildWorkspaceWhere(scope, documents),
        eq(documents.fileType, 'custom/document'),
      ),
    );
  const knowledgeBaseIdsByFile = await getKnowledgeBaseIdsByFile(
    db,
    rows.flatMap(({ fileId }) => (fileId ? [fileId] : [])),
  );
  const excluded = new Set(excludeKnowledgeBaseIds);
  const authorizedRows = rows.filter((row) => {
    const knowledgeBaseIds = [
      ...(row.knowledgeBaseId ? [row.knowledgeBaseId] : []),
      ...(row.fileId ? (knowledgeBaseIdsByFile.get(row.fileId) ?? []) : []),
    ];
    return knowledgeBaseIds.every((knowledgeBaseId) => !excluded.has(knowledgeBaseId));
  });

  return attachScores(authorizedRows, hits)
    .slice(0, limit)
    .map((row) => ({
      createdAt: row.createdAt,
      description: null,
      id: row.id,
      relevance: row.relevance,
      title: row.title || row.filename || 'Untitled',
      type: 'page' as const,
      updatedAt: row.updatedAt,
    }));
};

export const hydrateKnowledgeBaseDocuments = async (
  db: LobeChatDatabase,
  hits: FtsSearchCandidateHit[],
  scope: FtsSearchBackendScope,
  limit: number,
  knowledgeBaseIds: string[],
): Promise<FtsSearchKnowledgeBaseDocumentHit[]> => {
  if (hits.length === 0 || knowledgeBaseIds.length === 0) return [];

  const rows = await db
    .select({
      fileId: documents.fileId,
      filename: documents.filename,
      id: documents.id,
      knowledgeBaseId: documents.knowledgeBaseId,
      title: documents.title,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        inArray(
          documents.id,
          hits.map(({ id }) => id),
        ),
        buildWorkspaceWhere(scope, documents),
        ne(documents.fileType, DOCUMENT_FOLDER_TYPE),
      ),
    );
  const knowledgeBaseIdsByFile = await getKnowledgeBaseIdsByFile(
    db,
    rows.flatMap(({ fileId }) => (fileId ? [fileId] : [])),
    scope,
  );
  const requested = new Set(knowledgeBaseIds);
  const authorizedRows = rows.flatMap((row) => {
    const matchingKnowledgeBaseId =
      row.knowledgeBaseId && requested.has(row.knowledgeBaseId)
        ? row.knowledgeBaseId
        : row.fileId
          ? knowledgeBaseIdsByFile
              .get(row.fileId)
              ?.find((knowledgeBaseId) => requested.has(knowledgeBaseId))
          : undefined;
    return matchingKnowledgeBaseId ? [{ ...row, matchingKnowledgeBaseId }] : [];
  });
  const scoredRows = attachScores(authorizedRows, hits).slice(0, limit);
  const selectedDocumentIds = scoredRows.map(({ id }) => id);
  const contentRows =
    selectedDocumentIds.length === 0
      ? []
      : await db
          .select({
            content: documentContentPreview(KNOWLEDGE_BASE_DOCUMENT_SNIPPET_MAX_LENGTH),
            id: documents.id,
          })
          .from(documents)
          .where(
            and(inArray(documents.id, selectedDocumentIds), buildWorkspaceWhere(scope, documents)),
          );
  const contentById = new Map(contentRows.map(({ content, id }) => [id, content] as const));

  return scoredRows.map((row) => ({
    documentId: row.id,
    fileId: row.fileId ?? undefined,
    knowledgeBaseId: row.matchingKnowledgeBaseId,
    relevance: row.relevance,
    snippet: truncate(contentById.get(row.id), KNOWLEDGE_BASE_DOCUMENT_SNIPPET_MAX_LENGTH) ?? '',
    title: row.title || row.filename || 'Untitled',
    updatedAt: row.updatedAt,
  }));
};

export const hydrateKnowledgeBases = async (
  db: LobeChatDatabase,
  hits: FtsSearchCandidateHit[],
  scope: FtsSearchBackendScope,
  limit: number,
  excludeKnowledgeBaseIds: string[] = [],
): Promise<FtsSearchKnowledgeBaseResult[]> => {
  if (hits.length === 0) return [];

  const rows = await db
    .select({
      avatar: knowledgeBases.avatar,
      createdAt: knowledgeBases.createdAt,
      description: knowledgeBases.description,
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      updatedAt: knowledgeBases.updatedAt,
    })
    .from(knowledgeBases)
    .where(
      and(
        inArray(
          knowledgeBases.id,
          hits.map(({ id }) => id),
        ),
        buildWorkspaceWhere(scope, knowledgeBases),
        excludeKnowledgeBaseIds.length > 0
          ? notInArray(knowledgeBases.id, excludeKnowledgeBaseIds)
          : undefined,
      ),
    );

  return attachScores(rows, hits)
    .slice(0, limit)
    .map((row) => ({
      avatar: row.avatar,
      createdAt: row.createdAt,
      description: row.description,
      id: row.id,
      relevance: row.relevance,
      title: row.name,
      type: 'knowledgeBase' as const,
      updatedAt: row.updatedAt,
    }));
};
