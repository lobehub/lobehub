import type {
  SearchMemoryParams,
  UserMemoryActivityWithoutVectors,
  UserMemoryContextWithoutVectors,
  UserMemoryExperienceWithoutVectors,
  UserMemoryIdentityWithoutVectors,
  UserMemoryPreferenceWithoutVectors,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, cosineDistance, desc, eq, inArray, sql } from 'drizzle-orm';

import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../../schemas';
import type { UserMemoryQueryContext } from './context';

export async function searchActivitiesSemantic(
  ctx: UserMemoryQueryContext,
  embedding: number[],
  limit: number,
  params: SearchMemoryParams,
) {
  const conditions = [
    ctx.memoryWhere(userMemoriesActivities),
    ctx.memoryWhere(userMemories),
    params.categories?.length ? inArray(userMemories.memoryCategory, params.categories) : undefined,
    params.status?.length ? inArray(userMemoriesActivities.status, params.status) : undefined,
    params.types?.length ? inArray(userMemoriesActivities.type, params.types) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemoriesActivities.capturedAt,
        createdAt: userMemoriesActivities.createdAt,
        endsAt: userMemoriesActivities.endsAt,
        startsAt: userMemoriesActivities.startsAt,
        updatedAt: userMemoriesActivities.updatedAt,
      },
      params.timeRange,
    ),
    ctx.buildExactTagFilterCondition(userMemoriesActivities.tags, userMemories.tags, params),
  ].filter((condition): condition is SQL => Boolean(condition));

  const rowsQuery = ctx.db
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
    .innerJoin(userMemories, eq(userMemories.id, userMemoriesActivities.userMemoryId))
    .where(and(...conditions))
    .orderBy(desc(sql`1 - (${cosineDistance(userMemoriesActivities.narrativeVector, embedding)})`))
    .limit(limit);

  return rowsQuery as Promise<UserMemoryActivityWithoutVectors[]>;
}

export async function searchContextsSemantic(
  ctx: UserMemoryQueryContext,
  embedding: number[],
  limit: number,
  params: SearchMemoryParams,
) {
  const conditions = [
    ctx.memoryWhere(userMemoriesContexts),
    ctx.memoryWhere(userMemories),
    params.categories?.length ? inArray(userMemories.memoryCategory, params.categories) : undefined,
    params.status?.length ? inArray(userMemoriesContexts.currentStatus, params.status) : undefined,
    params.types?.length ? inArray(userMemoriesContexts.type, params.types) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemoriesContexts.capturedAt,
        createdAt: userMemoriesContexts.createdAt,
        updatedAt: userMemoriesContexts.updatedAt,
      },
      params.timeRange,
    ),
    ctx.buildExactTagFilterCondition(userMemoriesContexts.tags, userMemories.tags, params),
  ].filter((condition): condition is SQL => Boolean(condition));

  const contextCandidates = ctx.db.$with('semantic_context_candidates').as(
    ctx.db
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
        dedupeRank: sql<number>`
          row_number() over (
            partition by ${userMemoriesContexts.id}
            order by
              1 - (${cosineDistance(userMemoriesContexts.descriptionVector, embedding)}) desc,
              ${userMemoriesContexts.createdAt} desc
          )
        `.as('dedupe_rank'),
        id: userMemoriesContexts.id,
        metadata: userMemoriesContexts.metadata,
        scoreImpact: userMemoriesContexts.scoreImpact,
        scoreUrgency: userMemoriesContexts.scoreUrgency,
        similarity: sql<number>`
          1 - (${cosineDistance(userMemoriesContexts.descriptionVector, embedding)})
        `.as('similarity'),
        tags: userMemoriesContexts.tags,
        title: userMemoriesContexts.title,
        type: userMemoriesContexts.type,
        updatedAt: userMemoriesContexts.updatedAt,
        userId: userMemoriesContexts.userId,
        userMemoryIds: userMemoriesContexts.userMemoryIds,
      })
      .from(userMemoriesContexts)
      .innerJoin(
        userMemories,
        and(
          eq(userMemories.userId, userMemoriesContexts.userId),
          sql<boolean>`
            COALESCE(${userMemoriesContexts.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text
          `,
        ),
      )
      .where(and(...conditions)),
  );

  const rowsQuery = ctx.db
    .with(contextCandidates)
    .select({
      accessedAt: contextCandidates.accessedAt,
      associatedObjects: contextCandidates.associatedObjects,
      associatedSubjects: contextCandidates.associatedSubjects,
      capturedAt: contextCandidates.capturedAt,
      createdAt: contextCandidates.createdAt,
      currentStatus: contextCandidates.currentStatus,
      description: contextCandidates.description,
      id: contextCandidates.id,
      metadata: contextCandidates.metadata,
      scoreImpact: contextCandidates.scoreImpact,
      scoreUrgency: contextCandidates.scoreUrgency,
      tags: contextCandidates.tags,
      title: contextCandidates.title,
      type: contextCandidates.type,
      updatedAt: contextCandidates.updatedAt,
      userId: contextCandidates.userId,
      firstSeenAt: contextCandidates.firstSeenAt,
      lastEvidenceAt: contextCandidates.lastEvidenceAt,
      nextSteps: contextCandidates.nextSteps,
      now: contextCandidates.now,
      openQuestions: contextCandidates.openQuestions,
      synthesizedAt: contextCandidates.synthesizedAt,
      userMemoryId: contextCandidates.userMemoryId,
      userMemoryIds: contextCandidates.userMemoryIds,
    })
    .from(contextCandidates)
    .where(eq(contextCandidates.dedupeRank, 1))
    .orderBy(desc(contextCandidates.similarity), desc(contextCandidates.createdAt))
    .limit(limit);

  return rowsQuery as Promise<UserMemoryContextWithoutVectors[]>;
}

