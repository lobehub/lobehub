import type {
  UserMemoryActivityInsert,
  UserMemoryContextInsert,
  UserMemoryExperienceInsert,
  UserMemoryIdentityInsert,
  UserMemoryInsert,
  UserMemoryPreferenceInsert,
} from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../../schemas';
import type { UserMemoryModelContext } from './context';
import type {
  CreateUserMemoryParams,
  UpdateContextVectorsParams,
  UpdateExperienceVectorsParams,
  UpdateIdentityVectorsParams,
  UpdatePreferenceVectorsParams,
  UpdateUserMemoryVectorsParams,
} from './types';

export const updateUserMemory = async (
  ctx: UserMemoryModelContext,
  id: string,
  params: Partial<CreateUserMemoryParams>,
): Promise<void> => {
  await ctx.db
    .update(userMemories)
    .set({ ...params, updatedAt: new Date() })
    .where(and(eq(userMemories.id, id), ctx.memoryWhere(userMemories)));
};

export const updateUserMemoryVectors = async (
  ctx: UserMemoryModelContext,
  id: string,
  vectors: UpdateUserMemoryVectorsParams,
): Promise<void> => {
  const vectorUpdates: Partial<UserMemoryInsert> = {};
  if (vectors.detailsVector1024 !== undefined) {
    vectorUpdates.detailsVector1024 = vectors.detailsVector1024;
  }
  if (vectors.summaryVector1024 !== undefined) {
    vectorUpdates.summaryVector1024 = vectors.summaryVector1024;
  }

  if (Object.keys(vectorUpdates).length === 0) {
    return;
  }

  await ctx.db
    .update(userMemories)
    .set({
      ...vectorUpdates,
      updatedAt: new Date(),
    })
    .where(and(eq(userMemories.id, id), ctx.memoryWhere(userMemories)));
};

export const updateContextVectors = async (
  ctx: UserMemoryModelContext,
  id: string,
  vectors: UpdateContextVectorsParams,
): Promise<void> => {
  const vectorUpdates: Partial<UserMemoryContextInsert> = {};
  if (vectors.descriptionVector !== undefined) {
    vectorUpdates.descriptionVector = vectors.descriptionVector;
  }
  if (Object.keys(vectorUpdates).length === 0) {
    return;
  }

  await ctx.db
    .update(userMemoriesContexts)
    .set({
      ...vectorUpdates,
      updatedAt: new Date(),
    })
    .where(and(eq(userMemoriesContexts.id, id), ctx.memoryWhere(userMemoriesContexts)));
};

export const updatePreferenceVectors = async (
  ctx: UserMemoryModelContext,
  id: string,
  vectors: UpdatePreferenceVectorsParams,
): Promise<void> => {
  const vectorUpdates: Partial<UserMemoryPreferenceInsert> = {};
  if (vectors.conclusionDirectivesVector !== undefined) {
    vectorUpdates.conclusionDirectivesVector = vectors.conclusionDirectivesVector;
  }

  if (Object.keys(vectorUpdates).length === 0) {
    return;
  }

  await ctx.db
    .update(userMemoriesPreferences)
    .set({
      ...vectorUpdates,
      updatedAt: new Date(),
    })
    .where(and(eq(userMemoriesPreferences.id, id), ctx.memoryWhere(userMemoriesPreferences)));
};

export const updateIdentityVectors = async (
  ctx: UserMemoryModelContext,
  id: string,
  vectors: UpdateIdentityVectorsParams,
): Promise<void> => {
  const vectorUpdates: Partial<UserMemoryIdentityInsert> = {};
  if (vectors.descriptionVector !== undefined) {
    vectorUpdates.descriptionVector = vectors.descriptionVector;
  }

  if (Object.keys(vectorUpdates).length === 0) {
    return;
  }

  await ctx.db
    .update(userMemoriesIdentities)
    .set({
      ...vectorUpdates,
      updatedAt: new Date(),
    })
    .where(and(eq(userMemoriesIdentities.id, id), ctx.memoryWhere(userMemoriesIdentities)));
};

export const updateExperienceVectors = async (
  ctx: UserMemoryModelContext,
  id: string,
  vectors: UpdateExperienceVectorsParams,
): Promise<void> => {
  const vectorUpdates: Partial<UserMemoryExperienceInsert> = {};
  if (vectors.actionVector !== undefined) {
    vectorUpdates.actionVector = vectors.actionVector;
  }
  if (vectors.keyLearningVector !== undefined) {
    vectorUpdates.keyLearningVector = vectors.keyLearningVector;
  }
  if (vectors.situationVector !== undefined) {
    vectorUpdates.situationVector = vectors.situationVector;
  }

  if (Object.keys(vectorUpdates).length === 0) {
    return;
  }

  await ctx.db
    .update(userMemoriesExperiences)
    .set({
      ...vectorUpdates,
      updatedAt: new Date(),
    })
    .where(and(eq(userMemoriesExperiences.id, id), ctx.memoryWhere(userMemoriesExperiences)));
};

export const updateActivityVectors = async (
  ctx: UserMemoryModelContext,
  id: string,
  vectors: { feedbackVector?: number[] | null; narrativeVector?: number[] | null },
): Promise<void> => {
  const vectorUpdates: Partial<UserMemoryActivityInsert> = {};
  if (vectors.feedbackVector !== undefined) {
    vectorUpdates.feedbackVector = vectors.feedbackVector;
  }
  if (vectors.narrativeVector !== undefined) {
    vectorUpdates.narrativeVector = vectors.narrativeVector;
  }

  if (Object.keys(vectorUpdates).length === 0) {
    return;
  }

  await ctx.db
    .update(userMemoriesActivities)
    .set({
      ...vectorUpdates,
      updatedAt: new Date(),
    })
    .where(and(eq(userMemoriesActivities.id, id), ctx.memoryWhere(userMemoriesActivities)));
};
