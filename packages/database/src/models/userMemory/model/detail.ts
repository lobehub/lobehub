import type {
  UserMemory,
  UserMemoryContextWithoutVectors,
  UserMemoryDetail,
  UserMemoryWithoutVectors,
} from '@lobechat/types';
import { LayersEnum } from '@lobechat/types';
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
import type { GetMemoryDetailParams } from './types';

export const getMemoryDetail = async (
  ctx: UserMemoryModelContext,
  params: GetMemoryDetailParams,
): Promise<UserMemoryDetail | undefined> => {
  const { id, layer } = params;

  switch (layer) {
    case LayersEnum.Context: {
      const [context] = await ctx.db
        .select({
          userMemoryId: userMemoriesContexts.userMemoryId,
          now: userMemoriesContexts.now,
          nextSteps: userMemoriesContexts.nextSteps,
          openQuestions: userMemoriesContexts.openQuestions,
          firstSeenAt: userMemoriesContexts.firstSeenAt,
          lastEvidenceAt: userMemoriesContexts.lastEvidenceAt,
          synthesizedAt: userMemoriesContexts.synthesizedAt,
          accessedAt: userMemoriesContexts.accessedAt,
          associatedObjects: userMemoriesContexts.associatedObjects,
          associatedSubjects: userMemoriesContexts.associatedSubjects,
          capturedAt: userMemoriesContexts.capturedAt,
          createdAt: userMemoriesContexts.createdAt,
          currentStatus: userMemoriesContexts.currentStatus,
          description: userMemoriesContexts.description,
          id: userMemoriesContexts.id,
          metadata: userMemoriesContexts.metadata,
          scoreImpact: userMemoriesContexts.scoreImpact,
          scoreUrgency: userMemoriesContexts.scoreUrgency,
          tags: userMemoriesContexts.tags,
          title: userMemoriesContexts.title,
          type: userMemoriesContexts.type,
          updatedAt: userMemoriesContexts.updatedAt,
          userId: userMemoriesContexts.userId,
          userMemoryIds: userMemoriesContexts.userMemoryIds,
        })
        .from(userMemoriesContexts)
        .where(and(eq(userMemoriesContexts.id, id), ctx.memoryWhere(userMemoriesContexts)))
        .limit(1);
      if (!context) {
        return undefined;
      }

      const memoryIds = Array.isArray(context.userMemoryIds)
        ? (context.userMemoryIds as string[])
        : [];

      const memoryId = memoryIds[0];
      if (!memoryId) {
        return undefined;
      }

      const memory = await ctx.findUserMemoryRawById(memoryId);
      if (!memory) {
        return undefined;
      }
      if (memory.memoryLayer !== LayersEnum.Context) {
        return undefined;
      }

      const { sourceId, sourceType } = await ctx.extractSourceMetadata(context.metadata);
      const source = sourceId ? await ctx.topicModel.findById(sourceId) : undefined;

      return {
        context: context as UserMemoryContextWithoutVectors,
        layer,
        memory,
        source,
        sourceType,
      };
    }
    case LayersEnum.Activity: {
      const [activity] = await ctx.db
        .select({
          dossierId: userMemoriesActivities.dossierId,
          injectable: userMemoriesActivities.injectable,
          accessedAt: userMemoriesActivities.accessedAt,
          associatedLocations: userMemoriesActivities.associatedLocations,
          associatedObjects: userMemoriesActivities.associatedObjects,
          associatedSubjects: userMemoriesActivities.associatedSubjects,
          capturedAt: userMemoriesActivities.capturedAt,
          createdAt: userMemoriesActivities.createdAt,
          endsAt: userMemoriesActivities.endsAt,
          feedback: userMemoriesActivities.feedback,
          id: userMemoriesActivities.id,
          metadata: userMemoriesActivities.metadata,
          narrative: userMemoriesActivities.narrative,
          notes: userMemoriesActivities.notes,
          startsAt: userMemoriesActivities.startsAt,
          status: userMemoriesActivities.status,
          tags: userMemoriesActivities.tags,
          timezone: userMemoriesActivities.timezone,
          type: userMemoriesActivities.type,
          updatedAt: userMemoriesActivities.updatedAt,
          userId: userMemoriesActivities.userId,
          userMemoryId: userMemoriesActivities.userMemoryId,
        })
        .from(userMemoriesActivities)
        .where(and(eq(userMemoriesActivities.id, id), ctx.memoryWhere(userMemoriesActivities)))
        .limit(1);
      if (!activity?.userMemoryId) {
        return undefined;
      }

      const memory = await ctx.findUserMemoryRawById(activity.userMemoryId);
      if (!memory) {
        return undefined;
      }
      if (memory.memoryLayer !== LayersEnum.Activity) {
        return undefined;
      }

      const { sourceId, sourceType } = await ctx.extractSourceMetadata(activity.metadata);
      const source = sourceId ? await ctx.topicModel.findById(sourceId) : undefined;

      return {
        activity,
        layer,
        memory,
        source,
        sourceType,
      };
    }
    case LayersEnum.Experience: {
      const [experience] = await ctx.db
        .select({
          capturedAt: userMemoriesExperiences.capturedAt,
          accessedAt: userMemoriesExperiences.accessedAt,
          action: userMemoriesExperiences.action,
          createdAt: userMemoriesExperiences.createdAt,
          id: userMemoriesExperiences.id,
          keyLearning: userMemoriesExperiences.keyLearning,
          metadata: userMemoriesExperiences.metadata,
          possibleOutcome: userMemoriesExperiences.possibleOutcome,
          reasoning: userMemoriesExperiences.reasoning,
          scoreConfidence: userMemoriesExperiences.scoreConfidence,
          situation: userMemoriesExperiences.situation,
          tags: userMemoriesExperiences.tags,
          type: userMemoriesExperiences.type,
          updatedAt: userMemoriesExperiences.updatedAt,
          userId: userMemoriesExperiences.userId,
          userMemoryId: userMemoriesExperiences.userMemoryId,
        })
        .from(userMemoriesExperiences)
        .where(and(eq(userMemoriesExperiences.id, id), ctx.memoryWhere(userMemoriesExperiences)))
        .limit(1);
      if (!experience?.userMemoryId) {
        return undefined;
      }

      const memory = await ctx.findUserMemoryRawById(experience.userMemoryId);
      if (!memory) {
        return undefined;
      }
      if (memory.memoryLayer !== LayersEnum.Experience) {
        return undefined;
      }

      const { sourceId, sourceType } = await ctx.extractSourceMetadata(experience.metadata);
      const source = sourceId ? await ctx.topicModel.findById(sourceId) : undefined;

      return {
        experience,
        layer,
        memory,
        source,
        sourceType,
      };
    }
    case LayersEnum.Identity: {
      const [identity] = await ctx.db
        .select({
          entityId: userMemoriesIdentities.entityId,
          accessedAt: userMemoriesIdentities.accessedAt,
          capturedAt: userMemoriesIdentities.capturedAt,
          createdAt: userMemoriesIdentities.createdAt,
          description: userMemoriesIdentities.description,
          episodicDate: userMemoriesIdentities.episodicDate,
          id: userMemoriesIdentities.id,
          metadata: userMemoriesIdentities.metadata,
          relationship: userMemoriesIdentities.relationship,
          role: userMemoriesIdentities.role,
          tags: userMemoriesIdentities.tags,
          type: userMemoriesIdentities.type,
          updatedAt: userMemoriesIdentities.updatedAt,
          userId: userMemoriesIdentities.userId,
          userMemoryId: userMemoriesIdentities.userMemoryId,
        })
        .from(userMemoriesIdentities)
        .where(and(eq(userMemoriesIdentities.id, id), ctx.memoryWhere(userMemoriesIdentities)))
        .limit(1);
      if (!identity?.userMemoryId) {
        return undefined;
      }

      const memory = await ctx.findUserMemoryRawById(identity.userMemoryId);
      if (!memory) {
        return undefined;
      }
      if (memory.memoryLayer !== LayersEnum.Identity) {
        return undefined;
      }

      const { sourceId, sourceType } = await ctx.extractSourceMetadata(identity.metadata);
      const source = sourceId ? await ctx.topicModel.findById(sourceId) : undefined;

      return {
        identity,
        layer,
        memory,
        source,
        sourceType,
      };
    }
    case LayersEnum.Preference: {
      const [preference] = await ctx.db
        .select({
          lastEvidenceAt: userMemoriesPreferences.lastEvidenceAt,
          evidenceCount: userMemoriesPreferences.evidenceCount,
          holderEntityId: userMemoriesPreferences.holderEntityId,
          appliesToEntityId: userMemoriesPreferences.appliesToEntityId,
          scope: userMemoriesPreferences.scope,
          evidenceSource: userMemoriesPreferences.evidenceSource,
          accessedAt: userMemoriesPreferences.accessedAt,
          capturedAt: userMemoriesPreferences.capturedAt,
          conclusionDirectives: userMemoriesPreferences.conclusionDirectives,
          createdAt: userMemoriesPreferences.createdAt,
          id: userMemoriesPreferences.id,
          metadata: userMemoriesPreferences.metadata,
          scorePriority: userMemoriesPreferences.scorePriority,
          suggestions: userMemoriesPreferences.suggestions,
          tags: userMemoriesPreferences.tags,
          type: userMemoriesPreferences.type,
          updatedAt: userMemoriesPreferences.updatedAt,
          userId: userMemoriesPreferences.userId,
          userMemoryId: userMemoriesPreferences.userMemoryId,
        })
        .from(userMemoriesPreferences)
        .where(and(eq(userMemoriesPreferences.id, id), ctx.memoryWhere(userMemoriesPreferences)))
        .limit(1);
      if (!preference?.userMemoryId) {
        return undefined;
      }

      const memory = await ctx.findUserMemoryRawById(preference.userMemoryId);
      if (!memory) {
        return undefined;
      }
      if (memory.memoryLayer !== LayersEnum.Preference) {
        return undefined;
      }

      const { sourceId, sourceType } = await ctx.extractSourceMetadata(preference.metadata);
      const source = sourceId ? await ctx.topicModel.findById(sourceId) : undefined;

      return {
        layer,
        memory,
        preference,
        source,
        sourceType,
      };
    }
  }
};

