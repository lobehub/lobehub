import {
  type ActivityMemoryItemSchema,
  type AddIdentityActionSchema,
  type ContextMemoryItemSchema,
  type ExperienceMemoryItemSchema,
  type PreferenceMemoryItemSchema,
  type RemoveIdentityActionSchema,
  type UpdateIdentityActionSchema,
} from '@lobechat/memory-user-memory/schemas';
import {
  type ActivityListParams,
  type ActivityListResult,
  type AddActivityMemoryResult,
  type AddContextMemoryResult,
  type AddExperienceMemoryResult,
  type AddIdentityMemoryResult,
  type AddPreferenceMemoryResult,
  type ExperienceListParams,
  type ExperienceListResult,
  type IdentityListParams,
  type IdentityListResult,
  type LayersEnum,
  type RemoveIdentityMemoryResult,
  type SearchMemoryParams,
  type SearchMemoryResult,
  type TypesEnum,
  type UpdateIdentityMemoryResult,
} from '@lobechat/types';
import { type z } from 'zod';

import { lambdaClient } from '@/libs/trpc/client';

class UserMemoryService {
  addActivityMemory = async (
    params: z.infer<typeof ActivityMemoryItemSchema>,
  ): Promise<AddActivityMemoryResult> => {
    return lambdaClient.userMemories.toolAddActivityMemory.mutate(params);
  };

  addContextMemory = async (
    params: z.infer<typeof ContextMemoryItemSchema>,
  ): Promise<AddContextMemoryResult> => {
    return lambdaClient.userMemories.toolAddContextMemory.mutate(params);
  };

  addExperienceMemory = async (
    params: z.infer<typeof ExperienceMemoryItemSchema>,
  ): Promise<AddExperienceMemoryResult> => {
    return lambdaClient.userMemories.toolAddExperienceMemory.mutate(params);
  };

  addIdentityMemory = async (
    params: z.infer<typeof AddIdentityActionSchema>,
  ): Promise<AddIdentityMemoryResult> => {
    return lambdaClient.userMemories.toolAddIdentityMemory.mutate(params);
  };

  addPreferenceMemory = async (
    params: z.infer<typeof PreferenceMemoryItemSchema>,
  ): Promise<AddPreferenceMemoryResult> => {
    return lambdaClient.userMemories.toolAddPreferenceMemory.mutate(params);
  };

  removeIdentityMemory = async (
    params: z.infer<typeof RemoveIdentityActionSchema>,
  ): Promise<RemoveIdentityMemoryResult> => {
    return lambdaClient.userMemories.toolRemoveIdentityMemory.mutate(params);
  };

  getMemoryDetail = async (params: { id: string; layer: LayersEnum }) => {
    return lambdaClient.userMemories.getMemoryDetail.query(params);
  };

  getPersona = async () => {
    return lambdaClient.userMemory.getPersona.query();
  };

  /**
   * Query experiences with pagination, search, and sorting
   * Returns flat structure optimized for frontend display
   */
  queryExperiences = async (params?: ExperienceListParams): Promise<ExperienceListResult> => {
    return lambdaClient.userMemories.queryExperiences.query(params);
  };

  /**
   * Query activities with pagination, search, and sorting
   * Returns flat structure optimized for frontend display
   */
  queryActivities = async (params?: ActivityListParams): Promise<ActivityListResult> => {
    return lambdaClient.userMemories.queryActivities.query(params);
  };

  /**
   * Query identities with pagination, search, and sorting
   * Returns flat structure optimized for frontend display
   */
  queryIdentities = async (params?: IdentityListParams): Promise<IdentityListResult> => {
    return lambdaClient.userMemories.queryIdentities.query(params);
  };

  retrieveMemory = async (params: SearchMemoryParams): Promise<SearchMemoryResult> => {
    return lambdaClient.userMemories.toolSearchMemory.query(params);
  };

  /**
   * Retrieve memories for a specific topic
   * Uses the topic's historySummary as the search query
   */
  retrieveMemoryForTopic = async (topicId: string): Promise<SearchMemoryResult> => {
    return lambdaClient.userMemories.retrieveMemoryForTopic.query({ topicId });
  };

  searchMemory = async (params: SearchMemoryParams): Promise<SearchMemoryResult> => {
    return lambdaClient.userMemories.toolSearchMemory.query(params);
  };

  queryTags = async (params?: { layers?: LayersEnum[]; page?: number; size?: number }) => {
    return lambdaClient.userMemories.queryTags.query(params);
  };

  queryIdentityRoles = async (params?: { page?: number; size?: number }) => {
    return lambdaClient.userMemories.queryIdentityRoles.query(params);
  };

  /**
   * Query identities for chat context injection
   * Only returns user's own identities (relationship === 'self' or null)
   */
  queryIdentitiesForInjection = async (params?: { limit?: number }) => {
    return lambdaClient.userMemories.queryIdentitiesForInjection.query(params);
  };

  queryMemories = async (params?: {
    categories?: string[];
    layer?: LayersEnum;
    order?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
    q?: string;
    sort?:
      | 'capturedAt'
      | 'scoreConfidence'
      | 'scoreImpact'
      | 'scorePriority'
      | 'scoreUrgency'
      | 'startsAt';
    status?: string[];
    tags?: string[];
    types?: TypesEnum[];
  }) => {
    return lambdaClient.userMemories.queryMemories.query(params);
  };

  updateIdentityMemory = async (
    params: z.infer<typeof UpdateIdentityActionSchema>,
  ): Promise<UpdateIdentityMemoryResult> => {
    return lambdaClient.userMemories.toolUpdateIdentityMemory.mutate(params);
  };
}

export const userMemoryService = new UserMemoryService();
export { memoryCRUDService } from './crud';
export { memoryExtractionService } from './extraction';
