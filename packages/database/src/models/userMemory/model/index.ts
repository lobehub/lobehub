import { AssociatedObjectSchema } from '@lobechat/memory-user-memory';
import type {
  LayersEnum,
  QueryTaxonomyOptionsParams,
  QueryTaxonomyOptionsResult,
  SearchMemoryParams,
  UserMemoryDetail,
  UserMemoryInsert,
} from '@lobechat/types';
import { MemorySourceType } from '@lobechat/types';

import type { FtsSearchCandidateSource } from '../../../repositories/ftsSearch';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';
import type { UserMemoryHybridSearchAggregatedResult } from '../query';
import { UserMemoryQueryModel } from '../query';
import { buildUserMemoryWhere } from '../where';
import { updateAccessMetrics } from './accessMetrics';
import type { SearchLayerParams, UserMemoryModelContext } from './context';
import {
  create,
  createActivityMemory,
  createContextMemory,
  createExperienceMemory,
  createPreferenceMemory,
} from './create';
import { findById, findUserMemoryRawById, getMemoryDetail } from './detail';
import {
  addIdentityEntry,
  getAllIdentities,
  getAllIdentitiesWithMemory,
  getIdentitiesByType,
  removeIdentityEntry,
  updateIdentityEntry,
} from './identities';
import type { ListMemoriesItem, ListMemoriesParams } from './listMemories';
import { listMemories } from './listMemories';
import { queryMemories } from './queryMemories';
import {
  deleteAllMemories,
  deleteMemory,
  removeContextEntry,
  removeExperienceEntry,
  removePreferenceEntry,
} from './remove';
import {
  search,
  searchActivities,
  searchContexts,
  searchExperiences,
  searchPreferences,
} from './search';
import { queryIdentityRoles, queryTags } from './tags';
import type {
  AddIdentityEntryParams,
  BaseCreateUserMemoryParams,
  CreateUserMemoryActivityParams,
  CreateUserMemoryContextParams,
  CreateUserMemoryExperienceParams,
  CreateUserMemoryParams,
  CreateUserMemoryPreferenceParams,
  GetMemoryDetailParams,
  QueryIdentityRolesParams,
  QueryTagsParams,
  QueryUserMemoriesParams,
  SearchUserMemoryParams,
  SearchUserMemoryWithEmbeddingParams,
  UpdateContextVectorsParams,
  UpdateExperienceVectorsParams,
  UpdateIdentityEntryParams,
  UpdateIdentityVectorsParams,
  UpdatePreferenceVectorsParams,
  UpdateUserMemoryVectorsParams,
  UserMemorySearchAggregatedResult,
} from './types';
import {
  updateActivityVectors,
  updateContextVectors,
  updateExperienceVectors,
  updateIdentityVectors,
  updatePreferenceVectors,
  updateUserMemory,
  updateUserMemoryVectors,
} from './vectors';

export * from './types';

const parseAssociationExtra = (
  value: string | null | undefined,
): Record<string, unknown> | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return { value: parsed };
  } catch {
    return { raw: value };
  }
};

export class UserMemoryModel {
  static parseAssociatedObjects(value?: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];

    const associations: Record<string, unknown>[] = [];

