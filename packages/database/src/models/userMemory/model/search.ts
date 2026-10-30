import type {
  UserMemoryContextWithoutVectors,
  UserMemoryExperienceWithoutVectors,
  UserMemoryPreferenceWithoutVectors,
} from '@lobechat/types';
import { and, cosineDistance, desc, eq, sql } from 'drizzle-orm';

import type { UserMemoryActivitiesWithoutVectors } from '../../../schemas';
import {
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesPreferences,
} from '../../../schemas';
import type { UserMemoryModelContext } from './context';
import type { SearchUserMemoryParams, UserMemorySearchAggregatedResult } from './types';

export const search = async (
  ctx: UserMemoryModelContext,
  params: SearchUserMemoryParams,
): Promise<UserMemorySearchAggregatedResult> => {
  const { embedding, limits } = params;

  const resolvedLimits = {
    activities: limits?.activities,
    contexts: limits?.contexts,
    experiences: limits?.experiences,
    preferences: limits?.preferences,
  };

  const [experiences, contexts, preferences, activities] = await Promise.all([
    ctx.searchExperiences({
      embedding,
      limit: resolvedLimits.experiences,
    }),
    ctx.searchContexts({
      embedding,
      limit: resolvedLimits.contexts,
    }),
    ctx.searchPreferences({
      embedding,
      limit: resolvedLimits.preferences,
    }),
    ctx.searchActivities({
      embedding,
      limit: resolvedLimits.activities,
    }),
  ]);

  const accessedMemoryIds = new Set<string>();
  experiences.forEach((experience) => {
    if (experience.userMemoryId) accessedMemoryIds.add(experience.userMemoryId);
  });
  preferences.forEach((preference) => {
    if (preference.userMemoryId) accessedMemoryIds.add(preference.userMemoryId);
  });
  activities.forEach((activity) => {
    if (activity.userMemoryId) accessedMemoryIds.add(activity.userMemoryId);
  });
  const contextLinkIds: string[] = [];
  contexts.forEach((context) => {
    const ids = Array.isArray(context.userMemoryIds) ? (context.userMemoryIds as string[]) : [];
    ids.forEach((id) => accessedMemoryIds.add(id));
    contextLinkIds.push(context.id);
  });

  if (accessedMemoryIds.size > 0 || contextLinkIds.length > 0) {
    await ctx.updateAccessMetrics([...accessedMemoryIds], {
      contextIds: contextLinkIds,
      timestamp: new Date(),
    });
  }

  return {
    activities,
    contexts,
    experiences,
    preferences,
  };
};

export const searchActivities = async (
  ctx: UserMemoryModelContext,
  params: {
    embedding?: number[];
    limit?: number;
    type?: string;
  },
): Promise<UserMemoryActivitiesWithoutVectors[]> => {
  const { embedding, limit = 5, type } = params;
  if (limit <= 0) {
    return [];
  }

  let query = ctx.db
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
      ...(embedding && {
        similarity: sql<number>`1 - (${cosineDistance(userMemoriesActivities.narrativeVector, embedding)}) AS similarity`,
      }),
    })
    .from(userMemoriesActivities)
    .$dynamic();

  const conditions = [ctx.memoryWhere(userMemoriesActivities)];
  if (type) {
    conditions.push(eq(userMemoriesActivities.type, type));
  }

  query = query.where(and(...conditions));

  if (embedding) {
    query = query.orderBy(desc(sql`similarity`));
  } else {
    query = query.orderBy(desc(userMemoriesActivities.createdAt));
  }
  return query.limit(limit) as Promise<UserMemoryActivitiesWithoutVectors[]>;
};

