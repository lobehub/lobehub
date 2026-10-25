import { ActivityTypeEnum } from '@lobechat/types';

import type {
  UserMemoryActivity,
  UserMemoryContext,
  UserMemoryExperience,
  UserMemoryItem,
  UserMemoryPreference,
} from '../../../schemas';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesPreferences,
} from '../../../schemas';
import type { UserMemoryModelContext } from './context';
import type {
  CreateUserMemoryActivityParams,
  CreateUserMemoryContextParams,
  CreateUserMemoryExperienceParams,
  CreateUserMemoryParams,
  CreateUserMemoryPreferenceParams,
} from './types';
import { coerceDate } from './utils';

export const create = async (
  ctx: UserMemoryModelContext,
  params: CreateUserMemoryParams,
): Promise<UserMemoryItem> => {
  const [result] = await ctx.db
    .insert(userMemories)
    .values(ctx.buildBaseMemoryInsertValues(params))
    .returning();

  return result;
};

export const createContextMemory = async (
  ctx: UserMemoryModelContext,
  params: CreateUserMemoryContextParams,
): Promise<{ context: UserMemoryContext; memory: UserMemoryItem }> => {
  return ctx.db.transaction(async (tx) => {
    const baseValues = ctx.buildBaseMemoryInsertValues(params, {
      metadata: params.context.metadata ?? null,
      tags: params.context.tags ?? null,
    });

    const [memory] = await tx.insert(userMemories).values(baseValues).returning();
    if (!memory) throw new Error('Failed to create user memory context');

    const contextValues = {
      associatedObjects: params.context.associatedObjects ?? [],
      associatedSubjects: params.context.associatedSubjects ?? [],
      capturedAt: params.context.capturedAt,
      currentStatus: params.context.currentStatus ?? null,
      description: params.context.description ?? null,
      descriptionVector: params.context.descriptionVector ?? null,
      firstSeenAt: params.context.firstSeenAt ?? null,
      lastEvidenceAt: params.context.lastEvidenceAt ?? null,
      metadata: params.context.metadata ?? null,
      nextSteps: params.context.nextSteps ?? null,
      now: params.context.now ?? null,
      openQuestions: params.context.openQuestions ?? null,
      scoreImpact: params.context.scoreImpact ?? null,
      scoreUrgency: params.context.scoreUrgency ?? null,
      synthesizedAt: params.context.synthesizedAt ?? null,
      tags: params.context.tags ?? [],
      title: params.context.title ?? null,
      type: params.context.type ?? null,
      userId: ctx.userId,
      userMemoryId: memory.id,
      userMemoryIds: [memory.id],
    } satisfies typeof userMemoriesContexts.$inferInsert;

    const [context] = await tx.insert(userMemoriesContexts).values(contextValues).returning();

    return { context, memory };
  });
};

export const createExperienceMemory = async (
  ctx: UserMemoryModelContext,
  params: CreateUserMemoryExperienceParams,
): Promise<{ experience: UserMemoryExperience; memory: UserMemoryItem }> => {
  return ctx.db.transaction(async (tx) => {
    const baseValues = ctx.buildBaseMemoryInsertValues(params, {
      metadata: params.experience.metadata ?? null,
      tags: params.experience.tags ?? null,
    });

    const [memory] = await tx.insert(userMemories).values(baseValues).returning();
    if (!memory) throw new Error('Failed to create user memory experience');

    const experienceValues = {
      action: params.experience.action ?? null,
      actionVector: params.experience.actionVector ?? null,
      capturedAt: params.experience.capturedAt,
      keyLearning: params.experience.keyLearning ?? null,
      keyLearningVector: params.experience.keyLearningVector ?? null,
      metadata: params.experience.metadata ?? null,
      possibleOutcome: params.experience.possibleOutcome ?? null,
      reasoning: params.experience.reasoning ?? null,
      scoreConfidence: params.experience.scoreConfidence ?? null,
      situation: params.experience.situation ?? null,
      situationVector: params.experience.situationVector ?? null,
      tags: params.experience.tags ?? [],
      type: params.experience.type ?? params.memoryType ?? null,
      userId: ctx.userId,
      userMemoryId: memory.id,
    } satisfies typeof userMemoriesExperiences.$inferInsert;

    const [experience] = await tx
      .insert(userMemoriesExperiences)
      .values(experienceValues)
      .returning();

    return { experience, memory };
  });
};

