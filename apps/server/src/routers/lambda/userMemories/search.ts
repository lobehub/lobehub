import {
  DEFAULT_SEARCH_USER_MEMORY_TOP_K,
  DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM,
} from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import type { SearchMemoryResult } from '@lobechat/types';
import { searchMemorySchema } from '@lobechat/types';
import { z } from 'zod';

import type { UserMemoryModel } from '@/database/models/userMemory';
import {
  normalizeUserMemorySearchQueries,
  shouldRunUserMemoryLexicalSearch,
} from '@/database/models/userMemory';
import { UserMemoryTopicRepository } from '@/database/repositories/userMemory';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import {
  recordUserMemoryLexicalSearchDecision,
  type UserMemoryLexicalSearchSource,
} from '@/server/services/ftsSearch/observability';
import { embedUserMemoryTexts } from '@/server/services/memory/userMemory/embedding';
import {
  normalizeSearchMemoryParams,
  resolveMemorySearchTopK,
} from '@/server/services/memory/userMemory/searchParams';

import type { MemoryEffort } from './procedures';
import { memorySearchProcedure, normalizeMemoryEffort } from './procedures';
import { rethrowCandidateSearchError } from './utils';

const EMPTY_SEARCH_RESULT: SearchMemoryResult = {
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
  },
  preferences: [],
};

type MemorySearchContext = {
  memoryModel: UserMemoryModel;
  memoryEffort: MemoryEffort;
  serverDB: LobeChatDatabase;
  userId: string;
};

const searchUserMemories = async (
  ctx: MemorySearchContext,
  input: z.infer<typeof searchMemorySchema>,
  source: UserMemoryLexicalSearchSource,
): Promise<SearchMemoryResult> => {
  const normalizedInput = normalizeSearchMemoryParams(input);
  const { provider, model: embeddingModel } =
    getServerDefaultFilesConfig().embeddingModel || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;
  const modelRuntime = await initModelRuntimeFromDB(ctx.serverDB, ctx.userId, provider);
  const normalizedQueries = normalizeUserMemorySearchQueries(normalizedInput.queries);

  const queryEmbeddings =
    normalizedQueries.length > 0
      ? (
          await embedUserMemoryTexts({
            input: normalizedQueries,
            model: embeddingModel,
            runtime: modelRuntime,
            source: 'lambda:userMemories.search',
            userId: ctx.userId,
          })
        ).filter((embedding): embedding is number[] => Boolean(embedding))
      : [];
  const lexicalSearch = shouldRunUserMemoryLexicalSearch(normalizedQueries, queryEmbeddings);
  recordUserMemoryLexicalSearchDecision({
    decision: lexicalSearch ? 'executed' : 'skipped_long_context',
    queryCharacters: Array.from(normalizedQueries.join(' ')).length,
    source,
  });

  const effectiveEffort = normalizeMemoryEffort(normalizedInput.effort ?? ctx.memoryEffort);
  const effortConstrainedLimits = resolveMemorySearchTopK(effectiveEffort, normalizedInput);
  return ctx.memoryModel.searchMemory(
    { ...normalizedInput, queries: normalizedQueries, topK: effortConstrainedLimits },
    queryEmbeddings,
  ) as Promise<SearchMemoryResult>;
};

export const searchProcedures = {
  searchMemory: memorySearchProcedure.input(searchMemorySchema).query(async ({ input, ctx }) => {
    try {
      return await searchUserMemories(ctx, input, 'api');
    } catch (error) {
      rethrowCandidateSearchError(error);
      console.error('Failed to retrieve memories:', error);
      return EMPTY_SEARCH_RESULT;
    }
  }),
  /**
   * Retrieve memories for a specific topic
   * Uses concatenated user messages (first 7000 chars) as the search query
   */
  retrieveMemoryForTopic: memorySearchProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Dev-only escape hatch: skip the embedding + memory search triggered by topic
      // load / switch, so chat debugging logs aren't drowned in `text-embedding-3-small`
      // router-runtime output. Only honored in non-production builds.
      if (process.env.NODE_ENV !== 'production' && process.env.DEV_DISABLE_AUTO_MEMORY === '1') {
        console.info('[dev] skip retrieveMemoryForTopic (DEV_DISABLE_AUTO_MEMORY=1)');
        return EMPTY_SEARCH_RESULT;
      }

      try {
        // Get concatenated user messages for this topic
        const userMemoryTopicRepo = new UserMemoryTopicRepository(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        const query = await userMemoryTopicRepo.getUserMessagesQueryForTopic(input.topicId);

        if (!query) {
          // No user messages available, return empty result
          return EMPTY_SEARCH_RESULT;
        }

        // Search memories using concatenated user messages
        const searchParams = {
          queries: [query],
          topK: DEFAULT_SEARCH_USER_MEMORY_TOP_K,
        };

        const result = await searchUserMemories(ctx, searchParams, 'topic_retrieval');
        return result;
      } catch (error) {
        rethrowCandidateSearchError(error);
        console.error('Failed to retrieve memory for topic:', error);
        return EMPTY_SEARCH_RESULT;
      }
    }),
  toolSearchMemory: memorySearchProcedure
    .input(searchMemorySchema)
    .query(async ({ input, ctx }) => {
      const result = await searchUserMemories(ctx, input, 'tool');
      return result;
    }),
};