export const searchContexts = async (
  ctx: UserMemoryModelContext,
  params: {
    embedding?: number[];
    limit?: number;
    type?: string;
  },
): Promise<UserMemoryContextWithoutVectors[]> => {
  const { embedding, limit = 5, type } = params;
  if (limit <= 0) {
    return [];
  }

  let query = ctx.db
    .select({
      firstSeenAt: userMemoriesContexts.firstSeenAt,
      lastEvidenceAt: userMemoriesContexts.lastEvidenceAt,
      nextSteps: userMemoriesContexts.nextSteps,
      now: userMemoriesContexts.now,
      openQuestions: userMemoriesContexts.openQuestions,
      synthesizedAt: userMemoriesContexts.synthesizedAt,
      userMemoryId: userMemoriesContexts.userMemoryId,
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
      ...(embedding && {
        similarity: sql<number>`1 - (${cosineDistance(userMemoriesContexts.descriptionVector, embedding)}) AS similarity`,
      }),
    })
    .from(userMemoriesContexts)
    .$dynamic();

  const conditions = [ctx.memoryWhere(userMemoriesContexts)];
  if (type) {
    conditions.push(eq(userMemoriesContexts.type, type));
  }

  query = query.where(and(...conditions));

  if (embedding) {
    query = query.orderBy(desc(sql`similarity`));
  } else {
    query = query.orderBy(desc(userMemoriesContexts.createdAt));
  }
  const res = (await query.limit(limit)) as UserMemoryContextWithoutVectors[];
  return res;
};

export const searchExperiences = async (
  ctx: UserMemoryModelContext,
  params: {
    embedding?: number[];
    limit?: number;
    type?: string;
  },
): Promise<UserMemoryExperienceWithoutVectors[]> => {
  const { embedding, limit = 5, type } = params;
  if (limit <= 0) {
    return [];
  }

  let query = ctx.db
    .select({
      accessedAt: userMemoriesExperiences.accessedAt,
      action: userMemoriesExperiences.action,
      capturedAt: userMemoriesExperiences.capturedAt,
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
      ...(embedding && {
        similarity: sql<number>`1 - (${cosineDistance(userMemoriesExperiences.situationVector, embedding)}) AS similarity`,
      }),
    })
    .from(userMemoriesExperiences)
    .$dynamic();

  const conditions = [ctx.memoryWhere(userMemoriesExperiences)];
  if (type) {
    conditions.push(eq(userMemoriesExperiences.type, type));
  }

  query = query.where(and(...conditions));

  if (embedding) {
    query = query.orderBy(desc(sql`similarity`));
  } else {
    query = query.orderBy(desc(userMemoriesExperiences.createdAt));
  }
  return query.limit(limit);
};

export const searchPreferences = async (
  ctx: UserMemoryModelContext,
  params: {
    embedding?: number[];
    limit?: number;
    type?: string;
  },
): Promise<UserMemoryPreferenceWithoutVectors[]> => {
  const { embedding, limit = 5, type } = params;
  if (limit <= 0) {
    return [];
  }

  let query = ctx.db
    .select({
      appliesToEntityId: userMemoriesPreferences.appliesToEntityId,
      evidenceCount: userMemoriesPreferences.evidenceCount,
      evidenceSource: userMemoriesPreferences.evidenceSource,
      holderEntityId: userMemoriesPreferences.holderEntityId,
      lastEvidenceAt: userMemoriesPreferences.lastEvidenceAt,
      scope: userMemoriesPreferences.scope,
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
      ...(embedding && {
        similarity: sql<number>`1 - (${cosineDistance(userMemoriesPreferences.conclusionDirectivesVector, embedding)}) AS similarity`,
      }),
    })
    .from(userMemoriesPreferences)
    .$dynamic();

  const conditions = [ctx.memoryWhere(userMemoriesPreferences)];
  if (type) {
    conditions.push(eq(userMemoriesPreferences.type, type));
  }

  query = query.where(and(...conditions));

  if (embedding) {
    query = query.orderBy(desc(sql`similarity`));
  } else {
    query = query.orderBy(desc(userMemoriesPreferences.createdAt));
  }
  return query.limit(limit);
};