export async function searchExperiencesSemantic(
  ctx: UserMemoryQueryContext,
  embedding: number[],
  limit: number,
  params: SearchMemoryParams,
) {
  const conditions = [
    ctx.memoryWhere(userMemoriesExperiences),
    ctx.memoryWhere(userMemories),
    params.categories?.length ? inArray(userMemories.memoryCategory, params.categories) : undefined,
    params.types?.length ? inArray(userMemoriesExperiences.type, params.types) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemoriesExperiences.capturedAt,
        createdAt: userMemoriesExperiences.createdAt,
        updatedAt: userMemoriesExperiences.updatedAt,
      },
      params.timeRange,
    ),
    ctx.buildExactTagFilterCondition(userMemoriesExperiences.tags, userMemories.tags, params),
  ].filter((condition): condition is SQL => Boolean(condition));

  const rowsQuery = ctx.db
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
    })
    .from(userMemoriesExperiences)
    .innerJoin(userMemories, eq(userMemories.id, userMemoriesExperiences.userMemoryId))
    .where(and(...conditions))
    .orderBy(desc(sql`1 - (${cosineDistance(userMemoriesExperiences.situationVector, embedding)})`))
    .limit(limit);

  return rowsQuery as Promise<UserMemoryExperienceWithoutVectors[]>;
}

export async function searchPreferencesSemantic(
  ctx: UserMemoryQueryContext,
  embedding: number[],
  limit: number,
  params: SearchMemoryParams,
) {
  const conditions = [
    ctx.memoryWhere(userMemoriesPreferences),
    ctx.memoryWhere(userMemories),
    params.categories?.length ? inArray(userMemories.memoryCategory, params.categories) : undefined,
    params.types?.length ? inArray(userMemoriesPreferences.type, params.types) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemoriesPreferences.capturedAt,
        createdAt: userMemoriesPreferences.createdAt,
        updatedAt: userMemoriesPreferences.updatedAt,
      },
      params.timeRange,
    ),
    ctx.buildExactTagFilterCondition(userMemoriesPreferences.tags, userMemories.tags, params),
  ].filter((condition): condition is SQL => Boolean(condition));

  const rowsQuery = ctx.db
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
    })
    .from(userMemoriesPreferences)
    .innerJoin(userMemories, eq(userMemories.id, userMemoriesPreferences.userMemoryId))
    .where(and(...conditions))
    .orderBy(
      desc(
        sql`1 - (${cosineDistance(userMemoriesPreferences.conclusionDirectivesVector, embedding)})`,
      ),
    )
    .limit(limit);

  return rowsQuery as Promise<UserMemoryPreferenceWithoutVectors[]>;
}

export async function searchIdentitiesSemantic(
  ctx: UserMemoryQueryContext,
  embedding: number[],
  limit: number,
  params: SearchMemoryParams,
): Promise<UserMemoryIdentityWithoutVectors[]> {
  const conditions = [
    ctx.memoryWhere(userMemoriesIdentities),
    ctx.memoryWhere(userMemories),
    params.categories?.length ? inArray(userMemories.memoryCategory, params.categories) : undefined,
    params.relationships?.length
      ? inArray(userMemoriesIdentities.relationship, params.relationships)
      : undefined,
    params.types?.length ? inArray(userMemoriesIdentities.type, params.types) : undefined,
    ctx.buildTimeRangeCondition(
      {
        capturedAt: userMemoriesIdentities.capturedAt,
        createdAt: userMemoriesIdentities.createdAt,
        episodicDate: userMemoriesIdentities.episodicDate,
        updatedAt: userMemoriesIdentities.updatedAt,
      },
      params.timeRange,
    ),
    ctx.buildExactTagFilterCondition(userMemoriesIdentities.tags, userMemories.tags, params),
  ].filter((condition): condition is SQL => Boolean(condition));

  const rowsQuery = ctx.db
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
    .innerJoin(userMemories, eq(userMemories.id, userMemoriesIdentities.userMemoryId))
    .where(and(...conditions))
    .orderBy(
      desc(sql`1 - (${cosineDistance(userMemoriesIdentities.descriptionVector, embedding)})`),
    )
    .limit(limit);

  return rowsQuery as Promise<UserMemoryIdentityWithoutVectors[]>;
}
