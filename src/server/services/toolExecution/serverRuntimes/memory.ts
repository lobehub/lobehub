import { MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import {
  MemoryExecutionRuntime,
  type MemoryRuntimeService,
} from '@lobechat/builtin-tool-memory/executionRuntime';
import { BRANDING_PROVIDER, ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import {
  DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
  DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM,
  MEMORY_SEARCH_TOP_K_LIMITS,
} from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type {
  ActivityMemoryItemSchema,
  AddIdentityActionSchema,
  ContextMemoryItemSchema,
  ExperienceMemoryItemSchema,
  PreferenceMemoryItemSchema,
  RemoveIdentityActionSchema,
  UpdateIdentityActionSchema,
} from '@lobechat/memory-user-memory/schemas';
import type {
  AddActivityMemoryResult,
  AddContextMemoryResult,
  AddExperienceMemoryResult,
  AddIdentityMemoryResult,
  AddPreferenceMemoryResult,
  QueryTaxonomyOptionsParams,
  QueryTaxonomyOptionsResult,
  RemoveIdentityMemoryResult,
  SearchMemoryParams,
  SearchMemoryResult,
  UpdateIdentityMemoryResult,
} from '@lobechat/types';
import { LayersEnum, RequestTrigger } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import {
  type IdentityEntryBasePayload,
  type IdentityEntryPayload,
  UserMemoryModel,
} from '@/database/models/userMemory';
import { userSettings } from '@/database/schemas';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import {
  initModelRuntimeFromDB,
  initModelRuntimeWithUserPayload,
} from '@/server/modules/ModelRuntime';
import {
  emitToolOutcomeSafely,
  resolveToolOutcomeScope,
} from '@/server/services/agentSignal/procedure';
import { redisPolicyStateStore } from '@/server/services/agentSignal/store/adapters/redis/policyStateStore';
import { normalizeSearchMemoryParams } from '@/server/services/memory/userMemory/searchParams';

import type { ToolExecutionMemoryEmbeddingRuntime } from '../types';
import type { ServerRuntimeRegistration } from './types';

type MemoryEffort = 'high' | 'low' | 'medium';

const normalizeMemoryEffort = (value: unknown): MemoryEffort => {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
};

const applySearchLimitsByEffort = (
  effort: MemoryEffort,
  requested: {
    activities: number;
    contexts: number;
    experiences: number;
    identities: number;
    preferences: number;
  },
) => {
  const limit = MEMORY_SEARCH_TOP_K_LIMITS[effort];
  const identityLimit = effort === 'high' ? 4 : effort === 'low' ? 1 : 2;

  return {
    activities: Math.min(requested.activities, limit.activities),
    contexts: Math.min(requested.contexts, limit.contexts),
    experiences: Math.min(requested.experiences, limit.experiences),
    identities: Math.min(requested.identities, identityLimit),
    preferences: Math.min(requested.preferences, limit.preferences),
  };
};

const getEmbeddingRuntime = async (serverDB: LobeChatDatabase, userId: string) => {
  const { provider, model: embeddingModel } =
    getServerDefaultFilesConfig().embeddingModel || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;

  const agentRuntime = await initModelRuntimeFromDB(
    serverDB,
    userId,
    ENABLE_BUSINESS_FEATURES ? BRANDING_PROVIDER : provider,
  );

  return { agentRuntime, embeddingModel };
};

const createEmbedder = (agentRuntime: any, embeddingModel: string, userId: string) => {
  return async (value?: string | null): Promise<number[] | undefined> => {
    if (!value || value.trim().length === 0) return undefined;

    const embeddings = await agentRuntime.embeddings(
      {
        dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
        input: value,
        model: embeddingModel,
      },
      { metadata: { trigger: RequestTrigger.Memory }, user: userId },
    );

    return embeddings?.[0];
  };
};

class MemoryServerRuntimeService implements MemoryRuntimeService {
  private agentId?: string;
  private emitOutcome?: typeof emitToolOutcomeSafely;
  private messageId?: string;
  private memoryModel: UserMemoryModel;
  private operationId?: string;
  private serverDB: LobeChatDatabase;
  private taskId?: string;
  private toolCallId?: string;
  private topicId?: string;
  private memoryEffort: MemoryEffort;
  private memoryEmbeddingRuntime?: ToolExecutionMemoryEmbeddingRuntime;
  private userId: string;

  constructor(options: {
    agentId?: string;
    emitOutcome?: typeof emitToolOutcomeSafely;
    messageId?: string;
    memoryEffort: MemoryEffort;
    memoryEmbeddingRuntime?: ToolExecutionMemoryEmbeddingRuntime;
    memoryModel: UserMemoryModel;
    operationId?: string;
    serverDB: LobeChatDatabase;
    taskId?: string;
    toolCallId?: string;
    topicId?: string;
    userId: string;
  }) {
    this.agentId = options.agentId;
    this.emitOutcome = options.emitOutcome;
    this.messageId = options.messageId;
    this.memoryModel = options.memoryModel;
    this.operationId = options.operationId;
    this.serverDB = options.serverDB;
    this.taskId = options.taskId;
    this.toolCallId = options.toolCallId;
    this.topicId = options.topicId;
    this.memoryEffort = options.memoryEffort;
    this.memoryEmbeddingRuntime = options.memoryEmbeddingRuntime;
    this.userId = options.userId;
  }

  private emitUserMemoryOutcome = async (input: {
    apiName: string;
    errorReason?: string;
    objectId?: string;
    relation?: string;
    status: 'failed' | 'succeeded';
    summary: string;
    toolAction: string;
  }) => {
    const { scope, scopeKey } = resolveToolOutcomeScope({
      agentId: this.agentId,
      taskId: this.taskId,
      topicId: this.topicId,
      userId: this.userId,
    });

    await this.emitOutcome?.({
      apiName: input.apiName,
      context: { agentId: this.agentId, userId: this.userId },
      domainKey: 'memory:user-preference',
      errorReason: input.errorReason,
      identifier: MemoryIdentifier,
      intentClass: 'explicit_persistence',
      messageId: this.messageId,
      operationId: this.operationId,
      policyStateStore: redisPolicyStateStore,
      relatedObjects: input.objectId
        ? [{ objectId: input.objectId, objectType: 'memory', relation: input.relation }]
        : undefined,
      scope,
      scopeKey,
      status: input.status,
      summary: input.summary,
      ttlSeconds: 7 * 24 * 60 * 60,
      toolAction: input.toolAction,
      toolCallId: this.toolCallId,
    });
  };

  searchMemory = async (params: SearchMemoryParams): Promise<SearchMemoryResult> => {
    const normalizedParams = normalizeSearchMemoryParams(params);
    const defaultEmbeddingConfig =
      getServerDefaultFilesConfig().embeddingModel || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;
    const embeddingModel = this.memoryEmbeddingRuntime?.model ?? defaultEmbeddingConfig.model;
    const modelRuntime = this.memoryEmbeddingRuntime
      ? initModelRuntimeWithUserPayload(
          this.memoryEmbeddingRuntime.provider,
          this.memoryEmbeddingRuntime.payload,
          { userId: this.userId },
        )
      : await initModelRuntimeFromDB(this.serverDB, this.userId, defaultEmbeddingConfig.provider);
    const normalizedQueries = [
      ...new Set((normalizedParams.queries ?? []).map((query) => query.trim()).filter(Boolean)),
    ];

    const queryEmbeddings =
      normalizedQueries.length > 0
        ? await modelRuntime.embeddings(
            {
              dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
              input: normalizedQueries,
              model: embeddingModel,
            },
            { metadata: { trigger: RequestTrigger.Memory }, user: this.userId },
          )
        : [];

    const effectiveEffort = normalizeMemoryEffort(normalizedParams.effort ?? this.memoryEffort);
    const effortDefaults = MEMORY_SEARCH_TOP_K_LIMITS[effectiveEffort];

    const requestedLimits = {
      activities: normalizedParams.topK?.activities ?? effortDefaults.activities,
      contexts: normalizedParams.topK?.contexts ?? effortDefaults.contexts,
      experiences: normalizedParams.topK?.experiences ?? effortDefaults.experiences,
      identities:
        normalizedParams.topK?.identities ??
        (effectiveEffort === 'high' ? 4 : effectiveEffort === 'low' ? 1 : 2),
      preferences: normalizedParams.topK?.preferences ?? effortDefaults.preferences,
    };

    const effortConstrainedLimits = applySearchLimitsByEffort(effectiveEffort, requestedLimits);
    return this.memoryModel.searchMemory(
      { ...normalizedParams, queries: normalizedQueries, topK: effortConstrainedLimits },
      queryEmbeddings,
    ) as Promise<SearchMemoryResult>;
  };

  queryTaxonomyOptions = async (
    params: QueryTaxonomyOptionsParams,
  ): Promise<QueryTaxonomyOptionsResult> => {
    return this.memoryModel.queryTaxonomyOptions(params);
  };

  addContextMemory = async (
    input: z.infer<typeof ContextMemoryItemSchema>,
  ): Promise<AddContextMemoryResult> => {
    try {
      const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
        this.serverDB,
        this.userId,
      );
      const embed = createEmbedder(agentRuntime, embeddingModel, this.userId);

      const summaryEmbedding = await embed(input.summary);
      const detailsEmbedding = await embed(input.details);
      const contextDescriptionEmbedding = await embed(input.withContext.description);

      const { context, memory } = await this.memoryModel.createContextMemory({
        context: {
          associatedObjects:
            UserMemoryModel.parseAssociatedObjects(input.withContext.associatedObjects) ?? null,
          associatedSubjects:
            UserMemoryModel.parseAssociatedSubjects(input.withContext.associatedSubjects) ?? null,
          currentStatus: input.withContext.currentStatus ?? null,
          description: input.withContext.description ?? null,
          descriptionVector: contextDescriptionEmbedding ?? null,
          metadata: {},
          scoreImpact: input.withContext.scoreImpact ?? null,
          scoreUrgency: input.withContext.scoreUrgency ?? null,
          tags: input.tags ?? [],
          title: input.withContext.title ?? null,
          type: input.withContext.type ?? null,
        },
        details: input.details || '',
        detailsEmbedding,
        memoryCategory: input.memoryCategory,
        memoryLayer: LayersEnum.Context,
        memoryType: input.memoryType,
        summary: input.summary,
        summaryEmbedding,
        title: input.title,
      });

      await this.emitUserMemoryOutcome({
        apiName: 'addContextMemory',
        objectId: memory.id,
        relation: 'created',
        status: 'succeeded',
        summary: 'Memory tool saved contextual memory.',
        toolAction: 'create',
      });

      return {
        contextId: context.id,
        memoryId: memory.id,
        message: 'Memory saved successfully',
        success: true,
      };
    } catch (error) {
      await this.emitUserMemoryOutcome({
        apiName: 'addContextMemory',
        errorReason: (error as Error).message,
        status: 'failed',
        summary: 'Memory tool failed to save contextual memory.',
        toolAction: 'create',
      });

      return {
        message: `Failed to save memory: ${(error as Error).message}`,
        success: false,
      };
    }
  };

  addActivityMemory = async (
    input: z.infer<typeof ActivityMemoryItemSchema>,
  ): Promise<AddActivityMemoryResult> => {
    try {
      const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
        this.serverDB,
        this.userId,
      );
      const embed = createEmbedder(agentRuntime, embeddingModel, this.userId);

      const summaryEmbedding = await embed(input.summary);
      const detailsEmbedding = await embed(input.details);
      const narrativeVector = await embed(input.withActivity.narrative);
      const feedbackVector = await embed(input.withActivity.feedback);

      const { activity, memory } = await this.memoryModel.createActivityMemory({
        activity: {
          associatedLocations:
            UserMemoryModel.parseAssociatedLocations(input.withActivity.associatedLocations) ??
            null,
          associatedObjects:
            UserMemoryModel.parseAssociatedObjects(input.withActivity.associatedObjects) ?? [],
          associatedSubjects:
            UserMemoryModel.parseAssociatedSubjects(input.withActivity.associatedSubjects) ?? [],
          endsAt: UserMemoryModel.parseDateFromString(input.withActivity.endsAt ?? undefined),
          feedback: input.withActivity.feedback ?? null,
          feedbackVector: feedbackVector ?? null,
          metadata: input.withActivity.metadata ?? null,
          narrative: input.withActivity.narrative ?? null,
          narrativeVector: narrativeVector ?? null,
          notes: input.withActivity.notes ?? null,
          startsAt: UserMemoryModel.parseDateFromString(input.withActivity.startsAt ?? undefined),
          status: input.withActivity.status ?? 'pending',
          tags: input.withActivity.tags ?? input.tags ?? [],
          timezone: input.withActivity.timezone ?? null,
          type: input.withActivity.type ?? 'other',
        },
        details: input.details || '',
        detailsEmbedding,
        memoryCategory: input.memoryCategory,
        memoryLayer: LayersEnum.Activity,
        memoryType: input.memoryType,
        summary: input.summary,
        summaryEmbedding,
        title: input.title,
      });

      await this.emitUserMemoryOutcome({
        apiName: 'addActivityMemory',
        objectId: memory.id,
        relation: 'created',
        status: 'succeeded',
        summary: 'Memory tool saved activity memory.',
        toolAction: 'create',
      });

      return {
        activityId: activity.id,
        memoryId: memory.id,
        message: 'Memory saved successfully',
        success: true,
      };
    } catch (error) {
      await this.emitUserMemoryOutcome({
        apiName: 'addActivityMemory',
        errorReason: (error as Error).message,
        status: 'failed',
        summary: 'Memory tool failed to save activity memory.',
        toolAction: 'create',
      });

      return {
        message: `Failed to save memory: ${(error as Error).message}`,
        success: false,
      };
    }
  };

  addExperienceMemory = async (
    input: z.infer<typeof ExperienceMemoryItemSchema>,
  ): Promise<AddExperienceMemoryResult> => {
    try {
      const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
        this.serverDB,
        this.userId,
      );
      const embed = createEmbedder(agentRuntime, embeddingModel, this.userId);

      const summaryEmbedding = await embed(input.summary);
      const detailsEmbedding = await embed(input.details);
      const situationVector = await embed(input.withExperience.situation);
      const actionVector = await embed(input.withExperience.action);
      const keyLearningVector = await embed(input.withExperience.keyLearning);

      const { experience, memory } = await this.memoryModel.createExperienceMemory({
        details: input.details || '',
        detailsEmbedding,
        experience: {
          action: input.withExperience.action ?? null,
          actionVector: actionVector ?? null,
          keyLearning: input.withExperience.keyLearning ?? null,
          keyLearningVector: keyLearningVector ?? null,
          metadata: {},
          possibleOutcome: input.withExperience.possibleOutcome ?? null,
          reasoning: input.withExperience.reasoning ?? null,
          scoreConfidence: input.withExperience.scoreConfidence ?? null,
          situation: input.withExperience.situation ?? null,
          situationVector: situationVector ?? null,
          tags: input.tags ?? [],
          type: input.memoryType,
        },
        memoryCategory: input.memoryCategory,
        memoryLayer: LayersEnum.Experience,
        memoryType: input.memoryType,
        summary: input.summary,
        summaryEmbedding,
        title: input.title,
      });

      await this.emitUserMemoryOutcome({
        apiName: 'addExperienceMemory',
        objectId: memory.id,
        relation: 'created',
        status: 'succeeded',
        summary: 'Memory tool saved experience memory.',
        toolAction: 'create',
      });

      return {
        experienceId: experience.id,
        memoryId: memory.id,
        message: 'Memory saved successfully',
        success: true,
      };
    } catch (error) {
      await this.emitUserMemoryOutcome({
        apiName: 'addExperienceMemory',
        errorReason: (error as Error).message,
        status: 'failed',
        summary: 'Memory tool failed to save experience memory.',
        toolAction: 'create',
      });

      return {
        message: `Failed to save memory: ${(error as Error).message}`,
        success: false,
      };
    }
  };

  addIdentityMemory = async (
    input: z.infer<typeof AddIdentityActionSchema>,
  ): Promise<AddIdentityMemoryResult> => {
    try {
      const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
        this.serverDB,
        this.userId,
      );
      const embed = createEmbedder(agentRuntime, embeddingModel, this.userId);

      const summaryEmbedding = await embed(input.summary);
      const detailsEmbedding = await embed(input.details);
      const descriptionEmbedding = await embed(input.withIdentity.description);

      const identityMetadata: Record<string, unknown> = {};
      if (
        input.withIdentity.scoreConfidence !== null &&
        input.withIdentity.scoreConfidence !== undefined
      ) {
        identityMetadata.scoreConfidence = input.withIdentity.scoreConfidence;
      }
      if (
        input.withIdentity.sourceEvidence !== null &&
        input.withIdentity.sourceEvidence !== undefined
      ) {
        identityMetadata.sourceEvidence = input.withIdentity.sourceEvidence;
      }

      const { identityId, userMemoryId } = await this.memoryModel.addIdentityEntry({
        base: {
          details: input.details,
          detailsVector1024: detailsEmbedding ?? null,
          memoryCategory: input.memoryCategory,
          memoryLayer: LayersEnum.Identity,
          memoryType: input.memoryType,
          metadata: Object.keys(identityMetadata).length > 0 ? identityMetadata : undefined,
          summary: input.summary,
          summaryVector1024: summaryEmbedding ?? null,
          tags: input.tags,
          title: input.title,
        },
        identity: {
          description: input.withIdentity.description,
          descriptionVector: descriptionEmbedding ?? null,
          episodicDate: input.withIdentity.episodicDate,
          metadata: Object.keys(identityMetadata).length > 0 ? identityMetadata : undefined,
          relationship: input.withIdentity.relationship,
          role: input.withIdentity.role,
          tags: input.tags,
          type: input.withIdentity.type,
        },
      });

      await this.emitUserMemoryOutcome({
        apiName: 'addIdentityMemory',
        objectId: userMemoryId,
        relation: 'created',
        status: 'succeeded',
        summary: 'Memory tool saved identity memory.',
        toolAction: 'create',
      });

      return {
        identityId,
        memoryId: userMemoryId,
        message: 'Identity memory saved successfully',
        success: true,
      };
    } catch (error) {
      await this.emitUserMemoryOutcome({
        apiName: 'addIdentityMemory',
        errorReason: (error as Error).message,
        status: 'failed',
        summary: 'Memory tool failed to save identity memory.',
        toolAction: 'create',
      });

      return {
        message: `Failed to save identity memory: ${(error as Error).message}`,
        success: false,
      };
    }
  };

  addPreferenceMemory = async (
    input: z.infer<typeof PreferenceMemoryItemSchema>,
  ): Promise<AddPreferenceMemoryResult> => {
    try {
      const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
        this.serverDB,
        this.userId,
      );
      const embed = createEmbedder(agentRuntime, embeddingModel, this.userId);

      const summaryEmbedding = await embed(input.summary);
      const detailsEmbedding = await embed(input.details);
      const conclusionVector = await embed(input.withPreference.conclusionDirectives);

      const suggestionsText =
        input.withPreference?.suggestions?.length && input.withPreference?.suggestions?.length > 0
          ? input.withPreference?.suggestions?.join('\n')
          : null;

      const metadata = {
        appContext: input.withPreference.appContext,
        extractedScopes: input.withPreference.extractedScopes,
        originContext: input.withPreference.originContext,
      } satisfies Record<string, unknown>;

      const { memory, preference } = await this.memoryModel.createPreferenceMemory({
        details: input.details || '',
        detailsEmbedding,
        memoryCategory: input.memoryCategory,
        memoryLayer: LayersEnum.Preference,
        memoryType: input.memoryType,
        preference: {
          conclusionDirectives: input.withPreference.conclusionDirectives || '',
          conclusionDirectivesVector: conclusionVector ?? null,
          metadata,
          scorePriority: input.withPreference.scorePriority ?? null,
          suggestions: suggestionsText,
          tags: input.tags,
          type: input.memoryType,
        },
        summary: input.summary,
        summaryEmbedding,
        title: input.title,
      });

      await this.emitUserMemoryOutcome({
        apiName: 'addPreferenceMemory',
        objectId: memory.id,
        relation: 'created',
        status: 'succeeded',
        summary: 'Memory tool saved a user preference.',
        toolAction: 'create',
      });

      return {
        memoryId: memory.id,
        message: 'Memory saved successfully',
        preferenceId: preference.id,
        success: true,
      };
    } catch (error) {
      await this.emitUserMemoryOutcome({
        apiName: 'addPreferenceMemory',
        errorReason: (error as Error).message,
        status: 'failed',
        summary: 'Memory tool failed to save a user preference.',
        toolAction: 'create',
      });

      return {
        message: `Failed to save memory: ${(error as Error).message}`,
        success: false,
      };
    }
  };

  updateIdentityMemory = async (
    input: z.infer<typeof UpdateIdentityActionSchema>,
  ): Promise<UpdateIdentityMemoryResult> => {
    try {
      const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
        this.serverDB,
        this.userId,
      );
      const embed = createEmbedder(agentRuntime, embeddingModel, this.userId);

      let summaryVector1024: number[] | null | undefined;
      if (input.set.summary !== undefined) {
        const vector = await embed(input.set.summary);
        summaryVector1024 = vector ?? null;
      }

      let detailsVector1024: number[] | null | undefined;
      if (input.set.details !== undefined) {
        const vector = await embed(input.set.details);
        detailsVector1024 = vector ?? null;
      }

      let descriptionVector: number[] | null | undefined;
      if (input.set.withIdentity.description !== undefined) {
        const vector = await embed(input.set.withIdentity.description);
        descriptionVector = vector ?? null;
      }

      const metadataUpdates: Record<string, unknown> = {};
      if (Object.hasOwn(input.set.withIdentity, 'scoreConfidence')) {
        metadataUpdates.scoreConfidence = input.set.withIdentity.scoreConfidence ?? null;
      }
      if (Object.hasOwn(input.set.withIdentity, 'sourceEvidence')) {
        metadataUpdates.sourceEvidence = input.set.withIdentity.sourceEvidence ?? null;
      }

      const identityPayload: Partial<IdentityEntryPayload> = {};
      if (input.set.withIdentity.description !== undefined) {
        identityPayload.description = input.set.withIdentity.description;
        identityPayload.descriptionVector = descriptionVector;
      }
      if (input.set.withIdentity.episodicDate !== undefined) {
        identityPayload.episodicDate = input.set.withIdentity.episodicDate;
      }
      if (input.set.withIdentity.relationship !== undefined) {
        identityPayload.relationship = input.set.withIdentity.relationship;
      }
      if (input.set.withIdentity.role !== undefined) {
        identityPayload.role = input.set.withIdentity.role;
      }
      if (input.set.tags !== undefined) {
        identityPayload.tags = input.set.tags;
      }
      if (input.set.withIdentity.type !== undefined) {
        identityPayload.type = input.set.withIdentity.type;
      }
      if (Object.keys(metadataUpdates).length > 0) {
        identityPayload.metadata = metadataUpdates;
      }

      const basePayload: Partial<IdentityEntryBasePayload> = {};
      if (input.set.details !== undefined) {
        basePayload.details = input.set.details;
        basePayload.detailsVector1024 = detailsVector1024;
      }
      if (input.set.memoryCategory !== undefined) {
        basePayload.memoryCategory = input.set.memoryCategory;
      }
      if (input.set.memoryType !== undefined) {
        basePayload.memoryType = input.set.memoryType;
      }
      if (input.set.summary !== undefined) {
        basePayload.summary = input.set.summary;
        basePayload.summaryVector1024 = summaryVector1024;
      }
      if (input.set.tags !== undefined) {
        basePayload.tags = input.set.tags;
      }
      if (input.set.title !== undefined) {
        basePayload.title = input.set.title;
      }
      if (Object.keys(metadataUpdates).length > 0) {
        basePayload.metadata = metadataUpdates;
      }

      const updated = await this.memoryModel.updateIdentityEntry({
        base: Object.keys(basePayload).length > 0 ? basePayload : undefined,
        identity: Object.keys(identityPayload).length > 0 ? identityPayload : undefined,
        identityId: input.id,
        mergeStrategy: input.mergeStrategy,
      });

      if (!updated) {
        await this.emitUserMemoryOutcome({
          apiName: 'updateIdentityMemory',
          objectId: input.id,
          relation: 'missing',
          status: 'failed',
          summary: 'Memory tool could not find identity memory to update.',
          toolAction: 'update',
        });

        return {
          message: 'Identity memory not found',
          success: false,
        };
      }

      await this.emitUserMemoryOutcome({
        apiName: 'updateIdentityMemory',
        objectId: input.id,
        relation: 'updated',
        status: 'succeeded',
        summary: 'Memory tool updated identity memory.',
        toolAction: 'update',
      });

      return {
        identityId: input.id,
        message: 'Identity memory updated successfully',
        success: true,
      };
    } catch (error) {
      await this.emitUserMemoryOutcome({
        apiName: 'updateIdentityMemory',
        errorReason: (error as Error).message,
        objectId: input.id,
        relation: 'updated',
        status: 'failed',
        summary: 'Memory tool failed to update identity memory.',
        toolAction: 'update',
      });

      return {
        message: `Failed to update identity memory: ${(error as Error).message}`,
        success: false,
      };
    }
  };

  removeIdentityMemory = async (
    input: z.infer<typeof RemoveIdentityActionSchema>,
  ): Promise<RemoveIdentityMemoryResult> => {
    try {
      const removed = await this.memoryModel.removeIdentityEntry(input.id);

      if (!removed) {
        await this.emitUserMemoryOutcome({
          apiName: 'removeIdentityMemory',
          objectId: input.id,
          relation: 'missing',
          status: 'failed',
          summary: 'Memory tool could not find identity memory to remove.',
          toolAction: 'remove',
        });

        return {
          message: 'Identity memory not found',
          success: false,
        };
      }

      await this.emitUserMemoryOutcome({
        apiName: 'removeIdentityMemory',
        objectId: input.id,
        relation: 'removed',
        status: 'succeeded',
        summary: 'Memory tool removed identity memory.',
        toolAction: 'remove',
      });

      return {
        identityId: input.id,
        message: 'Identity memory removed successfully',
        reason: input.reason,
        success: true,
      };
    } catch (error) {
      await this.emitUserMemoryOutcome({
        apiName: 'removeIdentityMemory',
        errorReason: (error as Error).message,
        objectId: input.id,
        relation: 'removed',
        status: 'failed',
        summary: 'Memory tool failed to remove identity memory.',
        toolAction: 'remove',
      });

      return {
        message: `Failed to remove identity memory: ${(error as Error).message}`,
        success: false,
      };
    }
  };
}

