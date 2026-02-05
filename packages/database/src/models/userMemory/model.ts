import { AssociatedObjectSchema } from '@lobechat/memory-user-memory';
import type {
  MergeStrategyEnum,
  Optional,
  TypesEnum,
  UserMemoryContextObjectType,
  UserMemoryContextSubjectType,
  UserMemoryContextWithoutVectors,
  UserMemoryDetail,
  UserMemoryExperienceWithoutVectors,
  UserMemoryIdentityWithoutVectors,
  UserMemoryItemSimple,
  UserMemoryPreferenceWithoutVectors,
  UserMemoryWithoutVectors,
} from '@lobechat/types';
import {
  ActivityTypeEnum,
  IdentityTypeEnum,
  LayersEnum,
  MemorySourceType,
  RelationshipEnum,
} from '@lobechat/types';
import type { AnyColumn, SQL } from 'drizzle-orm';
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';

import { merge } from '@/utils/merge';

import type {
  UserMemoryActivitiesWithoutVectors,
  UserMemoryActivity,
  UserMemoryContext,
  UserMemoryExperience,
  UserMemoryIdentity,
  UserMemoryItem,
  UserMemoryPreference,
} from '../../schemas';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { selectNonVectorColumns } from '../../utils/columns';
import { TopicModel } from '../topic';

const normalizeRelationshipValue = (input: unknown): RelationshipEnum | null => {
  if (input === null) return null;
  if (typeof input !== 'string') return null;
  const normalized = input.trim().toLowerCase();
  return Object.values(RelationshipEnum).includes(normalized as RelationshipEnum)
    ? (normalized as RelationshipEnum)
    : null;
};

const normalizeIdentityTypeValue = (input: unknown): IdentityTypeEnum | null => {
  if (input === null) return null;
  if (typeof input !== 'string') return null;
  const normalized = input.trim().toLowerCase();
  return Object.values(IdentityTypeEnum).includes(normalized as IdentityTypeEnum)
    ? (normalized as IdentityTypeEnum)
    : null;
};

const coerceDate = (input: unknown): Date | null => {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'string' || typeof input === 'number') {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
};

export interface BaseCreateUserMemoryParams {
  capturedAt?: Date;
  details: string;
  detailsEmbedding?: number[];
  memoryCategory?: string | null;
  memoryLayer: LayersEnum;
  memoryType: TypesEnum;
  summary: string;
  summaryEmbedding?: number[];
  title: string;
  titleEmbedding?: number[];
}

export interface CreateUserMemoryContextParams extends BaseCreateUserMemoryParams {
  context: Optional<
    Omit<
      UserMemoryContext,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessedAt' | 'userMemoryIds'
    >,
    'capturedAt'
  >;
}

export interface CreateUserMemoryActivityParams extends BaseCreateUserMemoryParams {
  activity: Optional<
    Omit<
      UserMemoryActivity,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessedAt' | 'userMemoryId'
    >,
    'capturedAt'
  >;
}

export interface CreateUserMemoryExperienceParams extends BaseCreateUserMemoryParams {
  experience: Optional<
    Omit<
      UserMemoryExperience,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessedAt' | 'userMemoryId'
    >,
    'capturedAt'
  >;
}

export interface CreateUserMemoryIdentityParams extends BaseCreateUserMemoryParams {
  identity: Optional<
    Omit<
      UserMemoryIdentity,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessedAt' | 'userMemoryId'
    >,
    'capturedAt'
  >;
}

export interface CreateUserMemoryPreferenceParams extends BaseCreateUserMemoryParams {
  preference: Optional<
    Omit<
      UserMemoryPreference,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessedAt' | 'userMemoryId'
    >,
    'capturedAt'
  >;
}

export type CreateUserMemoryParams =
  | CreateUserMemoryActivityParams
  | CreateUserMemoryContextParams
  | CreateUserMemoryExperienceParams
  | CreateUserMemoryIdentityParams
  | CreateUserMemoryPreferenceParams;

export interface SearchUserMemoryParams {
  embedding?: number[];
  limit?: number;
  limits?: Partial<Record<'activities' | 'contexts' | 'experiences' | 'preferences', number>>;
  memoryCategory?: string;
  memoryType?: string;
  query?: string;
}

export interface SearchUserMemoryWithEmbeddingParams {
  embedding?: number[];
  limits?: Partial<Record<'activities' | 'contexts' | 'experiences' | 'preferences', number>>;
  memoryCategory?: string;
  memoryType?: string;
}

export interface UserMemorySearchAggregatedResult {
  activities: UserMemoryActivitiesWithoutVectors[];
  contexts: UserMemoryContextWithoutVectors[];
  experiences: UserMemoryExperienceWithoutVectors[];
  preferences: UserMemoryPreferenceWithoutVectors[];
}

export interface UpdateUserMemoryVectorsParams {
  detailsVector1024?: number[] | null;
  summaryVector1024?: number[] | null;
}

export interface UpdateContextVectorsParams {
  descriptionVector?: number[] | null;
  titleVector?: number[] | null;
}

export interface UpdatePreferenceVectorsParams {
  conclusionDirectivesVector?: number[] | null;
}

export interface UpdateIdentityVectorsParams {
  descriptionVector?: number[] | null;
}

export interface UpdateExperienceVectorsParams {
  actionVector?: number[] | null;
  keyLearningVector?: number[] | null;
  situationVector?: number[] | null;
}

export interface IdentityEntryPayload {
  capturedAt?: Date;
  description?: string | null;
  descriptionVector?: number[] | null;
  episodicDate?: string | Date | null;
  metadata?: Record<string, unknown> | null;
  relationship?: RelationshipEnum | string | null;
  role?: string | null;
  tags?: string[] | null;
  type?: IdentityTypeEnum | string | null;
}

export interface IdentityEntryBasePayload {
  capturedAt?: Date;
  details?: string | null;
  detailsVector1024?: number[] | null;
  lastAccessedAt?: string | Date | null;
  memoryCategory?: string | null;
  memoryLayer?: string | null;
  memoryType?: string | null;
  metadata?: Record<string, unknown> | null;
  status?: string | null;
  summary?: string | null;
  summaryVector1024?: number[] | null;
  tags?: string[] | null;
  title?: string | null;
}

export interface AddIdentityEntryParams {
  base: IdentityEntryBasePayload;
  identity: IdentityEntryPayload;
}

export interface AddIdentityEntryResult {
  identityId: string;
  userMemoryId: string;
}

export interface UpdateIdentityEntryParams {
  base?: IdentityEntryBasePayload;
  identity?: IdentityEntryPayload;
  identityId: string;
  mergeStrategy?: MergeStrategyEnum;
}

export interface ContextEntryPayload {
  associatedObjects?:
    | { extra?: Record<string, unknown>; name?: string; type?: UserMemoryContextObjectType }[]
    | null;
  associatedSubjects?:
    | { extra?: Record<string, unknown>; name?: string; type?: UserMemoryContextSubjectType }[]
    | null;
  currentStatus?: string | null;
  description?: string | null;
  descriptionVector?: number[] | null;
  metadata?: Record<string, unknown> | null;
  scoreImpact?: number | null;
  scoreUrgency?: number | null;
  tags?: string[] | null;
  title?: string | null;
  type?: string | null;
}

export interface UpdateContextEntryParams {
  context?: ContextEntryPayload;
  contextId: string;
}

export interface ExperienceEntryPayload {
  action?: string | null;
  actionVector?: number[] | null;
  keyLearning?: string | null;
  keyLearningVector?: number[] | null;
  metadata?: Record<string, unknown> | null;
  possibleOutcome?: string | null;
  reasoning?: string | null;
  scoreConfidence?: number | null;
  situation?: string | null;
  situationVector?: number[] | null;
  tags?: string[] | null;
  type?: string | null;
}

export interface UpdateExperienceEntryParams {
  experience?: ExperienceEntryPayload;
  experienceId: string;
}

export interface PreferenceEntryPayload {
  conclusionDirectives?: string | null;
  conclusionDirectivesVector?: number[] | null;
  metadata?: Record<string, unknown> | null;
  scorePriority?: number | null;
  suggestions?: string | null;
  tags?: string[] | null;
  type?: string | null;
}

export interface UpdatePreferenceEntryParams {
  preference?: PreferenceEntryPayload;
  preferenceId: string;
}

export interface QueryTagsParams {
  layers?: LayersEnum[];
  page?: number;
  size?: number;
}

