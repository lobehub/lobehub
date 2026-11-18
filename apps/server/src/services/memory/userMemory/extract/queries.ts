import { DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS } from '@lobechat/const';
import { messages, topics } from '@lobechat/database/schemas';
import type { MemoryExtractionJob } from '@lobechat/memory-user-memory';
import type { LLMRoleType, ModelRuntime, OpenAIChatMessage } from '@lobechat/model-runtime';
import type { IdentityMemoryDetail } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { ListTopicsForMemoryExtractorCursor } from '@/database/models/topic';
import { TopicModel } from '@/database/models/topic';
import type { ListUsersForMemoryExtractorCursor } from '@/database/models/user';
import { UserModel } from '@/database/models/user';
import type { UserMemoryHybridSearchAggregatedResult } from '@/database/models/userMemory';
import {
  normalizeUserMemorySearchQueries,
  shouldRunUserMemoryLexicalSearch,
  UserMemoryModel,
} from '@/database/models/userMemory';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import { createFtsSearchRepo } from '@/server/services/ftsSearch';
import { recordUserMemoryLexicalSearchDecision } from '@/server/services/ftsSearch/observability';
import { LayersEnum } from '@/types/userMemory';
import { trimEmbeddingInput } from '@/utils/tokenizer/embedding';

import type { MemoryExtractionExecutorContext } from './context';
import type { TopicPaginationJob, UserPaginationResult } from './types';
import { MEMORY_EXTRACTION_WINDOW } from './window';

export async function listConversationsForTopic(
  ctx: MemoryExtractionExecutorContext,
  userId: string,
  topicId: string,
  topicUpdatedAt: Date,
  workspaceId?: string,
) {
  const db = await ctx.db;
  const rows = await db
    .select({
      content: messages.content,
      createdAt: messages.createdAt,
      id: messages.id,
      role: messages.role,
      updatedAt: messages.updatedAt,
    })
    .from(messages)
    .where(
      and(
        buildWorkspaceWhere({ userId, workspaceId }, messages),
        eq(messages.topicId, topicId),
        // The conversation itself. Tool output (file contents, search results, command logs) is
        // most of a topic's text and says little about the user, so it is not extracted.
        inArray(messages.role, ['user', 'assistant']),
      ),
    )
    .orderBy(asc(messages.createdAt));

  const conversation = rows
    .filter((row) => typeof row.content === 'string' && row.content.trim().length > 0)
    .map(
      (row) =>
        ({
          content: row.content as string,
          createdAt: row.createdAt ?? topicUpdatedAt,
          id: row.id,
          role: (row.role ?? 'assistant') as LLMRoleType,
          updatedAt: row.updatedAt,
        }) satisfies OpenAIChatMessage & { createdAt: Date; id: string; updatedAt: Date | null },
    );

  if (conversation.length === 0) {
    return [];
  }

  return conversation;
}

export async function listRelevantUserMemories(
  ctx: MemoryExtractionExecutorContext,
  job: MemoryExtractionJob,
  runtime: ModelRuntime,
  embeddingModel: string,
  userId: string,
  conversations: OpenAIChatMessage[],
  tokenLimit?: number,
): Promise<UserMemoryHybridSearchAggregatedResult> {
  const db = await ctx.db;
  const ftsSearchRepo = await createFtsSearchRepo({ db, userId, usage: 'memory_extraction' });
  const userMemoryModel = new UserMemoryModel(db, userId, ftsSearchRepo);
  // TODO: make topK configurable
  const topK = 10;
  const aggregatedContent = await trimEmbeddingInput(
    conversations.map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n\n'),
    embeddingModel,
    tokenLimit,
  );

  const embeddings = await runtime.embeddings(
    {
      dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
      input: [aggregatedContent],
      model: embeddingModel,
    },
    { metadata: { trigger: RequestTrigger.Memory }, user: userId },
  );

  const vector = embeddings?.[0];
  if (vector) {
    const queries = normalizeUserMemorySearchQueries([aggregatedContent]);
    recordUserMemoryLexicalSearchDecision({
      decision: shouldRunUserMemoryLexicalSearch(queries, [vector])
        ? 'executed'
        : 'skipped_long_context',
      queryCharacters: Array.from(aggregatedContent).length,
      source: 'memory_extraction',
    });
    const retrieved = await userMemoryModel.searchMemory(
      {
        queries,
        topK: {
          activities: topK,
          contexts: topK,
          experiences: topK,
          identities: topK,
          preferences: topK,
        },
      },
      [vector],
    );

    return retrieved;
  }

  return {
    activities: [],
    contexts: [],
    experiences: [],
    identities: [],
    meta: {
      appliedFilters: {},
      appliedQueries: [],
      layers: {
        activities: { hasMore: false, returned: 0, total: 0 },
        contexts: { hasMore: false, returned: 0, total: 0 },
        experiences: { hasMore: false, returned: 0, total: 0 },
        identities: { hasMore: false, returned: 0, total: 0 },
        preferences: { hasMore: false, returned: 0, total: 0 },
      },
      ranking: {},
    },
    preferences: [],
  };
}