export const createActivityMemory = async (
  ctx: UserMemoryModelContext,
  params: CreateUserMemoryActivityParams,
): Promise<{ activity: UserMemoryActivity; memory: UserMemoryItem }> => {
  return ctx.db.transaction(async (tx) => {
    const baseValues = ctx.buildBaseMemoryInsertValues(params, {
      metadata: params.activity.metadata ?? null,
      status: params.activity.status ?? 'pending',
      tags: params.activity.tags ?? null,
    });

    const [memory] = await tx.insert(userMemories).values(baseValues).returning();
    if (!memory) throw new Error('Failed to create user memory activity');

    const activityValues = {
      associatedLocations: params.activity.associatedLocations ?? null,
      associatedObjects: params.activity.associatedObjects ?? [],
      associatedSubjects: params.activity.associatedSubjects ?? [],
      capturedAt: params.activity.capturedAt,
      dossierId: params.activity.dossierId ?? null,
      endsAt: coerceDate(params.activity.endsAt),
      feedback: params.activity.feedback ?? null,
      feedbackVector: params.activity.feedbackVector ?? null,
      injectable: params.activity.injectable ?? true,
      messageIds: params.activity.messageIds ?? null,
      metadata: params.activity.metadata ?? null,
      narrative: params.activity.narrative ?? null,
      narrativeVector: params.activity.narrativeVector ?? null,
      notes: params.activity.notes ?? null,
      projectId: params.activity.projectId ?? null,
      startsAt: coerceDate(params.activity.startsAt),
      status: params.activity.status ?? null,
      tags: params.activity.tags ?? [],
      timezone: params.activity.timezone ?? null,
      topicId: params.activity.topicId ?? null,
      type: params.activity.type ?? ActivityTypeEnum.Other,
      userId: ctx.userId,
      userMemoryId: memory.id,
    } satisfies typeof userMemoriesActivities.$inferInsert;

    const [activity] = await tx.insert(userMemoriesActivities).values(activityValues).returning();

    return { activity, memory };
  });
};

export const createPreferenceMemory = async (
  ctx: UserMemoryModelContext,
  params: CreateUserMemoryPreferenceParams,
): Promise<{ memory: UserMemoryItem; preference: UserMemoryPreference }> => {
  return ctx.db.transaction(async (tx) => {
    const baseValues = ctx.buildBaseMemoryInsertValues(params, {
      metadata: params.preference.metadata ?? null,
      tags: params.preference.tags ?? null,
    });

    const [memory] = await tx.insert(userMemories).values(baseValues).returning();
    if (!memory) throw new Error('Failed to create user memory preference');

    const preferenceValues = {
      appliesToEntityId: params.preference.appliesToEntityId ?? null,
      capturedAt: params.preference.capturedAt,
      conclusionDirectives: params.preference.conclusionDirectives ?? null,
      conclusionDirectivesVector: params.preference.conclusionDirectivesVector ?? null,
      evidenceCount: params.preference.evidenceCount ?? 1,
      evidenceSource: params.preference.evidenceSource ?? null,
      holderEntityId: params.preference.holderEntityId ?? null,
      lastEvidenceAt: params.preference.lastEvidenceAt ?? null,
      metadata: params.preference.metadata ?? null,
      scorePriority: params.preference.scorePriority ?? null,
      scope: params.preference.scope ?? null,
      suggestions: params.preference.suggestions ?? null,
      tags: params.preference.tags ?? [],
      type: params.preference.type ?? params.memoryType ?? null,
      userId: ctx.userId,
      userMemoryId: memory.id,
    } satisfies typeof userMemoriesPreferences.$inferInsert;

    const [preference] = await tx
      .insert(userMemoriesPreferences)
      .values(preferenceValues)
      .returning();

    return { memory, preference };
  });
};