export const findUserMemoryRawById = async (
  ctx: UserMemoryModelContext,
  memoryId: string,
): Promise<UserMemoryWithoutVectors | undefined> => {
  const [memory] = await ctx.db
    .select({
      state: userMemories.state,
      userLocked: userMemories.userLocked,
      deletedAt: userMemories.deletedAt,
      isDeleted: userMemories.isDeleted,
      accessedAt: userMemories.accessedAt,
      accessedCount: userMemories.accessedCount,
      capturedAt: userMemories.capturedAt,
      createdAt: userMemories.createdAt,
      details: userMemories.details,
      id: userMemories.id,
      lastAccessedAt: userMemories.lastAccessedAt,
      memoryCategory: userMemories.memoryCategory,
      memoryLayer: userMemories.memoryLayer,
      memoryType: userMemories.memoryType,
      metadata: userMemories.metadata,
      status: userMemories.status,
      summary: userMemories.summary,
      tags: userMemories.tags,
      title: userMemories.title,
      updatedAt: userMemories.updatedAt,
      userId: userMemories.userId,
    })
    .from(userMemories)
    .where(and(eq(userMemories.id, memoryId), ctx.memoryWhere(userMemories)))
    .limit(1);
  if (!memory) {
    return undefined;
  }

  return memory;
};

export const findById = async (
  ctx: UserMemoryModelContext,
  id: string,
): Promise<UserMemory | undefined> => {
  const result = await ctx.db.query.userMemories.findFirst({
    where: and(eq(userMemories.id, id), ctx.memoryWhere(userMemories)),
  });

  if (result) {
    await ctx.updateAccessMetrics([id]);
  }

  return result;
};
