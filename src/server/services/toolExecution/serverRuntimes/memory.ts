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
  RemoveIdentityMemoryResult,
  SearchMemoryParams,
  SearchMemoryResult,
  UpdateIdentityMemoryResult,
} from '@lobechat/types';
import { LayersEnum } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import {
  type IdentityEntryBasePayload,
  type IdentityEntryPayload,
  UserMemoryModel,
} from '@/database/models/userMemory';
import { userSettings } from '@/database/schemas';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import type { ServerRuntimeRegistration } from './types';

type MemoryEffort = 'high' | 'low' | 'medium';

const normalizeMemoryEffort = (value: unknown): MemoryEffort => {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
};

const applySearchLimitsByEffort = (
  effort: MemoryEffort,
  requested: { activities: number; contexts: number; experiences: number; preferences: number },
) => {
  const limit = MEMORY_SEARCH_TOP_K_LIMITS[effort];

  return {
    activities: Math.min(requested.activities, limit.activities),
    contexts: Math.min(requested.contexts, limit.contexts),
    experiences: Math.min(requested.experiences, limit.experiences),
    preferences: Math.min(requested.preferences, limit.preferences),
  };
};

const mapMemorySearchResult = (
  layeredResults: Awaited<ReturnType<UserMemoryModel['searchWithEmbedding']>>,
): SearchMemoryResult => {
  return {
    activities: layeredResults.activities.map((activity) => ({
      accessedAt: activity.accessedAt,
      associatedLocations: activity.associatedLocations,
      associatedObjects: activity.associatedObjects,
      associatedSubjects: activity.associatedSubjects,
      capturedAt: activity.capturedAt,
      createdAt: activity.createdAt,
      endsAt: activity.endsAt,
      feedback: activity.feedback,
      id: activity.id,
      metadata: activity.metadata,
      narrative: activity.narrative,
      notes: activity.notes,
      startsAt: activity.startsAt,
      status: activity.status,
      tags: activity.tags,
      timezone: activity.timezone,
      type: activity.type,
      updatedAt: activity.updatedAt,
      userMemoryId: activity.userMemoryId,
    })),
    contexts: layeredResults.contexts.map((context) => ({
      accessedAt: context.accessedAt,
      associatedObjects: context.associatedObjects,
      associatedSubjects: context.associatedSubjects,
      createdAt: context.createdAt,
      currentStatus: context.currentStatus,
      description: context.description,
      id: context.id,
      metadata: context.metadata,
      scoreImpact: context.scoreImpact,
      scoreUrgency: context.scoreUrgency,
      tags: context.tags,
      title: context.title,
      type: context.type,
      updatedAt: context.updatedAt,
      userMemoryIds: Array.isArray(context.userMemoryIds)
        ? (context.userMemoryIds as string[])
        : null,
    })),
    experiences: layeredResults.experiences.map((experience) => ({
      accessedAt: experience.accessedAt,
      action: experience.action,
      createdAt: experience.createdAt,
      id: experience.id,
      keyLearning: experience.keyLearning,
      metadata: experience.metadata,
      possibleOutcome: experience.possibleOutcome,
      reasoning: experience.reasoning,
      scoreConfidence: experience.scoreConfidence,
      situation: experience.situation,
      tags: experience.tags,
      type: experience.type,
      updatedAt: experience.updatedAt,
      userMemoryId: experience.userMemoryId,
    })),
    preferences: layeredResults.preferences.map((preference) => ({
      accessedAt: preference.accessedAt,
      conclusionDirectives: preference.conclusionDirectives,
      createdAt: preference.createdAt,
      id: preference.id,
      metadata: preference.metadata,
      scorePriority: preference.scorePriority,
      suggestions: preference.suggestions,
      tags: preference.tags,
      type: preference.type,
      updatedAt: preference.updatedAt,
      userMemoryId: preference.userMemoryId,
    })),
  } satisfies SearchMemoryResult;
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

const createEmbedder = (agentRuntime: any, embeddingModel: string) => {
  return async (value?: string | null): Promise<number[] | undefined> => {
    if (!value || value.trim().length === 0) return undefined;

    const embeddings = await agentRuntime.embeddings({
      dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
      input: value,
      model: embeddingModel,
    });

    return embeddings?.[0];
  };
};

class MemoryServerRuntimeService implements MemoryRuntimeService {
  private memoryModel: UserMemoryModel;
  private serverDB: LobeChatDatabase;
  private userId: string;
  private memoryEffort: MemoryEffort;

  constructor(options: {
    memoryEffort: MemoryEffort;
    memoryModel: UserMemoryModel;
    serverDB: LobeChatDatabase;
    userId: string;
  }) {
    this.memoryModel = options.memoryModel;
    this.serverDB = options.serverDB;
    this.userId = options.userId;
    this.memoryEffort = options.memoryEffort;
  }

  searchMemory = async (params: SearchMemoryParams): Promise<SearchMemoryResult> => {
    const { provider, model: embeddingModel } =
      getServerDefaultFilesConfig().embeddingModel || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;

    const modelRuntime = await initModelRuntimeFromDB(this.serverDB, this.userId, provider);

    const queryEmbeddings = await modelRuntime.embeddings({
      dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
      input: params.query,
      model: embeddingModel,
    });

    const effectiveEffort = normalizeMemoryEffort(params.effort ?? this.memoryEffort);
    const effortDefaults = MEMORY_SEARCH_TOP_K_LIMITS[effectiveEffort];

    const requestedLimits = {
      activities: params.topK?.activities ?? effortDefaults.activities,
      contexts: params.topK?.contexts ?? effortDefaults.contexts,
      experiences: params.topK?.experiences ?? effortDefaults.experiences,
      preferences: params.topK?.preferences ?? effortDefaults.preferences,
    };

    const effortConstrainedLimits = applySearchLimitsByEffort(effectiveEffort, requestedLimits);

    const layeredResults = await this.memoryModel.searchWithEmbedding({
      embedding: queryEmbeddings?.[0],
      limits: effortConstrainedLimits,
    });

    return mapMemorySearchResult(layeredResults);
  };

  addContextMemory = async (
    input: z.infer<typeof ContextMemoryItemSchema>,
  ): Promise<AddContextMemoryResult> => {
    try {
      const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
        this.serverDB,
        this.userId,
      );
      const embed = createEmbedder(agentRuntime, embeddingModel);

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

      return {
        contextId: context.id,
        memoryId: memory.id,
        message: 'Memory saved successfully',
        success: true,
      };
    } catch (error) {
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
      const embed = createEmbedder(agentRuntime, embeddingModel);

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

      return {
        activityId: activity.id,
        memoryId: memory.id,
        message: 'Memory saved successfully',
        success: true,
      };
    } catch (error) {
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
      const embed = createEmbedder(agentRuntime, embeddingModel);

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

      return {
        experienceId: experience.id,
        memoryId: memory.id,
        message: 'Memory saved successfully',
        success: true,
      };
    } catch (error) {
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
      const embed = createEmbedder(agentRuntime, embeddingModel);

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

      return {
        identityId,
        memoryId: userMemoryId,
        message: 'Identity memory saved successfully',
        success: true,
      };
    } catch (error) {
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
      const embed = createEmbedder(agentRuntime, embeddingModel);

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

      return {
        memoryId: memory.id,
        message: 'Memory saved successfully',
        preferenceId: preference.id,
        success: true,
      };
    } catch (error) {
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
      const embed = createEmbedder(agentRuntime, embeddingModel);

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
        return {
          message: 'Identity memory not found',
          success: false,
        };
      }

      return {
        identityId: input.id,
        message: 'Identity memory updated successfully',
        success: true,
      };
    } catch (error) {
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
        return {
          message: 'Identity memory not found',
          success: false,
        };
      }

      return {
        identityId: input.id,
        message: 'Identity memory removed successfully',
        reason: input.reason,
        success: true,
      };
    } catch (error) {
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
      memoryEffort,
      memoryModel,
      serverDB: context.serverDB,
      userId: context.userId,
    });

    return new MemoryExecutionRuntime({
      service,
      toolPermission: context.memoryToolPermission,
    });
  },
  identifier: MemoryIdentifier,
};
