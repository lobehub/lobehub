import { z } from 'zod';

import type {
  UserMemoryActivity,
  UserMemoryContext,
  UserMemoryExperience,
  UserMemoryPreference,
} from './layers';

export const searchMemorySchema = z.object({
  query: z.string(),
  /**
   * Optional limits for each memory layer. If omitted, server defaults are used.
   * Each field is optional - only specify layers you want to customize.
   * Set a layer to 0 to exclude it from search results.
   */
  topK: z
    .object({
      /** Number of activity memories to return */
      activities: z.number().int().min(0).optional(),
      /** Number of context memories to return */
      contexts: z.number().int().min(0).optional(),
      /** Number of experience memories to return */
      experiences: z.number().int().min(0).optional(),
      /** Number of preference memories to return */
      preferences: z.number().int().min(0).optional(),
    })
    .optional(),
});

export type SearchMemoryParams = z.infer<typeof searchMemorySchema>;

export interface SearchMemoryResult {
  activities: Array<Omit<UserMemoryActivity, 'userId' | 'narrativeVector' | 'feedbackVector'>>;
  contexts: Array<Omit<UserMemoryContext, 'userId' | 'titleVector' | 'descriptionVector'>>;
  experiences: Array<
    Omit<UserMemoryExperience, 'userId' | 'actionVector' | 'situationVector' | 'keyLearningVector'>
  >;
  preferences: Array<Omit<UserMemoryPreference, 'userId' | 'conclusionDirectivesVector'>>;
}

interface MemoryToolBaseResult {
  message: string;
  success: boolean;
}

export interface AddContextMemoryResult extends MemoryToolBaseResult {
  contextId?: string;
  memoryId?: string;
}

export interface AddActivityMemoryResult extends MemoryToolBaseResult {
  activityId?: string;
  memoryId?: string;
}

export interface AddExperienceMemoryResult extends MemoryToolBaseResult {
  experienceId?: string;
  memoryId?: string;
}

export interface AddIdentityMemoryResult extends MemoryToolBaseResult {
  identityId?: string;
  memoryId?: string;
}

export interface AddPreferenceMemoryResult extends MemoryToolBaseResult {
  memoryId?: string;
  preferenceId?: string;
}

export interface RemoveIdentityMemoryResult extends MemoryToolBaseResult {
  identityId?: string;
  reason?: string;
}

export interface UpdateIdentityMemoryResult extends MemoryToolBaseResult {
  identityId?: string;
}

// Aliases for retrieval (search) usage
export type RetrieveMemoryParams = SearchMemoryParams;
export type RetrieveMemoryResult = SearchMemoryResult;