export interface QueryTagsResult {
  count: number;
  tag: string;
}

export interface QueryIdentityRolesParams {
  page?: number;
  size?: number;
}

export interface QueryIdentityRolesResult {
  roles: Array<{ count: number; role: string }>;
  tags: Array<{ count: number; tag: string }>;
}

export type QueryUserMemoriesSort =
  | 'capturedAt' // all layers
  | 'scoreConfidence' // user_memories_experiences
  | 'scoreImpact' // user_memories_contexts
  | 'scorePriority' // user_memories_preferences
  | 'scoreUrgency' // user_memories_contexts
  | 'startsAt'; // user_memories_activities

export interface QueryUserMemoriesParams {
  categories?: string[];
  layer?: LayersEnum;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: QueryUserMemoriesSort;
  status?: string[];
  tags?: string[];
  types?: string[];
}

export interface GetMemoriesResult {
  items: UserMemoryItemSimple[];
  page: number;
  pageSize: number;
  total: number;
}

export interface GetMemoryDetailParams {
  id: string;
  layer: LayersEnum;
}

export class UserMemoryModel {
  static parseAssociatedObjects(value?: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];

    const associations: Record<string, unknown>[] = [];

    value.forEach((item) => {
      const parsed = AssociatedObjectSchema.safeParse(item);
      if (parsed.success) {
        const extra = JSON.parse(parsed.data.extra || '{}');
        parsed.data.extra = extra;
        associations.push(parsed.data);
        return;
      }

      if (
        item &&
        typeof item === 'object' &&
        'name' in item &&
        typeof (item as any).name === 'string'
      ) {
        associations.push({ name: (item as any).name });
      }
    });