export async function listUserMemoryIdentities(
  ctx: MemoryExtractionExecutorContext,
  job: MemoryExtractionJob,
  userId: string,
): Promise<IdentityMemoryDetail[]> {
  const db = await ctx.db;
  const userMemoryModel = new UserMemoryModel(db, userId);

  const res = await userMemoryModel.getAllIdentitiesWithMemory();

  return res.map((item) => ({ ...item, layer: LayersEnum.Identity }));
}

/**
 * The cursor for the page after `rows`, or none when `rows` is a short page. Every caller
 * schedules another run while a cursor comes back, so ending on a short page keeps a cursor that
 * fails to advance from chaining runs forever.
 */
const nextPageCursor = (rows: { createdAt: Date; id: string }[], pageSize: number) => {
  const last = rows.at(-1);
  return last && rows.length >= pageSize ? { createdAt: last.createdAt, id: last.id } : undefined;
};

export async function getTopicsForUser(
  ctx: MemoryExtractionExecutorContext,
  job: TopicPaginationJob,
  pageSize: number,
): Promise<{ cursor?: ListTopicsForMemoryExtractorCursor; ids: string[] }> {
  const db = await ctx.db;
  const topicModel = new TopicModel(db, job.userId, job.workspaceId);
  const rows = await topicModel.listTopicsForMemoryExtractor({
    cursor: job.cursor,
    endDate: job.to,
    ignoreExtracted: job.forceAll || job.forceTopics,
    limit: pageSize,
    // The same settle window extraction applies, so a listed topic has something to extract.
    settledBefore: new Date(Date.now() - MEMORY_EXTRACTION_WINDOW.settleMs),
    limitFailedRetries: !(job.forceAll || job.forceTopics || job.userInitiated),
    startDate: job.from,
  });
  if (!rows?.length) {
    return { ids: [] };
  }

  return {
    cursor: nextPageCursor(rows, pageSize),
    ids: rows.map((topic) => topic.id),
  };
}

export async function getUsers(
  ctx: MemoryExtractionExecutorContext,
  limit: number,
  cursor?: ListUsersForMemoryExtractorCursor,
): Promise<UserPaginationResult> {
  const db = await ctx.db;

  const rows = await UserModel.listUsersForMemoryExtractor(db, {
    cursor,
    limit,
    whitelist: ctx.privateConfig.whitelistUsers,
  });
  if (!rows?.length) {
    return { ids: [] };
  }

  return {
    cursor: nextPageCursor(rows, limit),
    ids: rows.map((row) => row.id),
  };
}

export async function getUsersForHourlyExtraction(
  ctx: MemoryExtractionExecutorContext,
  limit: number,
  cursor?: ListUsersForMemoryExtractorCursor,
): Promise<UserPaginationResult> {
  const db = await ctx.db;

  const rows = await UserModel.listUsersForHourlyMemoryExtractor(db, {
    cursor,
    limit,
    whitelist: ctx.privateConfig.whitelistUsers,
  });
  if (!rows?.length) {
    return { ids: [] };
  }

  return {
    cursor: nextPageCursor(rows, limit),
    ids: rows.map((row) => row.id),
  };
}

export async function filterTopicIdsForUser(
  ctx: MemoryExtractionExecutorContext,
  userId: string,
  topicIds: string[],
  workspaceId?: string,
) {
  if (!topicIds.length) return [];

  const db = await ctx.db;
  const rows = await db.query.topics.findMany({
    columns: { id: true },
    where: and(buildWorkspaceWhere({ userId, workspaceId }, topics), inArray(topics.id, topicIds)),
  });

  return rows.map((row) => row.id);
}