export const memoryRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Memory execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Memory execution');
    }

    // Resolve memoryEffort from user settings
    let memoryEffort: MemoryEffort = 'medium';
    try {
      const userSettingsRow = await context.serverDB.query.userSettings.findFirst({
        columns: { memory: true },
        where: eq(userSettings.id, context.userId),
      });
      const memoryConfig =
        typeof userSettingsRow?.memory === 'object' && userSettingsRow?.memory !== null
          ? (userSettingsRow.memory as { effort?: unknown })
          : undefined;
      memoryEffort = normalizeMemoryEffort(memoryConfig?.effort);
    } catch {
      // fallback to medium
    }

    const memoryModel = new UserMemoryModel(context.serverDB, context.userId);

    const service = new MemoryServerRuntimeService({
      agentId: context.agentId,
      emitOutcome: emitToolOutcomeSafely,
      messageId: context.messageId,
      memoryEffort,
      memoryEmbeddingRuntime: context.memoryEmbeddingRuntime,
      memoryModel,
      operationId: context.operationId,
      serverDB: context.serverDB,
      taskId: context.taskId,
      toolCallId: context.toolCallId,
      topicId: context.topicId,
      userId: context.userId,
    });

    return new MemoryExecutionRuntime({
      service,
      toolPermission: context.memoryToolPermission,
    });
  },
  identifier: MemoryIdentifier,
};