    return associations.length > 0 ? associations : [];
  }

  static parseAssociatedSubjects(value?: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];

    const associations: Record<string, unknown>[] = [];

    value.forEach((item) => {
      const parsed = AssociatedObjectSchema.safeParse(item);
      if (parsed.success) {
        const extra = JSON.parse(parsed.data.extra || '{}');
        parsed.data.extra = extra;
        associations.push(parsed.data);
        return;
      }

      if (
        item &&
        typeof item === 'object' &&
        'name' in item &&
        typeof (item as any).name === 'string'
      ) {
        associations.push({ name: (item as any).name });
      }
    });

    return associations.length > 0 ? associations : [];
  }

  static parseAssociatedLocations(
    value?:
      | {
          address?: unknown;
          name?: unknown;
          tags?: unknown;
          type?: unknown;
        }[]
      | Record<string, unknown>
      | null,
  ) {
    if (!value) return [];

    const raw = Array.isArray(value) ? value : [value];
    const locations: {
      address?: string;
      name?: string;
      tags?: string[];
      type?: string;
    }[] = [];

    raw.forEach((item) => {
      if (!item || typeof item !== 'object') return;

      const address = typeof (item as any).address === 'string' ? (item as any).address : undefined;
      const name = typeof (item as any).name === 'string' ? (item as any).name : undefined;
      const type = typeof (item as any).type === 'string' ? (item as any).type : undefined;
      const tagsRaw = (item as any).tags;
      const tags =
        Array.isArray(tagsRaw) && tagsRaw.every((tag) => typeof tag === 'string')
          ? (tagsRaw as string[])
          : undefined;

      if (address || name || type || tags) {
        locations.push({
          address,
          name,
          tags,
          type,
        });
      }
    });

    return locations;
  }

  static parseDateFromString(value?: string | Date | null): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value !== 'string') return null;

    const normalized = value.trim();
    if (!normalized) return null;

    return new Date(normalized);
  }

  private userId: string;
  private db: LobeChatDatabase;
  private topicModel: TopicModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
    this.topicModel = new TopicModel(db, userId);
  }

  private extractSourceMetadata(metadata?: Record<string, unknown> | null): {
    sourceId?: string;
    sourceType?: MemorySourceType;
  } {
    if (!metadata || typeof metadata !== 'object') {
      return {};
    }

    const sourceId = typeof metadata.sourceId === 'string' ? metadata.sourceId : undefined;
    const rawSourceType =
      typeof metadata.sourceType === 'string'
        ? (metadata.sourceType as MemorySourceType)
        : undefined;
    const sourceType: MemorySourceType = rawSourceType ?? MemorySourceType.ChatTopic;

    return { sourceId, sourceType };
  }

  private buildBaseMemoryInsertValues(
    params: BaseCreateUserMemoryParams,
    options?: {
      metadata?: Record<string, unknown> | null;
      status?: string | null;
      tags?: string[] | null;
    },
  ): typeof userMemories.$inferInsert {
    const now = new Date();

    return {
      accessedCount: 0,
      capturedAt: params.capturedAt,
      details: params.details ?? null,
      detailsVector1024: params.detailsEmbedding ?? null,
      lastAccessedAt: now,
      memoryCategory: params.memoryCategory ?? null,
      memoryLayer: params.memoryLayer,
      memoryType: params.memoryType ?? null,
      metadata: options?.metadata ?? null,
      status: options?.status ?? null,
      summary: params.summary ?? null,
      summaryVector1024: params.summaryEmbedding ?? null,
      tags: options?.tags ?? null,
      title: params.title ?? null,
      userId: this.userId,
    } satisfies typeof userMemories.$inferInsert;
  }

  create = async (params: CreateUserMemoryParams): Promise<UserMemoryItem> => {
    const [result] = await this.db
      .insert(userMemories)
      .values(this.buildBaseMemoryInsertValues(params))
      .returning();

    return result;
  };

  createContextMemory = async (
    params: CreateUserMemoryContextParams,
  ): Promise<{ context: UserMemoryContext; memory: UserMemoryItem }> => {
    return this.db.transaction(async (tx) => {
      const baseValues = this.buildBaseMemoryInsertValues(params, {
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
        metadata: params.context.metadata ?? null,
        scoreImpact: params.context.scoreImpact ?? null,
        scoreUrgency: params.context.scoreUrgency ?? null,
        tags: params.context.tags ?? [],
        title: params.context.title ?? null,
        type: params.context.type ?? null,
        userId: this.userId,
        userMemoryIds: [memory.id],
      } satisfies typeof userMemoriesContexts.$inferInsert;

      const [context] = await tx.insert(userMemoriesContexts).values(contextValues).returning();

      return { context, memory };
    });
  };

  createExperienceMemory = async (
    params: CreateUserMemoryExperienceParams,
  ): Promise<{ experience: UserMemoryExperience; memory: UserMemoryItem }> => {
    return this.db.transaction(async (tx) => {
      const baseValues = this.buildBaseMemoryInsertValues(params, {
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
        userId: this.userId,
        userMemoryId: memory.id,
      } satisfies typeof userMemoriesExperiences.$inferInsert;

      const [experience] = await tx
        .insert(userMemoriesExperiences)
        .values(experienceValues)
        .returning();

      return { experience, memory };
    });
  };

  createActivityMemory = async (
    params: CreateUserMemoryActivityParams,
  ): Promise<{ activity: UserMemoryActivity; memory: UserMemoryItem }> => {
    return this.db.transaction(async (tx) => {
      const baseValues = this.buildBaseMemoryInsertValues(params, {
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
        endsAt: coerceDate(params.activity.endsAt),
        feedback: params.activity.feedback ?? null,
        feedbackVector: params.activity.feedbackVector ?? null,
        metadata: params.activity.metadata ?? null,
        narrative: params.activity.narrative ?? null,
        narrativeVector: params.activity.narrativeVector ?? null,
        notes: params.activity.notes ?? null,
        startsAt: coerceDate(params.activity.startsAt),
        status: params.activity.status ?? null,
        tags: params.activity.tags ?? [],
        timezone: params.activity.timezone ?? null,
        type: params.activity.type ?? ActivityTypeEnum.Other,
        userId: this.userId,
        userMemoryId: memory.id,
      } satisfies typeof userMemoriesActivities.$inferInsert;

      const [activity] = await tx.insert(userMemoriesActivities).values(activityValues).returning();

      return { activity, memory };
    });
  };

  createPreferenceMemory = async (
    params: CreateUserMemoryPreferenceParams,
  ): Promise<{ memory: UserMemoryItem; preference: UserMemoryPreference }> => {
    return this.db.transaction(async (tx) => {
      const baseValues = this.buildBaseMemoryInsertValues(params, {
        metadata: params.preference.metadata ?? null,
        tags: params.preference.tags ?? null,
      });

      const [memory] = await tx.insert(userMemories).values(baseValues).returning();
      if (!memory) throw new Error('Failed to create user memory preference');

      const preferenceValues = {
        capturedAt: params.preference.capturedAt,
        conclusionDirectives: params.preference.conclusionDirectives ?? null,
        conclusionDirectivesVector: params.preference.conclusionDirectivesVector ?? null,
        metadata: params.preference.metadata ?? null,
        scorePriority: params.preference.scorePriority ?? null,
        suggestions: params.preference.suggestions ?? null,
        tags: params.preference.tags ?? [],
        type: params.preference.type ?? params.memoryType ?? null,
        userId: this.userId,
        userMemoryId: memory.id,
      } satisfies typeof userMemoriesPreferences.$inferInsert;

      const [preference] = await tx
        .insert(userMemoriesPreferences)
        .values(preferenceValues)
        .returning();

      return { memory, preference };
    });
  };

  search = async (params: SearchUserMemoryParams): Promise<UserMemorySearchAggregatedResult> => {
    const { embedding, limits } = params;

    const resolvedLimits = {
      activities: limits?.activities,
      contexts: limits?.contexts,
      experiences: limits?.experiences,
      preferences: limits?.preferences,
    };

    const [experiences, contexts, preferences, activities] = await Promise.all([
      this.searchExperiences({
        embedding,
        limit: resolvedLimits.experiences,
      }),
      this.searchContexts({
        embedding,
        limit: resolvedLimits.contexts,
      }),
      this.searchPreferences({
        embedding,
        limit: resolvedLimits.preferences,
      }),
      this.searchActivities({
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
      await this.updateAccessMetrics([...accessedMemoryIds], {
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

  searchWithEmbedding = async (
    params: SearchUserMemoryWithEmbeddingParams,
  ): Promise<UserMemorySearchAggregatedResult> => {
    return this.search(params);
  };

  queryTags = async (params: QueryTagsParams = {}): Promise<QueryTagsResult[]> => {
    const { layers, page = 1, size = 10 } = params;
    const offset = (page - 1) * size;

    const conditions = [eq(userMemories.userId, this.userId)];
    if (layers && layers.length > 0) {
      conditions.push(inArray(userMemories.memoryLayer, layers));
    }

    const unnestedTags = this.db.$with('unnested_tags').as(
      this.db
        .select({
          tag: sql<string>`UNNEST(${userMemories.tags})`.as('tag'),
        })
        .from(userMemories)
        .where(and(...conditions)),
    );

    const result = await this.db
      .with(unnestedTags)
      .select({
        count: sql<number>`COUNT(${unnestedTags.tag})::int`.as('count'),
        tag: unnestedTags.tag,
      })
      .from(unnestedTags)
      .where(and(isNotNull(unnestedTags.tag), ne(unnestedTags.tag, '')))
      .groupBy(unnestedTags.tag)
      .orderBy(desc(sql<number>`count`))
      .limit(size)
      .offset(offset);

    return result as QueryTagsResult[];
  };

  queryIdentityRoles = async (
    params: QueryIdentityRolesParams = {},
  ): Promise<QueryIdentityRolesResult> => {
    const { page = 1, size = 10 } = params;
    const offset = (page - 1) * size;

    const identityConditions = [
      eq(userMemoriesIdentities.userId, this.userId),
      eq(userMemoriesIdentities.relationship, RelationshipEnum.Self),
    ];

    const identityTags = this.db.$with('identity_tags').as(
      this.db
        .select({
          tag: sql<string>`UNNEST(${userMemoriesIdentities.tags})`.as('tag'),
        })
        .from(userMemoriesIdentities)
        .where(and(...identityConditions)),
    );

    const [tags, roles] = await Promise.all([
      this.db
        .with(identityTags)
        .select({
          count: sql<number>`COUNT(${identityTags.tag})::int`.as('count'),
          tag: identityTags.tag,
        })
        .from(identityTags)
        .where(and(isNotNull(identityTags.tag), ne(identityTags.tag, '')))
        .groupBy(identityTags.tag)
        .orderBy(desc(sql<number>`count`))
        .limit(size)
        .offset(offset),
      this.db
        .select({
          count: sql<number>`COUNT(${userMemoriesIdentities.role})::int`.as('count'),
          role: userMemoriesIdentities.role,
        })
        .from(userMemoriesIdentities)
        .where(
          and(
            ...identityConditions,
            isNotNull(userMemoriesIdentities.role),
            ne(userMemoriesIdentities.role, ''),
          ),
        )
        .groupBy(userMemoriesIdentities.role)
        .orderBy(desc(sql<number>`count`))
        .limit(size)
        .offset(offset),
    ]);

    return {
      roles: roles as QueryIdentityRolesResult['roles'],
      tags: tags as QueryIdentityRolesResult['tags'],
    };
  };

  // TODO(@nekomeowww): should use L & R generic for helping to determine what result type to return
  queryMemories = async (params: QueryUserMemoriesParams = {}): Promise<GetMemoriesResult> => {
    const {
      categories,
      layer,
      order = 'desc',
      page = 1,
      pageSize = 20,
      q,
      sort,
      status,
      tags,
      types,
    } = params;

    const resolvedPage = page ?? 1;
    const resolvedPageSize = pageSize ?? 20;
    const normalizedPage = Math.max(1, resolvedPage);
    const normalizedPageSize = Math.min(Math.max(resolvedPageSize, 1), 100);
    const offset = (normalizedPage - 1) * normalizedPageSize;

    const normalizedQuery = typeof q === 'string' ? q.trim() : '';
    const resolvedLayer = layer ?? LayersEnum.Context;

    const conditions: Array<SQL | undefined> = [
      eq(userMemories.userId, this.userId),
      categories && categories.length > 0
        ? inArray(userMemories.memoryCategory, categories)
        : undefined,
      eq(userMemories.memoryLayer, resolvedLayer),
      normalizedQuery
        ? or(
            ilike(userMemories.title, `%${normalizedQuery}%`),
            ilike(userMemories.summary, `%${normalizedQuery}%`),
            ilike(userMemories.details, `%${normalizedQuery}%`),
          )
        : undefined,
    ];

    const filters = conditions.filter((condition): condition is SQL => condition !== undefined);
    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const applyOrder = order === 'asc' ? asc : desc;

    const baseSelection = {
      accessedAt: userMemories.accessedAt,
      accessedCount: userMemories.accessedCount,
      createdAt: userMemories.createdAt,
      id: userMemories.id,
      lastAccessedAt: userMemories.lastAccessedAt,
      memoryCategory: userMemories.memoryCategory,
      memoryLayer: userMemories.memoryLayer,
      memoryType: userMemories.memoryType,
      metadata: userMemories.metadata,
      status: userMemories.status,
      tags: userMemories.tags,
      title: userMemories.title,
      updatedAt: userMemories.updatedAt,
      userId: userMemories.userId,
    };

    const buildOrderBy = (
      scoreColumn: SQL | AnyColumn | undefined,
      updatedAtColumn: AnyColumn | SQL,
      createdAtColumn: AnyColumn | SQL,
    ) =>
      [
        scoreColumn ? applyOrder(scoreColumn) : undefined,
        applyOrder(updatedAtColumn),
        applyOrder(createdAtColumn),
      ].filter((item): item is SQL => item !== undefined);

    switch (resolvedLayer) {
      case LayersEnum.Context: {
        const scoreColumn =
          sort === 'scoreUrgency'
            ? userMemoriesContexts.scoreUrgency
            : sort === 'scoreImpact'
              ? userMemoriesContexts.scoreImpact
              : userMemoriesContexts.capturedAt;

        const orderByClauses = buildOrderBy(
          scoreColumn,
          userMemoriesContexts.updatedAt,
          userMemoriesContexts.createdAt,
        );
        const joinCondition = and(
          eq(userMemories.userId, userMemoriesContexts.userId),
          // Use jsonb key-existence (jsonb_exists) to check membership without expanding the array
          sql<boolean>`
            COALESCE(${userMemoriesContexts.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text
          `,
        );

        const contextFilters: Array<SQL | undefined> = [
          whereClause,
          types && types.length > 0 ? inArray(userMemoriesContexts.type, types) : undefined,
          tags && tags.length > 0
            ? or(
                ...tags.map(
                  (tag) =>
                    sql<boolean>`
                      COALESCE(${tag} = ANY(${userMemoriesContexts.tags}), false)
                      OR COALESCE(${tag} = ANY(${userMemories.tags}), false)
                    `,
                ),
              )
            : undefined,
        ];
        const contextWhereClause = contextFilters.some(
          (condition): condition is SQL => condition !== undefined,
        )
          ? and(
              ...(contextFilters.filter(
                (condition): condition is SQL => condition !== undefined,
              ) as SQL[]),
            )
          : undefined;

        const [rows, totalResult] = await Promise.all([
          this.db
            .select({
              context: {
                accessedAt: userMemoriesContexts.accessedAt,
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
              },
              memory: baseSelection,
            })
            .from(userMemories)
            .innerJoin(userMemoriesContexts, joinCondition)
            .where(contextWhereClause)
            .orderBy(...orderByClauses)
            .limit(normalizedPageSize)
            .offset(offset),
          this.db
            .select({ count: sql<number>`COUNT(DISTINCT ${userMemories.id})::int` })
            .from(userMemories)
            .innerJoin(userMemoriesContexts, joinCondition)
            .where(contextWhereClause),
        ]);

        return {
          items: rows.map((row) => {
            return {
              context: row.context,
              layer: LayersEnum.Context,
              memory: row.memory,
            };
          }),
          page: normalizedPage,
          pageSize: normalizedPageSize,
          total: Number(totalResult[0]?.count ?? 0),
        };
      }
      case LayersEnum.Activity: {
        const sortColumn =
          sort === 'startsAt' ? userMemoriesActivities.startsAt : userMemoriesActivities.capturedAt;

        const orderByClauses = buildOrderBy(
          sortColumn,
          userMemoriesActivities.updatedAt,
          userMemoriesActivities.createdAt,
        );
        const joinCondition = and(
          eq(userMemories.id, userMemoriesActivities.userMemoryId),
          eq(userMemoriesActivities.userId, this.userId),
        );

        const activityFilters: Array<SQL | undefined> = [
          whereClause,
          types && types.length > 0 ? inArray(userMemoriesActivities.type, types) : undefined,
          status && status.length > 0 ? inArray(userMemoriesActivities.status, status) : undefined,
          tags && tags.length > 0
            ? or(
                ...tags.map(
                  (tag) =>
                    sql<boolean>`
                      COALESCE(${tag} = ANY(${userMemoriesActivities.tags}), false)
                      OR COALESCE(${tag} = ANY(${userMemories.tags}), false)
                    `,
                ),
              )
            : undefined,
        ];
        const activityWhereClause = activityFilters.some(
          (condition): condition is SQL => condition !== undefined,
        )
          ? and(
              ...(activityFilters.filter(
                (condition): condition is SQL => condition !== undefined,
              ) as SQL[]),
            )
          : undefined;

        const [rows, totalResult] = await Promise.all([
          this.db
            .select({
              activity: {
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
                startsAt: userMemoriesActivities.startsAt,
                status: userMemoriesActivities.status,
                tags: userMemoriesActivities.tags,
                timezone: userMemoriesActivities.timezone,
                type: userMemoriesActivities.type,
                updatedAt: userMemoriesActivities.updatedAt,
                userId: userMemoriesActivities.userId,
                userMemoryId: userMemoriesActivities.userMemoryId,
              },
              memory: baseSelection,
            })
            .from(userMemories)
            .innerJoin(userMemoriesActivities, joinCondition)
            .where(activityWhereClause)
            .orderBy(...orderByClauses)
            .limit(normalizedPageSize)
            .offset(offset),
          this.db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(userMemories)
            .innerJoin(userMemoriesActivities, joinCondition)
            .where(activityWhereClause),
        ]);

        return {
          items: rows.map((row) => {
            return {
              activity: row.activity,
              layer: LayersEnum.Activity,
              memory: row.memory,
            };
          }),
          page: normalizedPage,
          pageSize: normalizedPageSize,
          total: Number(totalResult[0]?.count ?? 0),
        };
      }
      case LayersEnum.Experience: {
        const scoreColumn =
          sort === 'scoreConfidence'
            ? userMemoriesExperiences.scoreConfidence
            : userMemoriesExperiences.capturedAt;

        const orderByClauses = buildOrderBy(
          scoreColumn,
          userMemoriesExperiences.updatedAt,
          userMemoriesExperiences.createdAt,
        );
        const joinCondition = and(
          eq(userMemories.id, userMemoriesExperiences.userMemoryId),
          eq(userMemoriesExperiences.userId, this.userId),
        );

        const experienceFilters: Array<SQL | undefined> = [
          whereClause,
          types && types.length > 0 ? inArray(userMemoriesExperiences.type, types) : undefined,
          tags && tags.length > 0
            ? or(...tags.map((tag) => sql<boolean>`${tag} = ANY(${userMemoriesExperiences.tags})`))
            : undefined,
        ];
        const experienceWhereClause = experienceFilters.some(
          (condition): condition is SQL => condition !== undefined,
        )
          ? and(
              ...(experienceFilters.filter(
                (condition): condition is SQL => condition !== undefined,
              ) as SQL[]),
            )
          : undefined;

        const [rows, totalResult] = await Promise.all([
          this.db
            .select({
              experience: {
                accessedAt: userMemoriesExperiences.accessedAt,
                action: userMemoriesExperiences.action,
                createdAt: userMemoriesExperiences.createdAt,
                id: userMemoriesExperiences.id,
                keyLearning: userMemoriesExperiences.keyLearning,
                metadata: userMemoriesExperiences.metadata,
                scoreConfidence: userMemoriesExperiences.scoreConfidence,
                situation: userMemoriesExperiences.situation,
                tags: userMemoriesExperiences.tags,
                type: userMemoriesExperiences.type,
                updatedAt: userMemoriesExperiences.updatedAt,
                userId: userMemoriesExperiences.userId,
                userMemoryId: userMemoriesExperiences.userMemoryId,
              },
              memory: baseSelection,
            })
            .from(userMemories)
            .innerJoin(userMemoriesExperiences, joinCondition)
            .where(experienceWhereClause)
            .orderBy(...orderByClauses)
            .limit(normalizedPageSize)
            .offset(offset),
          this.db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(userMemories)
            .innerJoin(userMemoriesExperiences, joinCondition)
            .where(experienceWhereClause),
        ]);

        return {
          items: rows.map((row) => {
            return {
              experience: row.experience,
              layer: LayersEnum.Experience,
              memory: row.memory,
            };
          }),
          page: normalizedPage,
          pageSize: normalizedPageSize,
          total: Number(totalResult[0]?.count ?? 0),
        };
      }
      case LayersEnum.Identity: {
        const orderByClauses = buildOrderBy(
          undefined,
          userMemoriesIdentities.capturedAt,
          userMemoriesIdentities.createdAt,
        );
        const joinCondition = and(
          eq(userMemories.id, userMemoriesIdentities.userMemoryId),
          eq(userMemoriesIdentities.userId, this.userId),
        );

        const identityFilters: Array<SQL | undefined> = [
          whereClause,
          types && types.length > 0 ? inArray(userMemoriesIdentities.type, types) : undefined,
          tags && tags.length > 0
            ? or(...tags.map((tag) => sql<boolean>`${tag} = ANY(${userMemoriesIdentities.tags})`))
            : undefined,
        ];
        const identityWhereClause = identityFilters.some(
          (condition): condition is SQL => condition !== undefined,
        )
          ? and(
              ...(identityFilters.filter(
                (condition): condition is SQL => condition !== undefined,
              ) as SQL[]),
            )
          : undefined;

        const [rows, totalResult] = await Promise.all([
          this.db
            .select({
              identity: {
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
                title: userMemories.title,
                type: userMemoriesIdentities.type,
                updatedAt: userMemoriesIdentities.updatedAt,
                userId: userMemoriesIdentities.userId,
                userMemoryId: userMemoriesIdentities.userMemoryId,
              },
              memory: baseSelection,
            })
            .from(userMemories)
            .innerJoin(userMemoriesIdentities, joinCondition)
            .where(identityWhereClause)
            .orderBy(...orderByClauses)
            .limit(normalizedPageSize)
            .offset(offset),
          this.db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(userMemories)
            .innerJoin(userMemoriesIdentities, joinCondition)
            .where(identityWhereClause),
        ]);

        return {
          items: rows.map((row) => {
            return {
              identity: row.identity,
              layer: LayersEnum.Identity,
              memory: row.memory,
            };
          }),
          page: normalizedPage,
          pageSize: normalizedPageSize,
          total: Number(totalResult[0]?.count ?? 0),
        };
      }
      case LayersEnum.Preference: {
        const scoreColumn =
          sort === 'scorePriority'
            ? userMemoriesPreferences.scorePriority
            : userMemoriesPreferences.capturedAt;

        const orderByClauses = buildOrderBy(
          scoreColumn,
          userMemoriesPreferences.updatedAt,
          userMemoriesPreferences.createdAt,
        );
        const joinCondition = and(
          eq(userMemories.id, userMemoriesPreferences.userMemoryId),
          eq(userMemoriesPreferences.userId, this.userId),
        );

        const preferenceFilters: Array<SQL | undefined> = [
          whereClause,
          types && types.length > 0 ? inArray(userMemoriesPreferences.type, types) : undefined,
          tags && tags.length > 0
            ? or(...tags.map((tag) => sql<boolean>`${tag} = ANY(${userMemoriesPreferences.tags})`))
            : undefined,
        ];
        const preferenceWhereClause = preferenceFilters.some(
          (condition): condition is SQL => condition !== undefined,
        )
          ? and(
              ...(preferenceFilters.filter(
                (condition): condition is SQL => condition !== undefined,
              ) as SQL[]),
            )
          : undefined;

        const [rows, totalResult] = await Promise.all([
          this.db
            .select({
              memory: baseSelection,
              preference: {
                accessedAt: userMemoriesPreferences.accessedAt,
                conclusionDirectives: userMemoriesPreferences.conclusionDirectives,
                createdAt: userMemoriesPreferences.createdAt,
                id: userMemoriesPreferences.id,
                metadata: userMemoriesPreferences.metadata,
                scorePriority: userMemoriesPreferences.scorePriority,
                tags: userMemoriesPreferences.tags,
                type: userMemoriesPreferences.type,
                updatedAt: userMemoriesPreferences.updatedAt,
                userId: userMemoriesPreferences.userId,
                userMemoryId: userMemoriesPreferences.userMemoryId,
              },
            })
            .from(userMemories)
            .innerJoin(userMemoriesPreferences, joinCondition)
            .where(preferenceWhereClause)
            .orderBy(...orderByClauses)
            .limit(normalizedPageSize)
            .offset(offset),
          this.db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(userMemories)
            .innerJoin(userMemoriesPreferences, joinCondition)
            .where(preferenceWhereClause),
        ]);

        return {
          items: rows.map((row) => {
            return {
              layer: LayersEnum.Preference,
              memory: row.memory,
              preference: row.preference,
            };
          }),
          page: normalizedPage,
          pageSize: normalizedPageSize,
          total: Number(totalResult[0]?.count ?? 0),
        };
      }
      default: {
        return {
          items: [],
          page: normalizedPage,
          pageSize: normalizedPageSize,
          total: 0,
        };
      }
    }
  };

  /**
   * NOTICE: internal service / backend / data aggregation use only, for most of the UI related use-cases,
   * please use `queryMemories` method instead.
   */
  listMemories = async <
    L extends LayersEnum,
    R extends UserMemoryDetail = L extends LayersEnum.Context
      ? UserMemoryDetail & { context: UserMemoryContext; layer: LayersEnum.Context }
      : L extends LayersEnum.Experience
        ? UserMemoryDetail & { experience: UserMemoryExperience; layer: LayersEnum.Experience }
        : L extends LayersEnum.Identity
          ? UserMemoryDetail & { identity: UserMemoryIdentity; layer: LayersEnum.Identity }
          : L extends LayersEnum.Preference
            ? UserMemoryDetail & { layer: LayersEnum.Preference; preference: UserMemoryPreference }
            : L extends LayersEnum.Activity
              ? UserMemoryDetail & { activity: UserMemoryActivity; layer: LayersEnum.Activity }
              : never,
  >(params: {
    layer?: L;
    order?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  }): Promise<R[]> => {
    const { layer = LayersEnum.Context, order = 'desc', page = 1, pageSize = 20 } = params;

    const normalizedPage = Math.max(1, page ?? 1);
    const normalizedPageSize = Math.min(Math.max(pageSize ?? 20, 1), 100);
    const offset = (normalizedPage - 1) * normalizedPageSize;
    const applyOrder = order === 'asc' ? asc : desc;

    const baseSelection = selectNonVectorColumns(userMemories);
    const contextSelection = selectNonVectorColumns(userMemoriesContexts);
    const experienceSelection = selectNonVectorColumns(userMemoriesExperiences);
    const identitySelection = selectNonVectorColumns(userMemoriesIdentities);
    const preferenceSelection = selectNonVectorColumns(userMemoriesPreferences);
    // TODO(@nekomeowww): activity
    // eslint-disable-next-line unused-imports/no-unused-vars
    const activitySelection = selectNonVectorColumns(userMemoriesActivities);

    const baseConditions: Array<SQL | undefined> = [
      eq(userMemories.userId, this.userId),
      eq(userMemories.memoryLayer, layer),
    ];
    const baseWhere = baseConditions.filter(Boolean) as SQL[];

    const buildOrderBy = (updatedAtColumn: AnyColumn | SQL, createdAtColumn: AnyColumn | SQL) =>
      [applyOrder(updatedAtColumn), applyOrder(createdAtColumn)].filter(
        (item): item is SQL => item !== undefined,
      );

    switch (layer) {
      case LayersEnum.Context: {
        const orderByClauses = buildOrderBy(
          userMemoriesContexts.updatedAt,
          userMemoriesContexts.createdAt,
        );
        const joinCondition = and(
          eq(userMemories.userId, userMemoriesContexts.userId),
          sql<boolean>`
            COALESCE(${userMemoriesContexts.userMemoryIds}, '[]'::jsonb) ? (${userMemories.id})::text
          `,
        );

        const contextFilters: Array<SQL | undefined> = [
          baseWhere.length ? and(...baseWhere) : undefined,
        ];
        const contextWhere = contextFilters.filter(Boolean) as SQL[];

        const rows = await this.db
          .select({
            context: contextSelection,
            memory: baseSelection,
          })
          .from(userMemories)
          .innerJoin(userMemoriesContexts, joinCondition)
          .where(contextWhere.length ? and(...contextWhere) : undefined)
          .orderBy(...orderByClauses)
          .limit(normalizedPageSize)
          .offset(offset);

        return rows.map((row) => ({
          context: row.context,
          layer: LayersEnum.Context,
          memory: row.memory,
        })) as unknown as R[];
      }
      case LayersEnum.Experience: {
        const orderByClauses = buildOrderBy(
          userMemoriesExperiences.updatedAt,
          userMemoriesExperiences.createdAt,
        );
        const joinCondition = and(
          eq(userMemories.id, userMemoriesExperiences.userMemoryId),
          eq(userMemoriesExperiences.userId, this.userId),
        );

        const experienceFilters: Array<SQL | undefined> = [
          baseWhere.length ? and(...baseWhere) : undefined,
        ];
        const experienceWhere = experienceFilters.filter(Boolean) as SQL[];

        const rows = await this.db
          .select({
            experience: experienceSelection,
            memory: baseSelection,
          })
          .from(userMemories)
          .innerJoin(userMemoriesExperiences, joinCondition)
          .where(experienceWhere.length ? and(...experienceWhere) : undefined)
          .orderBy(...orderByClauses)
          .limit(normalizedPageSize)
          .offset(offset);

        return rows.map((row) => ({
          experience: row.experience,
          layer: LayersEnum.Experience,
          memory: row.memory,
        })) as unknown as R[];
      }
      case LayersEnum.Identity: {
        const orderByClauses = buildOrderBy(
          userMemoriesIdentities.updatedAt,
          userMemoriesIdentities.createdAt,
        );
        const joinCondition = and(
          eq(userMemories.id, userMemoriesIdentities.userMemoryId),
          eq(userMemoriesIdentities.userId, this.userId),
        );

        const identityFilters: Array<SQL | undefined> = [
          baseWhere.length ? and(...baseWhere) : undefined,
        ];
        const identityWhere = identityFilters.filter(Boolean) as SQL[];

        const rows = await this.db
          .select({
            identity: identitySelection,
            memory: baseSelection,
          })
          .from(userMemories)
          .innerJoin(userMemoriesIdentities, joinCondition)
          .where(identityWhere.length ? and(...identityWhere) : undefined)
          .orderBy(...orderByClauses)
          .limit(normalizedPageSize)
          .offset(offset);

        return rows.map((row) => ({
          identity: row.identity,
          layer: LayersEnum.Identity,
          memory: row.memory,
        })) as unknown as R[];
      }
      case LayersEnum.Preference: {
        const orderByClauses = buildOrderBy(
          userMemoriesPreferences.updatedAt,
          userMemoriesPreferences.createdAt,
        );
        const joinCondition = and(
          eq(userMemories.id, userMemoriesPreferences.userMemoryId),
          eq(userMemoriesPreferences.userId, this.userId),
        );

        const preferenceFilters: Array<SQL | undefined> = [
          baseWhere.length ? and(...baseWhere) : undefined,
        ];
        const preferenceWhere = preferenceFilters.filter(Boolean) as SQL[];

        const rows = await this.db
          .select({
            memory: baseSelection,
            preference: preferenceSelection,
          })
          .from(userMemories)
          .innerJoin(userMemoriesPreferences, joinCondition)
          .where(preferenceWhere.length ? and(...preferenceWhere) : undefined)
          .orderBy(...orderByClauses)
          .limit(normalizedPageSize)
          .offset(offset);

        return rows.map((row) => ({
          layer: LayersEnum.Preference,
          memory: row.memory,
          preference: row.preference,
        })) as unknown as R[];
      }
    }

    return [];
  };

  getMemoryDetail = async (
    params: GetMemoryDetailParams,
  ): Promise<UserMemoryDetail | undefined> => {
    const { id, layer } = params;

    switch (layer) {
      case LayersEnum.Context: {
        const [context] = await this.db
          .select({
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
          .where(and(eq(userMemoriesContexts.id, id), eq(userMemoriesContexts.userId, this.userId)))
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

        const memory = await this.findUserMemoryRawById(memoryId);
        if (!memory) {
          return undefined;
        }
        if (memory.memoryLayer !== LayersEnum.Context) {
          return undefined;
        }

        const { sourceId, sourceType } = await this.extractSourceMetadata(context.metadata);
        const source = sourceId ? await this.topicModel.findById(sourceId) : undefined;

        return {
          context: context as UserMemoryContextWithoutVectors,
          layer,
          memory,
          source,
          sourceType,
        };
      }
      case LayersEnum.Activity: {
        const [activity] = await this.db
          .select({
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
          .where(
            and(eq(userMemoriesActivities.id, id), eq(userMemoriesActivities.userId, this.userId)),
          )
          .limit(1);
        if (!activity?.userMemoryId) {
          return undefined;
        }

        const memory = await this.findUserMemoryRawById(activity.userMemoryId);
        if (!memory) {
          return undefined;
        }
        if (memory.memoryLayer !== LayersEnum.Activity) {
          return undefined;
        }

        const { sourceId, sourceType } = await this.extractSourceMetadata(activity.metadata);
        const source = sourceId ? await this.topicModel.findById(sourceId) : undefined;

        return {
          activity,
          layer,
          memory,
          source,
          sourceType,
        };
      }
      case LayersEnum.Experience: {
        const [experience] = await this.db
          .select({
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
          .where(
            and(
              eq(userMemoriesExperiences.id, id),
              eq(userMemoriesExperiences.userId, this.userId),
            ),
          )
          .limit(1);
        if (!experience?.userMemoryId) {
          return undefined;
        }

        const memory = await this.findUserMemoryRawById(experience.userMemoryId);
        if (!memory) {
          return undefined;
        }
        if (memory.memoryLayer !== LayersEnum.Experience) {
          return undefined;
        }

        const { sourceId, sourceType } = await this.extractSourceMetadata(experience.metadata);
        const source = sourceId ? await this.topicModel.findById(sourceId) : undefined;

        return {
          experience,
          layer,
          memory,
          source,
          sourceType,
        };
      }
      case LayersEnum.Identity: {
        const [identity] = await this.db
          .select({
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
          .where(
            and(eq(userMemoriesIdentities.id, id), eq(userMemoriesIdentities.userId, this.userId)),
          )
          .limit(1);
        if (!identity?.userMemoryId) {
          return undefined;
        }

        const memory = await this.findUserMemoryRawById(identity.userMemoryId);
        if (!memory) {
          return undefined;
        }
        if (memory.memoryLayer !== LayersEnum.Identity) {
          return undefined;
        }

        const { sourceId, sourceType } = await this.extractSourceMetadata(identity.metadata);
        const source = sourceId ? await this.topicModel.findById(sourceId) : undefined;

        return {
          identity,
          layer,
          memory,
          source,
          sourceType,
        };
      }
      case LayersEnum.Preference: {
        const [preference] = await this.db
          .select({
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
          .where(
            and(
              eq(userMemoriesPreferences.id, id),
              eq(userMemoriesPreferences.userId, this.userId),
            ),
          )
          .limit(1);
        if (!preference?.userMemoryId) {
          return undefined;
        }

        const memory = await this.findUserMemoryRawById(preference.userMemoryId);
        if (!memory) {
          return undefined;
        }
        if (memory.memoryLayer !== LayersEnum.Preference) {
          return undefined;
        }

        const { sourceId, sourceType } = await this.extractSourceMetadata(preference.metadata);
        const source = sourceId ? await this.topicModel.findById(sourceId) : undefined;

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

  private findUserMemoryRawById = async (
    memoryId: string,
  ): Promise<UserMemoryWithoutVectors | undefined> => {
    const [memory] = await this.db
      .select({
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
      .where(and(eq(userMemories.id, memoryId), eq(userMemories.userId, this.userId)))
      .limit(1);
    if (!memory) {
      return undefined;
    }

    return memory;
  };

  findById = async (id: string): Promise<UserMemoryItem | undefined> => {
    const result = await this.db.query.userMemories.findFirst({
      where: and(eq(userMemories.id, id), eq(userMemories.userId, this.userId)),
    });

    if (result) {
      await this.updateAccessMetrics([id]);
    }

    return result;
  };

  update = async (id: string, params: Partial<CreateUserMemoryParams>): Promise<void> => {
    await this.db
      .update(userMemories)
      .set({ ...params, updatedAt: new Date() })
      .where(and(eq(userMemories.id, id), eq(userMemories.userId, this.userId)));
  };

  updateUserMemoryVectors = async (
    id: string,
    vectors: UpdateUserMemoryVectorsParams,
  ): Promise<void> => {
    const vectorUpdates: Partial<typeof userMemories.$inferInsert> = {};
    if (vectors.detailsVector1024 !== undefined) {
      vectorUpdates.detailsVector1024 = vectors.detailsVector1024;
    }
    if (vectors.summaryVector1024 !== undefined) {
      vectorUpdates.summaryVector1024 = vectors.summaryVector1024;
    }

    if (Object.keys(vectorUpdates).length === 0) {
      return;
    }

    await this.db
      .update(userMemories)
      .set({
        ...vectorUpdates,
        updatedAt: new Date(),
      })
      .where(and(eq(userMemories.id, id), eq(userMemories.userId, this.userId)));
  };

  updateContextVectors = async (id: string, vectors: UpdateContextVectorsParams): Promise<void> => {
    const vectorUpdates: Partial<typeof userMemoriesContexts.$inferInsert> = {};
    if (vectors.descriptionVector !== undefined) {
      vectorUpdates.descriptionVector = vectors.descriptionVector;
    }
    if (Object.keys(vectorUpdates).length === 0) {
      return;
    }

    await this.db
      .update(userMemoriesContexts)
      .set({
        ...vectorUpdates,
        updatedAt: new Date(),
      })
      .where(and(eq(userMemoriesContexts.id, id), eq(userMemoriesContexts.userId, this.userId)));
  };

  updatePreferenceVectors = async (
    id: string,
    vectors: UpdatePreferenceVectorsParams,
  ): Promise<void> => {
    const vectorUpdates: Partial<typeof userMemoriesPreferences.$inferInsert> = {};
    if (vectors.conclusionDirectivesVector !== undefined) {
      vectorUpdates.conclusionDirectivesVector = vectors.conclusionDirectivesVector;
    }

    if (Object.keys(vectorUpdates).length === 0) {
      return;
    }

    await this.db
      .update(userMemoriesPreferences)
      .set({
        ...vectorUpdates,
        updatedAt: new Date(),
      })
      .where(
        and(eq(userMemoriesPreferences.id, id), eq(userMemoriesPreferences.userId, this.userId)),
      );
  };

  updateIdentityVectors = async (
    id: string,
    vectors: UpdateIdentityVectorsParams,
  ): Promise<void> => {
    const vectorUpdates: Partial<typeof userMemoriesIdentities.$inferInsert> = {};
    if (vectors.descriptionVector !== undefined) {
      vectorUpdates.descriptionVector = vectors.descriptionVector;
    }

    if (Object.keys(vectorUpdates).length === 0) {
      return;
    }

    await this.db
      .update(userMemoriesIdentities)
      .set({
        ...vectorUpdates,
        updatedAt: new Date(),
      })
      .where(
        and(eq(userMemoriesIdentities.id, id), eq(userMemoriesIdentities.userId, this.userId)),
      );
  };

  updateExperienceVectors = async (
    id: string,
    vectors: UpdateExperienceVectorsParams,
  ): Promise<void> => {
    const vectorUpdates: Partial<typeof userMemoriesExperiences.$inferInsert> = {};
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

    await this.db
      .update(userMemoriesExperiences)
      .set({
        ...vectorUpdates,
        updatedAt: new Date(),
      })
      .where(
        and(eq(userMemoriesExperiences.id, id), eq(userMemoriesExperiences.userId, this.userId)),
      );
  };

  updateActivityVectors = async (
    id: string,
    vectors: { feedbackVector?: number[] | null; narrativeVector?: number[] | null },
  ): Promise<void> => {
    const vectorUpdates: Partial<typeof userMemoriesActivities.$inferInsert> = {};
    if (vectors.feedbackVector !== undefined) {
      vectorUpdates.feedbackVector = vectors.feedbackVector;
    }
    if (vectors.narrativeVector !== undefined) {
      vectorUpdates.narrativeVector = vectors.narrativeVector;
    }

    if (Object.keys(vectorUpdates).length === 0) {
      return;
    }

    await this.db
      .update(userMemoriesActivities)
      .set({
        ...vectorUpdates,
        updatedAt: new Date(),
      })
      .where(
        and(eq(userMemoriesActivities.id, id), eq(userMemoriesActivities.userId, this.userId)),
      );
  };

  addIdentityEntry = async (params: AddIdentityEntryParams): Promise<AddIdentityEntryResult> => {
    const now = new Date();

    return this.db.transaction(async (tx) => {
      const base = params.base ?? {};
      const baseValues: typeof userMemories.$inferInsert = {
        accessedCount: 0,
        capturedAt: base.capturedAt,
        details: base.details ?? null,
        detailsVector1024: base.detailsVector1024 ?? null,
        lastAccessedAt: coerceDate(base.lastAccessedAt) ?? now,
        memoryCategory: base.memoryCategory ?? null,
        memoryLayer: base.memoryLayer ?? 'identity',
        memoryType: base.memoryType ?? null,
        metadata: base.metadata ?? null,
        status: base.status === undefined ? 'active' : base.status,
        summary: base.summary ?? null,
        summaryVector1024: base.summaryVector1024 ?? null,
        tags: base.tags ?? null,
        title: base.title ?? null,
        userId: this.userId,
      };

      const [userMemoryRecord] = await tx
        .insert(userMemories)
        .values(baseValues)
        .returning({ id: userMemories.id });

      const identity = params.identity ?? {};
      const identityValues: typeof userMemoriesIdentities.$inferInsert = {
        capturedAt: identity.capturedAt,
        description: identity.description ?? null,
        descriptionVector: identity.descriptionVector ?? null,
        episodicDate:
          identity.episodicDate === undefined ? null : coerceDate(identity.episodicDate),
        metadata: identity.metadata ?? null,
        relationship:
          identity.relationship === undefined
            ? null
            : identity.relationship === null
              ? null
              : (normalizeRelationshipValue(identity.relationship) ?? null),
        role: identity.role ?? null,
        tags: identity.tags ?? null,
        type:
          identity.type === undefined
            ? null
            : identity.type === null
              ? null
              : (normalizeIdentityTypeValue(identity.type) ?? null),
        userId: this.userId,
        userMemoryId: userMemoryRecord.id,
      };

      const [identityRecord] = await tx
        .insert(userMemoriesIdentities)
        .values(identityValues)
        .returning({ id: userMemoriesIdentities.id });

      return {
        identityId: identityRecord.id,
        userMemoryId: userMemoryRecord.id,
      };
    });
  };

  updateIdentityEntry = async (params: UpdateIdentityEntryParams): Promise<boolean> => {
    const mergeStrategy = params.mergeStrategy ?? 'merge';

    return this.db.transaction(async (tx) => {
      const identity = await tx.query.userMemoriesIdentities.findFirst({
        where: and(
          eq(userMemoriesIdentities.id, params.identityId),
          eq(userMemoriesIdentities.userId, this.userId),
        ),
      });
      if (!identity || !identity.userMemoryId) {
        return false;
      }

      let baseUpdate: Partial<typeof userMemories.$inferInsert> = {};
      let identityUpdate: Partial<typeof userMemoriesIdentities.$inferInsert> = {};

      if (params.base) {
        baseUpdate = merge(baseUpdate, params.base);
        if (baseUpdate.lastAccessedAt !== undefined) {
          baseUpdate.lastAccessedAt = coerceDate(baseUpdate.lastAccessedAt) ?? new Date();
        }

        if (Object.keys(baseUpdate).length > 0) {
          baseUpdate.updatedAt = new Date();
          await tx
            .update(userMemories)
            .set(baseUpdate)
            .where(
              and(eq(userMemories.id, identity.userMemoryId), eq(userMemories.userId, this.userId)),
            );
        }
      }

      if (params.identity) {
        if (mergeStrategy === 'replace') {
          const identity = params.identity;

          identityUpdate = {
            capturedAt: identity.capturedAt,
            description: identity.description ?? null,
            descriptionVector: identity.descriptionVector ?? null,
            episodicDate:
              identity.episodicDate === undefined ? null : coerceDate(identity.episodicDate),
            metadata: identity.metadata ?? null,
            relationship:
              identity.relationship === undefined
                ? null
                : identity.relationship === null
                  ? null
                  : (normalizeRelationshipValue(identity.relationship) ?? null),
            role: identity.role ?? null,
            tags: identity.tags ?? null,
            type:
              identity.type === undefined
                ? null
                : identity.type === null
                  ? null
                  : (normalizeIdentityTypeValue(identity.type) ?? null),
          };
        } else {
          identityUpdate = merge(identityUpdate, params.identity);

          if (params.identity.type !== undefined) {
            identityUpdate.type =
              params.identity.type === null
                ? null
                : (normalizeIdentityTypeValue(params.identity.type) ?? null);
          }

          if (params.identity.relationship !== undefined) {
            identityUpdate.relationship =
              params.identity.relationship === null
                ? null
                : (normalizeRelationshipValue(params.identity.relationship) ?? null);
          }

          if (params.identity.episodicDate !== undefined) {
            identityUpdate.episodicDate = coerceDate(params.identity.episodicDate);
          }

          if (params.identity.capturedAt !== undefined) {
            identityUpdate.capturedAt = params.identity.capturedAt;
          }
        }

        if (Object.keys(identityUpdate).length > 0) {
          identityUpdate.updatedAt = new Date();
          await tx
            .update(userMemoriesIdentities)
            .set(identityUpdate)
            .where(
              and(
                eq(userMemoriesIdentities.id, params.identityId),
                eq(userMemoriesIdentities.userId, this.userId),
              ),
            );
        }
      }

      return true;
    });
  };

  removeIdentityEntry = async (identityId: string): Promise<boolean> => {
    return this.db.transaction(async (tx) => {
      const identity = await tx.query.userMemoriesIdentities.findFirst({
        where: and(
          eq(userMemoriesIdentities.id, identityId),
          eq(userMemoriesIdentities.userId, this.userId),
        ),
      });

      if (!identity || !identity.userMemoryId) {
        return false;
      }

      await tx
        .delete(userMemories)
        .where(
          and(eq(userMemories.id, identity.userMemoryId), eq(userMemories.userId, this.userId)),
        );

      return true;
    });
  };

  removeContextEntry = async (contextId: string): Promise<boolean> => {
    return this.db.transaction(async (tx) => {
      const context = await tx.query.userMemoriesContexts.findFirst({
        where: and(
          eq(userMemoriesContexts.id, contextId),
          eq(userMemoriesContexts.userId, this.userId),
        ),
      });

      if (!context) {
        return false;
      }

      // Delete associated user memories if any
      const memoryIds = Array.isArray(context.userMemoryIds)
        ? (context.userMemoryIds as string[])
        : [];
      if (memoryIds.length > 0) {
        await tx
          .delete(userMemories)
          .where(and(inArray(userMemories.id, memoryIds), eq(userMemories.userId, this.userId)));
      }

      // Delete the context entry
      await tx
        .delete(userMemoriesContexts)
        .where(
          and(eq(userMemoriesContexts.id, contextId), eq(userMemoriesContexts.userId, this.userId)),
        );

      return true;
    });
  };

  removeExperienceEntry = async (experienceId: string): Promise<boolean> => {
    return this.db.transaction(async (tx) => {
      const experience = await tx.query.userMemoriesExperiences.findFirst({
        where: and(
          eq(userMemoriesExperiences.id, experienceId),
          eq(userMemoriesExperiences.userId, this.userId),
        ),
      });

      if (!experience || !experience.userMemoryId) {
        return false;
      }

      // Delete the base user memory (cascade will handle the experience)
      await tx
        .delete(userMemories)
        .where(
          and(eq(userMemories.id, experience.userMemoryId), eq(userMemories.userId, this.userId)),
        );

      return true;
    });
  };

  removePreferenceEntry = async (preferenceId: string): Promise<boolean> => {
    return this.db.transaction(async (tx) => {
      const preference = await tx.query.userMemoriesPreferences.findFirst({
        where: and(
          eq(userMemoriesPreferences.id, preferenceId),
          eq(userMemoriesPreferences.userId, this.userId),
        ),
      });

      if (!preference || !preference.userMemoryId) {
        return false;
      }

      // Delete the base user memory (cascade will handle the preference)
      await tx
        .delete(userMemories)
        .where(
          and(eq(userMemories.id, preference.userMemoryId), eq(userMemories.userId, this.userId)),
        );

      return true;
    });
  };

  delete = async (id: string): Promise<void> => {
    await this.db
      .delete(userMemories)
      .where(and(eq(userMemories.id, id), eq(userMemories.userId, this.userId)));
  };

  deleteAll = async (): Promise<void> => {
    await this.db.delete(userMemories).where(eq(userMemories.userId, this.userId));
  };

  searchActivities = async (params: {
    embedding?: number[];
    limit?: number;
    type?: string;
  }): Promise<UserMemoryActivitiesWithoutVectors[]> => {
    const { embedding, limit = 5, type } = params;
    if (limit <= 0) {
      return [];
    }

    let query = this.db
      .select({
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

    const conditions = [eq(userMemoriesActivities.userId, this.userId)];
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

  searchContexts = async (params: {
    embedding?: number[];
    limit?: number;
    type?: string;
  }): Promise<UserMemoryContextWithoutVectors[]> => {
    const { embedding, limit = 5, type } = params;
    if (limit <= 0) {
      return [];
    }

    let query = this.db
      .select({
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

    const conditions = [eq(userMemoriesContexts.userId, this.userId)];
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

  searchExperiences = async (params: {
    embedding?: number[];
    limit?: number;
    type?: string;
  }): Promise<UserMemoryExperienceWithoutVectors[]> => {
    const { embedding, limit = 5, type } = params;
    if (limit <= 0) {
      return [];
    }

    let query = this.db
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

    const conditions = [eq(userMemoriesExperiences.userId, this.userId)];
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

  searchPreferences = async (params: {
    embedding?: number[];
    limit?: number;
    type?: string;
  }): Promise<UserMemoryPreferenceWithoutVectors[]> => {
    const { embedding, limit = 5, type } = params;
    if (limit <= 0) {
      return [];
    }

    let query = this.db
      .select({
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

    const conditions = [eq(userMemoriesPreferences.userId, this.userId)];
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

  getAllIdentities = async (): Promise<UserMemoryIdentityWithoutVectors[]> => {
    const res = await this.db
      .select(selectNonVectorColumns(userMemoriesIdentities))
      .from(userMemoriesIdentities)
      .where(eq(userMemoriesIdentities.userId, this.userId))
      .orderBy(desc(userMemoriesIdentities.capturedAt));

    return res;
  };

  getAllIdentitiesWithMemory = async () => {
    const res = await this.db
      .select({
        identity: selectNonVectorColumns(userMemoriesIdentities),
        memory: selectNonVectorColumns(userMemories),
      })
      .from(userMemoriesIdentities)
      .innerJoin(userMemories, eq(userMemories.id, userMemoriesIdentities.userMemoryId))
      .where(eq(userMemoriesIdentities.userId, this.userId))
      .orderBy(desc(userMemoriesIdentities.capturedAt));

    return res;
  };

  getIdentitiesByType = async (type: string): Promise<UserMemoryIdentityWithoutVectors[]> => {
    const res = await this.db
      .select(selectNonVectorColumns(userMemoriesIdentities))
      .from(userMemoriesIdentities)
      .where(
        and(eq(userMemoriesIdentities.userId, this.userId), eq(userMemoriesIdentities.type, type)),
      )
      .orderBy(desc(userMemoriesIdentities.capturedAt));

    return res;
  };

  private updateAccessMetrics = async (
    memoryIds: string[],
    options?: { contextIds?: string[]; timestamp?: Date },
  ): Promise<void> => {
    const contextIds = options?.contextIds ?? [];
    const orderedMemoryIds = memoryIds.length > 1 ? [...memoryIds].sort() : memoryIds;
    const orderedContextIds = contextIds.length > 1 ? [...contextIds].sort() : contextIds;

    // Keep lock acquisition order deterministic to avoid deadlocks under concurrent updates
    if (orderedMemoryIds.length === 0 && orderedContextIds.length === 0) return;

    // Prefer server-side clock to avoid shipping duplicate timestamp params on every query.
    const now = options?.timestamp ? sql`${options.timestamp}` : sql`now()`;

    await this.db.transaction(async (tx) => {
      if (orderedMemoryIds.length > 0) {
        for (const memoryId of orderedMemoryIds) {
          await tx
            .update(userMemories)
            .set({
              accessedAt: now,
              accessedCount: sql`${userMemories.accessedCount} + 1`,
              lastAccessedAt: now,
            })
            .where(and(eq(userMemories.userId, this.userId), eq(userMemories.id, memoryId)));
        }

        const memories = await tx
          .select({
            id: userMemories.id,
            layer: userMemories.memoryLayer,
          })
          .from(userMemories)
          .where(
            and(eq(userMemories.userId, this.userId), inArray(userMemories.id, orderedMemoryIds)),
          );

        const experienceIds = memories
          .filter((memory) => memory.layer === 'experience')
          .map((memory) => memory.id);
        if (experienceIds.length > 0) {
          await tx
            .update(userMemoriesExperiences)
            .set({ accessedAt: now })
            .where(
              and(
                eq(userMemoriesExperiences.userId, this.userId),
                inArray(userMemoriesExperiences.userMemoryId, experienceIds),
              ),
            );
        }

        const identityIds = memories
          .filter((memory) => memory.layer === 'identity')
          .map((memory) => memory.id);
        if (identityIds.length > 0) {
          await tx
            .update(userMemoriesIdentities)
            .set({ accessedAt: now })
            .where(
              and(
                eq(userMemoriesIdentities.userId, this.userId),
                inArray(userMemoriesIdentities.userMemoryId, identityIds),
              ),
            );
        }

        const preferenceIds = memories
          .filter((memory) => memory.layer === 'preference')
          .map((memory) => memory.id);
        if (preferenceIds.length > 0) {
          await tx
            .update(userMemoriesPreferences)
            .set({ accessedAt: now })
            .where(
              and(
                eq(userMemoriesPreferences.userId, this.userId),
                inArray(userMemoriesPreferences.userMemoryId, preferenceIds),
              ),
            );
        }
      }

      if (orderedContextIds.length > 0) {
        await tx
          .update(userMemoriesContexts)
          .set({ accessedAt: now })
          .where(
            and(
              eq(userMemoriesContexts.userId, this.userId),
              inArray(userMemoriesContexts.id, orderedContextIds),
            ),
          );
      }
    });
  };
}
