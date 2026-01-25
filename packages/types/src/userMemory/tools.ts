import { z } from 'zod';

import {
  UserMemoryActivity,
  UserMemoryContext,
  UserMemoryExperience,
  UserMemoryPreference,
} from './layers';

export const searchMemorySchema = z.object({
  // TODO: we need to dynamically fetch the available categories/types from the backend
  // memoryCategory: z.string().optional(),
  // memoryType: z.string().optional(),
  query: z.string(),
  topK: z.object({
    activities: z.coerce.number().int().min(0),
    contexts: z.coerce.number().int().min(0),
    experiences: z.coerce.number().int().min(0),
    preferences: z.coerce.number().int().min(0),
  }),
});

export type SearchMemoryParams = z.infer<typeof searchMemorySchema>;

export interface SearchMemoryResult {
  activities: Array<
    Omit<UserMemoryActivity, 'userId' | 'narrativeVector' | 'feedbackVector'>
  >;
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
