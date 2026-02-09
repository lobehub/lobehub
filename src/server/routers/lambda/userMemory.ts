import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
  CreateUserMemoryIdentitySchema,
  MemorySourceType,
  UpdateUserMemoryIdentitySchema,
  UserMemoryExtractionMetadata,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AsyncTaskModel, initUserMemoryExtractionMetadata } from '@/database/models/asyncTask';
import { TopicModel } from '@/database/models/topic';
import { UserMemoryModel } from '@/database/models/userMemory';
import {
  UserMemoryActivityModel,
  UserMemoryContextModel,
  UserMemoryExperienceModel,
  UserMemoryIdentityModel,
  UserMemoryPreferenceModel,
} from '@/database/models/userMemory/index';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { appEnv } from '@/envs/app';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import {
  MemoryExtractionWorkflowService,
  buildWorkflowPayloadInput,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

const userMemoryProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      activityModel: new UserMemoryActivityModel(ctx.serverDB, ctx.userId),
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      contextModel: new UserMemoryContextModel(ctx.serverDB, ctx.userId),
      experienceModel: new UserMemoryExperienceModel(ctx.serverDB, ctx.userId),
      identityModel: new UserMemoryIdentityModel(ctx.serverDB, ctx.userId),
      personaModel: new UserPersonaModel(ctx.serverDB, ctx.userId),
      preferenceModel: new UserMemoryPreferenceModel(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
      userMemoryModel: new UserMemoryModel(ctx.serverDB, ctx.userId),
    },
  });
});

