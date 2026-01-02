import { ModelProvider } from 'model-bank';
import { type z } from 'zod';

import { DEFAULT_FILE_EMBEDDING_MODEL_ITEM } from '@/const/settings/knowledge';
import { type UserMemoryModel } from '@/database/models/userMemory';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeWithUserPayload } from '@/server/modules/ModelRuntime';
import { type ClientSecretPayload } from '@/types/auth';
import { type SearchMemoryResult, searchMemorySchema } from '@/types/userMemory';

import { EMBEDDING_VECTOR_DIMENSION, memoryProcedure, router } from './shared';

type MemorySearchContext = {
  jwtPayload: ClientSecretPayload;
  memoryModel: UserMemoryModel;
};

type MemorySearchResult = Awaited<ReturnType<UserMemoryModel['searchWithEmbedding']>>;

const EMPTY_SEARCH_RESULT: SearchMemoryResult = {
  contexts: [],
  experiences: [],
  preferences: [],
};

const mapMemorySearchResult = (layeredResults: MemorySearchResult): SearchMemoryResult => {
  return {
    contexts: layeredResults.contexts.map((context) => ({
      accessedAt: context.accessedAt,
      associatedObjects: context.associatedObjects,
      associatedSubjects: context.associatedSubjects,
      createdAt: context.createdAt,
      currentStatus: context.currentStatus,
      description: context.description,
      id: context.id,
      metadata: context.metadata,
      scoreImpact: context.scoreImpact,
      scoreUrgency: context.scoreUrgency,
      tags: context.tags,
      title: context.title,
      type: context.type,
      updatedAt: context.updatedAt,
      userMemoryIds: Array.isArray(context.userMemoryIds)
        ? (context.userMemoryIds as string[])
        : null,
    })),
    experiences: layeredResults.experiences.map((experience) => ({
      accessedAt: experience.accessedAt,
      action: experience.action,
      createdAt: experience.createdAt,
      id: experience.id,
      keyLearning: experience.keyLearning,
      metadata: experience.metadata,
      possibleOutcome: experience.possibleOutcome,
      reasoning: experience.reasoning,
      scoreConfidence: experience.scoreConfidence,
      situation: experience.situation,
      tags: experience.tags,
      type: experience.type,
      updatedAt: experience.updatedAt,
      userMemoryId: experience.userMemoryId,
    })),
    preferences: layeredResults.preferences.map((preference) => ({
      accessedAt: preference.accessedAt,
      conclusionDirectives: preference.conclusionDirectives,
      createdAt: preference.createdAt,
      id: preference.id,
      metadata: preference.metadata,
      scorePriority: preference.scorePriority,
      suggestions: preference.suggestions,
      tags: preference.tags,
      type: preference.type,
      updatedAt: preference.updatedAt,
      userMemoryId: preference.userMemoryId,
    })),
  } satisfies SearchMemoryResult;
};

export const searchUserMemories = async (
  ctx: MemorySearchContext,
  input: z.infer<typeof searchMemorySchema>,
): Promise<SearchMemoryResult> => {
  const agentRuntime = await initModelRuntimeWithUserPayload(ModelProvider.OpenAI, ctx.jwtPayload);

  const { model: embeddingModel } =
    getServerDefaultFilesConfig().embeddingModel || DEFAULT_FILE_EMBEDDING_MODEL_ITEM;

  const queryEmbeddings = await agentRuntime.embeddings({
    dimensions: EMBEDDING_VECTOR_DIMENSION,
    input: input.query,
    model: embeddingModel,
  });

  const limits = {
    contexts: input.topK?.contexts,
    experiences: input.topK?.experiences,
    preferences: input.topK?.preferences,
  };

  const layeredResults = await ctx.memoryModel.searchWithEmbedding({
    embedding: queryEmbeddings?.[0],
    limits,
  });

  return mapMemorySearchResult(layeredResults);
};

export const searchRouter = router({
  searchMemory: memoryProcedure.input(searchMemorySchema).query(async ({ input, ctx }) => {
    try {
      return await searchUserMemories(ctx, input);
    } catch (error) {
      console.error('Failed to retrieve memories:', error);
      return EMPTY_SEARCH_RESULT;
    }
  }),
});