    value.forEach((item) => {
      const parsed = AssociatedObjectSchema.safeParse(item);
      if (parsed.success) {
        const extra = parseAssociationExtra(parsed.data.extra);
        if (extra) parsed.data.extra = extra as any;
        else delete (parsed.data as any).extra;
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
        const extra = parseAssociationExtra(parsed.data.extra);
        if (extra) parsed.data.extra = extra as any;
        else delete (parsed.data as any).extra;
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
  private queryModel: UserMemoryQueryModel;
  private readonly context: UserMemoryModelContext;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    private readonly ftsSearchCandidateSource?: FtsSearchCandidateSource,
  ) {
    this.userId = userId;
    this.db = db;
    this.queryModel = new UserMemoryQueryModel(db, userId, ftsSearchCandidateSource);
    this.topicModel = new TopicModel(db, userId);

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const model = this;
    this.context = {
      buildBaseMemoryInsertValues: (params, options) =>
        this.buildBaseMemoryInsertValues(params, options),
      get db() {
        return model.db;
      },
      extractSourceMetadata: (metadata) => this.extractSourceMetadata(metadata),
      findUserMemoryRawById: (memoryId) => this.findUserMemoryRawById(memoryId),
      get ftsSearchCandidateSource() {
        return model.ftsSearchCandidateSource;
      },
      memoryWhere: (table) => this.memoryWhere(table),
      searchActivities: (params) => this.searchActivities(params),
      searchContexts: (params) => this.searchContexts(params),
      searchExperiences: (params) => this.searchExperiences(params),
      searchPreferences: (params) => this.searchPreferences(params),
      get topicModel() {
        return model.topicModel;
      },
      updateAccessMetrics: (memoryIds, options) => this.updateAccessMetrics(memoryIds, options),
      get userId() {
        return model.userId;
      },
    };
  }

  private memoryWhere(table: Parameters<typeof buildUserMemoryWhere>[2]) {
    return buildUserMemoryWhere(this.db, this.userId, table);
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
  ): UserMemoryInsert {
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
    } satisfies UserMemoryInsert;
  }

  create = (params: CreateUserMemoryParams) => create(this.context, params);

  createContextMemory = (params: CreateUserMemoryContextParams) =>
    createContextMemory(this.context, params);

  createExperienceMemory = (params: CreateUserMemoryExperienceParams) =>
    createExperienceMemory(this.context, params);

  createActivityMemory = (params: CreateUserMemoryActivityParams) =>
    createActivityMemory(this.context, params);

  createPreferenceMemory = (params: CreateUserMemoryPreferenceParams) =>
    createPreferenceMemory(this.context, params);

  search = (params: SearchUserMemoryParams) => search(this.context, params);

  searchWithEmbedding = async (
    params: SearchUserMemoryWithEmbeddingParams,
  ): Promise<UserMemorySearchAggregatedResult> => {
    return this.search(params);
  };

  queryTags = (params?: QueryTagsParams) => queryTags(this.context, params);

  queryIdentityRoles = (params?: QueryIdentityRolesParams) =>
    queryIdentityRoles(this.context, params);

  searchMemory = async (
    params: SearchMemoryParams,
    queryEmbeddings: number[][] = [],
  ): Promise<UserMemoryHybridSearchAggregatedResult> => {
    return this.queryModel.searchMemory(params, queryEmbeddings);
  };

  queryTaxonomyOptions = async (
    params: QueryTaxonomyOptionsParams = {},
  ): Promise<QueryTaxonomyOptionsResult> => {
    return this.queryModel.queryTaxonomyOptions(params);
  };

  queryMemories = (params?: QueryUserMemoriesParams) => queryMemories(this.context, params);

  /**
   * NOTICE: internal service / backend / data aggregation use only, for most of the UI related use-cases,
   * please use `queryMemories` method instead.
   */
  listMemories = <L extends LayersEnum, R extends UserMemoryDetail = ListMemoriesItem<L>>(
    params: ListMemoriesParams<L>,
  ) => listMemories<L, R>(this.context, params);

  getMemoryDetail = (params: GetMemoryDetailParams) => getMemoryDetail(this.context, params);

  private findUserMemoryRawById = (memoryId: string) =>
    findUserMemoryRawById(this.context, memoryId);

  findById = (id: string) => findById(this.context, id);

  update = (id: string, params: Partial<CreateUserMemoryParams>) =>
    updateUserMemory(this.context, id, params);

  updateUserMemoryVectors = (id: string, vectors: UpdateUserMemoryVectorsParams) =>
    updateUserMemoryVectors(this.context, id, vectors);

  updateContextVectors = (id: string, vectors: UpdateContextVectorsParams) =>
    updateContextVectors(this.context, id, vectors);

  updatePreferenceVectors = (id: string, vectors: UpdatePreferenceVectorsParams) =>
    updatePreferenceVectors(this.context, id, vectors);

  updateIdentityVectors = (id: string, vectors: UpdateIdentityVectorsParams) =>
    updateIdentityVectors(this.context, id, vectors);

  updateExperienceVectors = (id: string, vectors: UpdateExperienceVectorsParams) =>
    updateExperienceVectors(this.context, id, vectors);

  updateActivityVectors = (
    id: string,
    vectors: { feedbackVector?: number[] | null; narrativeVector?: number[] | null },
  ) => updateActivityVectors(this.context, id, vectors);

  addIdentityEntry = (params: AddIdentityEntryParams) => addIdentityEntry(this.context, params);

  updateIdentityEntry = (params: UpdateIdentityEntryParams) =>
    updateIdentityEntry(this.context, params);

  removeIdentityEntry = (identityId: string) => removeIdentityEntry(this.context, identityId);

  removeContextEntry = (contextId: string) => removeContextEntry(this.context, contextId);

  removeExperienceEntry = (experienceId: string) =>
    removeExperienceEntry(this.context, experienceId);

  removePreferenceEntry = (preferenceId: string) =>
    removePreferenceEntry(this.context, preferenceId);

  delete = (id: string) => deleteMemory(this.context, id);

  deleteAll = () => deleteAllMemories(this.context);

  searchActivities = (params: SearchLayerParams) => searchActivities(this.context, params);

  searchContexts = (params: SearchLayerParams) => searchContexts(this.context, params);

  searchExperiences = (params: SearchLayerParams) => searchExperiences(this.context, params);

  searchPreferences = (params: SearchLayerParams) => searchPreferences(this.context, params);

  getAllIdentities = () => getAllIdentities(this.context);

  getAllIdentitiesWithMemory = () => getAllIdentitiesWithMemory(this.context);

  getIdentitiesByType = (type: string) => getIdentitiesByType(this.context, type);

  private updateAccessMetrics = (
    memoryIds: string[],
    options?: { contextIds?: string[]; timestamp?: Date },
  ) => updateAccessMetrics(this.context, memoryIds, options);
}