const userMemoryExtractionInputSchema = z.object({
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

const userMemoryExtractionTaskInputSchema = z
  .object({
    taskId: z.string().uuid().optional(),
  })
  .optional();

export const userMemoryRouter = router({
  // ============ Identity CRUD ============
  createIdentity: userMemoryProcedure
    .input(CreateUserMemoryIdentitySchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.userMemoryModel.addIdentityEntry({
        base: {},
        identity: {
          description: input.description,
          episodicDate: input.episodicDate,
          relationship: input.relationship,
          role: input.role,
          tags: input.extractedLabels,
          type: input.type,
        },
      });
    }),

  // ============ Activity CRUD ============
  deleteActivity: userMemoryProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.activityModel.delete(input.id);
    }),

  // ============ Context CRUD ============
  deleteContext: userMemoryProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.contextModel.delete(input.id);
    }),

  // ============ Experience CRUD ============
  deleteExperience: userMemoryProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.experienceModel.delete(input.id);
    }),

  deleteIdentity: userMemoryProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.userMemoryModel.removeIdentityEntry(input.id);
    }),

  // ============ Preference CRUD ============
  deletePreference: userMemoryProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.preferenceModel.delete(input.id);
    }),

  getActivities: userMemoryProcedure.query(async ({ ctx }) => {
    return ctx.userMemoryModel.searchActivities({});
  }),

  getContexts: userMemoryProcedure.query(async ({ ctx }) => {
    return ctx.userMemoryModel.searchContexts({});
  }),

  getExperiences: userMemoryProcedure.query(async ({ ctx }) => {
    return ctx.userMemoryModel.searchExperiences({});
  }),

  getIdentities: userMemoryProcedure.query(async ({ ctx }) => {
    return ctx.userMemoryModel.getAllIdentities();
  }),

  getMemoryExtractionTask: userMemoryProcedure
    .input(userMemoryExtractionTaskInputSchema)
    .query(async ({ ctx, input }) => {
      const task = input?.taskId
        ? await ctx.asyncTaskModel.findById(input.taskId)
        : await ctx.asyncTaskModel.findActiveByType(
            AsyncTaskType.UserMemoryExtractionWithChatTopic,
          );

      if (!task || task.userId !== ctx.userId) return null;

      return {
        error: task.error,
        id: task.id,
        metadata: initUserMemoryExtractionMetadata(
          task.metadata as UserMemoryExtractionMetadata | undefined,
        ),
        status: task.status as AsyncTaskStatus,
      };
    }),

  // ============ Persona ============
  getPersona: userMemoryProcedure.query(async ({ ctx }) => {
    const latest = await ctx.personaModel.getLatestPersonaDocument();

    if (!latest) return null;

    return {
      content: latest.persona ?? '',
      summary: latest.tagline ?? '',
    };
  }),

  getPreferences: userMemoryProcedure.query(async ({ ctx }) => {
    return ctx.userMemoryModel.searchPreferences({});
  }),

  requestMemoryFromChatTopic: userMemoryProcedure
    .input(userMemoryExtractionInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.fromDate && input.toDate && input.fromDate > input.toDate) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '`fromDate` cannot be later than `toDate`',
        });
      }

      const existingTask = await ctx.asyncTaskModel.findActiveByType(
        AsyncTaskType.UserMemoryExtractionWithChatTopic,
      );
      if (existingTask) {
        return {
          deduped: true,
          id: existingTask.id,
          metadata: existingTask.metadata as UserMemoryExtractionMetadata,
          status: existingTask.status as AsyncTaskStatus,
        };
      }

      const totalTopics = await ctx.topicModel.countTopicsForMemoryExtractor({
        endDate: input.toDate,
        ignoreExtracted: false,
        startDate: input.fromDate,
      });
      const metadata = initUserMemoryExtractionMetadata({
        progress: {
          completedTopics: 0,
          totalTopics,
        },
        range: {
          from: input.fromDate?.toISOString(),
          to: input.toDate?.toISOString(),
        },
        source: 'chat_topic',
      });

      const initialStatus = totalTopics === 0 ? AsyncTaskStatus.Success : AsyncTaskStatus.Pending;
      const taskId = await ctx.asyncTaskModel.create({
        metadata,
        status: initialStatus,
        type: AsyncTaskType.UserMemoryExtractionWithChatTopic,
      });

      if (totalTopics === 0) {
        return {
          deduped: false,
          id: taskId,
          metadata: metadata as UserMemoryExtractionMetadata,
          status: initialStatus as AsyncTaskStatus,
        };
      }

      const { webhook, upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();
      const baseUrl = webhook.baseUrl || appEnv.INTERNAL_APP_URL || appEnv.APP_URL;

      try {
        await MemoryExtractionWorkflowService.triggerProcessUsers(
          buildWorkflowPayloadInput(
            normalizeMemoryExtractionPayload({
              asyncTaskId: taskId,
              baseUrl,
              forceAll: false,
              forceTopics: false,
              fromDate: input.fromDate,
              mode: 'workflow',
              sources: [MemorySourceType.ChatTopic],
              toDate: input.toDate,
              userIds: [ctx.userId],
              userInitiated: true,
            }),
          ),
          { extraHeaders: upstashWorkflowExtraHeaders },
        );
      } catch (error) {
        await ctx.asyncTaskModel.update(taskId, {
          error: new AsyncTaskError(
            AsyncTaskErrorType.TaskTriggerError,
            'Failed to schedule memory extraction workflow',
          ),
          status: AsyncTaskStatus.Error,
        });
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to trigger user memory extraction',
        });
      }

      return {
        deduped: false,
        id: taskId,
        metadata: metadata as UserMemoryExtractionMetadata,
        status: AsyncTaskStatus.Pending,
      };
    }),

  updateActivity: userMemoryProcedure
    .input(
      z.object({
        data: z.object({
          narrative: z.string().optional(),
          notes: z.string().optional(),
          status: z.string().optional(),
        }),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.activityModel.update(input.id, input.data);
    }),

  updateContext: userMemoryProcedure
    .input(
      z.object({
        data: z.object({
          currentStatus: z.string().optional(),
          description: z.string().optional(),
          title: z.string().optional(),
        }),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.contextModel.update(input.id, input.data);
    }),

  updateExperience: userMemoryProcedure
    .input(
      z.object({
        data: z.object({
          action: z.string().optional(),
          keyLearning: z.string().optional(),
          situation: z.string().optional(),
        }),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.experienceModel.update(input.id, input.data);
    }),

  updateIdentity: userMemoryProcedure
    .input(
      z.object({
        data: UpdateUserMemoryIdentitySchema,
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.userMemoryModel.updateIdentityEntry({
        identity: {
          description: input.data.description,
          episodicDate: input.data.episodicDate,
          relationship: input.data.relationship,
          role: input.data.role,
          tags: input.data.extractedLabels,
          type: input.data.type,
        },
        identityId: input.id,
      });
    }),

  updatePreference: userMemoryProcedure
    .input(
      z.object({
        data: z.object({
          conclusionDirectives: z.string().optional(),
          suggestions: z.string().optional(),
        }),
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.preferenceModel.update(input.id, input.data);
    }),
});

export type UserMemoryRouter = typeof userMemoryRouter;
