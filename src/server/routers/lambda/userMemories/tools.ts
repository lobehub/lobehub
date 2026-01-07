import {
  AddIdentityActionSchema,
  ContextMemoryItemSchema,
  ExperienceMemoryItemSchema,
  PreferenceMemoryItemSchema,
  RemoveIdentityActionSchema,
  UpdateIdentityActionSchema,
} from '@lobechat/memory-user-memory';

import {
  type IdentityEntryBasePayload,
  type IdentityEntryPayload,
  UserMemoryModel,
} from '@/database/models/userMemory';
import { searchMemorySchema } from '@/types/userMemory';

import { searchUserMemories } from './search';
import { createEmbedder, getEmbeddingRuntime, memoryProcedure, router } from './shared';

export const toolsRouter = router({
  addContextMemory: memoryProcedure
    .input(ContextMemoryItemSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
        );
        const embed = createEmbedder(agentRuntime, embeddingModel);

        const summaryEmbedding = await embed(input.summary);
        const detailsEmbedding = await embed(input.details);
        const contextDescriptionEmbedding = await embed(input.withContext.description);

        const { context, memory } = await ctx.memoryModel.createContextMemory({
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
          memoryLayer: input.memoryLayer,
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
        console.error('Failed to save memory:', error);
        return {
          message: `Failed to save memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  addExperienceMemory: memoryProcedure
    .input(ExperienceMemoryItemSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
        );
        const embed = createEmbedder(agentRuntime, embeddingModel);

        const summaryEmbedding = await embed(input.summary);
        const detailsEmbedding = await embed(input.details);
        const situationVector = await embed(input.withExperience.situation);
        const actionVector = await embed(input.withExperience.action);
        const keyLearningVector = await embed(input.withExperience.keyLearning);

        const { experience, memory } = await ctx.memoryModel.createExperienceMemory({
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
          memoryLayer: input.memoryLayer,
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
        console.error('Failed to save memory:', error);
        return {
          message: `Failed to save memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  addIdentityMemory: memoryProcedure
    .input(AddIdentityActionSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
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

        const { identityId, userMemoryId } = await ctx.memoryModel.addIdentityEntry({
          base: {
            details: input.details,
            detailsVector1024: detailsEmbedding ?? null,
            memoryCategory: input.memoryCategory,
            memoryLayer: input.memoryLayer,
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
        console.error('Failed to save identity memory:', error);
        return {
          message: `Failed to save identity memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  addPreferenceMemory: memoryProcedure
    .input(PreferenceMemoryItemSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
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

        const { memory, preference } = await ctx.memoryModel.createPreferenceMemory({
          details: input.details || '',
          detailsEmbedding,
          memoryCategory: input.memoryCategory,
          memoryLayer: input.memoryLayer,
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
        console.error('Failed to save memory:', error);
        return {
          message: `Failed to save memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  removeIdentityMemory: memoryProcedure
    .input(RemoveIdentityActionSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const removed = await ctx.memoryModel.removeIdentityEntry(input.id);

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
        console.error('Failed to remove identity memory:', error);
        return {
          message: `Failed to remove identity memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  searchMemory: memoryProcedure.input(searchMemorySchema).query(async ({ input, ctx }) => {
    try {
      return await searchUserMemories(ctx, input);
    } catch (error) {
      console.error('Failed to retrieve memories:', error);
      return { contexts: [], experiences: [], preferences: [] };
    }
  }),

  updateIdentityMemory: memoryProcedure
    .input(UpdateIdentityActionSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
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

        const updated = await ctx.memoryModel.updateIdentityEntry({
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
        console.error('Failed to update identity memory:', error);
        return {
          message: `Failed to update identity memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),
});
