import {
  EMPTY_DOCUMENT_MESSAGES,
  formatWebOnboardingStateMessage,
} from '@lobechat/builtin-tool-web-onboarding/utils';
import { isDesktop } from '@lobechat/const';
import { hasApiKeyScope, isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import { applyMarkdownPatch, formatMarkdownPatchError } from '@lobechat/markdown-patch';
import type {
  ConfirmOnboardingUnderstandingInput,
  ConfirmOnboardingUnderstandingResult,
  CreateOnboardingTasksInput,
  OnboardingTaskRecommendationPollingResult,
  OnboardingTaskRecommendationTopicInput,
  OnboardingUnderstandingPollingResult,
  OnboardingUnderstandingTopicInput,
  RetryOnboardingUnderstandingProviderInput,
  ReviseOnboardingUnderstandingInput,
  StartOnboardingUnderstandingInput,
  UserInitializationState,
  UserPreference,
  UserSettings,
} from '@lobechat/types';
import {
  MAX_COLLECTION_COUNT,
  MAX_UNDERSTANDING_FEEDBACK_LENGTH,
  Plans,
  SaveUserQuestionInputSchema,
  UserAgentOnboardingSchema,
  UserGuideSchema,
  UserOnboardingSchema,
  UserPreferenceSchema,
  UserSettingsSchema,
} from '@lobechat/types';
import { errorCauseFrom } from '@lobechat/utils';
import { tracked, TRPCError } from '@trpc/server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import {
  getReferralStatus,
  getSubscriptionPlan,
  onUserActivityForBusiness,
} from '@/business/server/user';
import { MessageModel } from '@/database/models/message';
import { RbacModel } from '@/database/models/rbac';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { FileS3 } from '@/server/modules/S3';
import {
  mapTaskRecommendationTRPCError,
  mapUnderstandingTRPCError,
} from '@/server/routers/lambda/_helpers/onboardingError';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { FileService } from '@/server/services/file';
import { OnboardingService } from '@/server/services/onboarding';
import {
  onboardingProgressEventId,
  projectOnboardingGenerationProgress,
  subscribeToOnboardingGenerationProgress,
} from '@/server/services/onboardingProgress';
import {
  createTaskRecommendationService,
  TaskRecommendationNotFoundError,
} from '@/server/services/taskRecommendation/service';
import { understandingProviders } from '@/server/services/understanding/providers';
import { createUnderstandingService } from '@/server/services/understanding/service';
import { after } from '@/server/utils/scheduleAfterResponse';

const usernameSchema = z
  .string()
  .trim()
  .min(1, { message: 'USERNAME_REQUIRED' })
  .max(64, { message: 'USERNAME_TOO_LONG' })
  .regex(/^\w+$/, { message: 'USERNAME_INVALID' });

const understandingIdSchema = z.string().trim().min(1).max(512);
const onboardingUnderstandingTopicInputSchema = z
  .object({ topicId: understandingIdSchema })
  .strict() satisfies z.ZodType<OnboardingUnderstandingTopicInput>;
const startOnboardingUnderstandingInputSchema = z
  .object({
    providerIds: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(64)
          .regex(/^[\w-]+$/),
      )
      .max(16)
      .optional(),
    responseLanguage: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Z]{2,3}(?:-[A-Z0-9]{2,8})*$/i),
    topicId: understandingIdSchema,
  })
  .strict() satisfies z.ZodType<StartOnboardingUnderstandingInput>;
const retryOnboardingUnderstandingSourceInputSchema = z
  .object({
    providerId: understandingIdSchema,
    responseLanguage: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Z]{2,3}(?:-[A-Z0-9]{2,8})*$/i),
    sessionId: understandingIdSchema,
    topicId: understandingIdSchema,
  })
  .strict() satisfies z.ZodType<RetryOnboardingUnderstandingProviderInput>;
const confirmOnboardingUnderstandingInputSchema = z
  .object({
    resultId: understandingIdSchema,
    sessionId: understandingIdSchema,
    topicId: understandingIdSchema,
  })
  .strict() satisfies z.ZodType<ConfirmOnboardingUnderstandingInput>;
const reviseOnboardingUnderstandingInputSchema = z
  .object({
    expectedFeedbackRevision: z.number().int().nonnegative().max(MAX_COLLECTION_COUNT).optional(),
    feedback: z.string().trim().min(1).max(MAX_UNDERSTANDING_FEEDBACK_LENGTH).optional(),
    providerIds: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(64)
          .regex(/^[\w-]+$/),
      )
      .max(16),
    responseLanguage: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Z]{2,3}(?:-[A-Z0-9]{2,8})*$/i),
    sessionId: understandingIdSchema,
    topicId: understandingIdSchema,
  })
  .strict() satisfies z.ZodType<ReviseOnboardingUnderstandingInput>;
const onboardingTaskRecommendationTopicInputSchema = z
  .object({ topicId: understandingIdSchema })
  .strict() satisfies z.ZodType<OnboardingTaskRecommendationTopicInput>;
const onboardingGenerationProgressInputSchema = z
  .object({
    // tRPC injects this tracked cursor into reconnection inputs. It is intentionally not trusted
    // as application state; polling remains the durable source of truth.
    lastEventId: z.string().trim().min(1).max(4096).optional(),
    topicId: understandingIdSchema,
  })
  .strict();
const createOnboardingTasksInputSchema = z
  .object({
    recommendationIds: z.array(z.string().trim().min(1).max(128)).max(48),
    sessionId: understandingIdSchema,
    topicId: understandingIdSchema,
  })
  .strict() satisfies z.ZodType<CreateOnboardingTasksInput>;

const AVATAR_WEBAPI_PREFIX = '/webapi/';
const OWNER_SETTING_KEYS = ['defaultAgent', 'image', 'memory', 'systemAgent', 'tts'] as const;
const MEMBER_SETTING_KEYS = ['tool'] as const;
const WORKSPACE_UPDATE_PERMISSION = 'workspace:update:all';
const WORKSPACE_CONTENT_PERMISSIONS = ['agent:update:all', 'agent:update:owner'] as const;

// Accept only: base64 data URL, absolute http(s) URL, empty string,
// or an internal /webapi/user/avatar/<userId>/... path scoped to the caller.
// Any other value (relative path, file://, s3://, path-traversal, or another
// user's prefix) is rejected so a later upload can't be tricked into deleting
// an arbitrary S3 key via the "delete old avatar" step.
const assertSafeAvatarInput = (input: string, userId: string) => {
  if (input.length === 0) return;
  if (input.startsWith('data:image')) return;

  const ownPrefix = `${AVATAR_WEBAPI_PREFIX}user/avatar/${userId}/`;
  if (input.startsWith(ownPrefix) && !input.includes('..')) return;

  try {
    const { protocol } = new URL(input);
    if (protocol === 'http:' || protocol === 'https:') return;
  } catch {
    /* not a parseable absolute URL — fall through to reject */
  }

  throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_AVATAR_URL' });
};

const hasOwnerSettingChange = (input: Partial<UserSettings>) =>
  OWNER_SETTING_KEYS.some((key) => input[key] !== undefined);

const hasMemberSettingChange = (input: Partial<UserSettings>) =>
  MEMBER_SETTING_KEYS.some((key) => input[key] !== undefined);

const userProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  return next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId),
      // workspace-audit: intentionally personal-scoped (no workspaceId). These models
      // only feed `getUserState`'s user-lifetime onboarding gates (hasConversation /
      // canEnablePWAGuide / canEnableTrace), which are per-user, not per-workspace.
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      createOnboardingService: () => new OnboardingService(ctx.serverDB, ctx.userId),
      sessionModel: new SessionModel(ctx.serverDB, ctx.userId),
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

const personalOnboardingProcedure = userProcedure.use(async ({ ctx, next }) => {
  if (ctx.workspaceId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Onboarding is available only in personal scope',
    });
  }
  return next();
});
const understandingServiceProcedure = personalOnboardingProcedure
  .use(async ({ next }) => {
    const result = await next();
    if (!result.ok) {
      throw mapUnderstandingTRPCError(errorCauseFrom(result.error) ?? result.error);
    }
    return result;
  })
  .use(async ({ ctx, next }) => {
    const understandingService = await createUnderstandingService({
      db: ctx.serverDB,
      userId: ctx.userId,
    });

    return next({ ctx: { understandingService } });
  });
const taskRecommendationServiceProcedure = personalOnboardingProcedure.use(
  async ({ ctx, next }) => {
    const taskRecommendationService = await createTaskRecommendationService({
      db: ctx.serverDB,
      userId: ctx.userId,
    });
    const result = await next({ ctx: { taskRecommendationService } });
    if (!result.ok) {
      throw mapTaskRecommendationTRPCError(errorCauseFrom(result.error) ?? result.error);
    }
    return result;
  },
);
const onboardingGenerationProgressProcedure = personalOnboardingProcedure.use(
  async ({ ctx, next }) => {
    const [understandingService, taskRecommendationService] = await Promise.all([
      createUnderstandingService({ db: ctx.serverDB, userId: ctx.userId }),
      createTaskRecommendationService({ db: ctx.serverDB, userId: ctx.userId }),
    ]);
    const result = await next({ ctx: { taskRecommendationService, understandingService } });
    if (!result.ok) {
      throw mapUnderstandingTRPCError(errorCauseFrom(result.error) ?? result.error);
    }
    return result;
  },
);

const INITIAL_PROGRESS_RECOVERY_DELAY = 3_000;
const MAX_PROGRESS_RECOVERY_DELAY = 30_000;

const waitForProgressRecovery = (delay: number, signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export const userRouter = router({
  getUserActivitySummary: userProcedure.query(async ({ ctx }) => {
    return ctx.userModel.getUserActivitySummary();
  }),

  confirmOnboardingUnderstanding: understandingServiceProcedure
    .input(confirmOnboardingUnderstandingInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { personaVersion } = await ctx.understandingService.confirm(input);

      return {
        confirmed: true,
        personaVersion,
        resultId: input.resultId,
        sessionId: input.sessionId,
      } satisfies ConfirmOnboardingUnderstandingResult;
    }),

  createOnboardingTasks: taskRecommendationServiceProcedure
    .input(createOnboardingTasksInputSchema)
    .mutation(async ({ ctx, input }): Promise<Record<string, string>> => {
      return ctx.taskRecommendationService.createTasks(input);
    }),

  getOnboardingUnderstanding: understandingServiceProcedure
    .input(onboardingUnderstandingTopicInputSchema)
    .query(async ({ ctx, input }): Promise<OnboardingUnderstandingPollingResult> => {
      return ctx.understandingService.get(input.topicId);
    }),

  getOnboardingTaskRecommendations: taskRecommendationServiceProcedure
    .input(onboardingTaskRecommendationTopicInputSchema)
    .query(async ({ ctx, input }): Promise<OnboardingTaskRecommendationPollingResult> => {
      return ctx.taskRecommendationService.get(input.topicId);
    }),

  watchOnboardingGenerationProgress: onboardingGenerationProgressProcedure
    .input(onboardingGenerationProgressInputSchema)
    .subscription(async function* ({ ctx, input, signal }) {
      let lastEventId = input.lastEventId;
      const readPersistedProgress = async () => {
        const understanding = await ctx.understandingService.get(input.topicId);
        const taskRecommendations = await ctx.taskRecommendationService
          .get(input.topicId)
          .catch((error: unknown) => {
            if (error instanceof TaskRecommendationNotFoundError) return undefined;
            throw error;
          });
        const eventId = onboardingProgressEventId(understanding, taskRecommendations);
        const progress = projectOnboardingGenerationProgress(understanding, taskRecommendations);
        return { eventId, progress };
      };

      const initial = await readPersistedProgress();
      if (initial.eventId !== lastEventId) {
        lastEventId = initial.eventId;
        yield tracked(initial.eventId, initial.progress);
      }
      if (
        initial.progress.phase === 'completed' ||
        initial.progress.phase === 'failed' ||
        initial.progress.phase === 'partial'
      ) {
        return;
      }

      const subscription = await subscribeToOnboardingGenerationProgress(input.topicId);
      if (subscription) {
        try {
          while (!signal?.aborted) {
            const notification = await subscription.next(signal);
            if (!notification) return;

            if (notification.eventId !== lastEventId) {
              lastEventId = notification.eventId;
              yield tracked(notification.eventId, notification.progress);
            }
            if (
              notification.progress.phase === 'completed' ||
              notification.progress.phase === 'failed' ||
              notification.progress.phase === 'partial'
            ) {
              return;
            }
          }
        } finally {
          await subscription.unsubscribe();
        }
        return;
      }

      let recoveryDelay = INITIAL_PROGRESS_RECOVERY_DELAY;
      while (!signal?.aborted) {
        await waitForProgressRecovery(recoveryDelay, signal);
        if (signal?.aborted) return;

        const { eventId, progress } = await readPersistedProgress();
        if (eventId !== lastEventId) {
          lastEventId = eventId;
          yield tracked(eventId, progress);
        }

        if (
          progress.phase === 'completed' ||
          progress.phase === 'failed' ||
          progress.phase === 'partial'
        ) {
          return;
        }
        recoveryDelay = Math.min(recoveryDelay * 2, MAX_PROGRESS_RECOVERY_DELAY);
      }
    }),

  getSupportedUnderstandingProviders: understandingServiceProcedure.query(
    async ({
      ctx,
    }): Promise<{
      connectionSources: Record<string, 'composio' | 'lobehub'>;
      providerIds: string[];
      sourceProviderIds: string[];
    }> => {
      return {
        connectionSources: Object.fromEntries(
          understandingProviders.map((provider) => [provider.id, provider.connectionSource]),
        ),
        providerIds: understandingProviders.map((provider) => provider.id),
        sourceProviderIds: await ctx.understandingService.listSourceProviderIds(),
      };
    },
  ),

  getUserRegistrationDuration: userProcedure.query(async ({ ctx }) => {
    return ctx.userModel.getUserRegistrationDuration();
  }),

  getUserSSOProviders: userProcedure.query(async ({ ctx }) => {
    return ctx.userModel.getUserSSOProviders();
  }),

  getUserState: userProcedure.query(async ({ ctx }): Promise<UserInitializationState> => {
    try {
      after(async () => {
        try {
          const currentTime = new Date();
          const transition = await ctx.userModel.advanceLastActiveAt(currentTime);

          if (transition) {
            try {
              await onUserActivityForBusiness({
                currentTime,
                previousLastActiveAt: transition.previousLastActiveAt,
                userCreatedAt: transition.userCreatedAt,
                userId: ctx.userId,
              });
            } catch (err) {
              console.error('user activity hook failed, error:', err);
            }
          }
        } catch (err) {
          console.error('update lastActiveAt failed, error:', err);
        }
      });
    } catch {
      // `after` may fail outside request scope (e.g., in tests), ignore silently
    }

    // For desktop mode, ensure user exists before getting state
    if (isDesktop) {
      await UserModel.makeSureUserExist(ctx.serverDB, ctx.userId);
    }

    // Run user state fetch and count queries in parallel
    const [state, messageCount, hasExtraSession, referralStatus, subscriptionPlan] =
      await Promise.all([
        ctx.userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults),
        ctx.messageModel.countUpTo(5),
        ctx.sessionModel.hasMoreThanN(1),
        getReferralStatus(ctx.userId),
        getSubscriptionPlan(ctx.userId),
      ]);

    const hasMoreThan4Messages = messageCount > 4;
    const hasAnyMessages = messageCount > 0;
    return {
      avatar: state.avatar,
      canEnablePWAGuide: hasMoreThan4Messages,
      canEnableTrace: hasMoreThan4Messages,
      email: state.email,
      firstName: state.firstName,
      fullName: state.fullName,

      // Has conversation if there are messages or has created any assistant
      hasConversation: hasAnyMessages || hasExtraSession,

      agentOnboarding: state.agentOnboarding,
      interests: state.interests,

      // always return true for community version
      isOnboard: state.isOnboarded ?? true,
      lastName: state.lastName,
      onboarding: state.onboarding,
      preference: state.preference as UserPreference,
      // restricted API keys must not read decrypted provider/tool credentials
      // or Marketplace OAuth tokens
      settings:
        ctx.apiKeyScopes !== undefined && !isFullAccessApiKey(ctx.apiKeyScopes)
          ? { ...state.settings, keyVaults: undefined, market: undefined }
          : state.settings,
      userId: ctx.userId,
      username: state.username,

      // business features
      referralStatus,
      subscriptionPlan,
      isFreePlan: !subscriptionPlan || subscriptionPlan === Plans.Free,
    } satisfies UserInitializationState;
  }),

  makeUserOnboarded: userProcedure.mutation(async ({ ctx }) => {
    return ctx.userModel.updateUser({ isOnboarded: true });
  }),

  resetSettings: userProcedure.mutation(async ({ ctx }) => {
    return ctx.userModel.deleteSetting();
  }),

  reviseOnboardingUnderstanding: understandingServiceProcedure
    .input(reviseOnboardingUnderstandingInputSchema)
    .mutation(async ({ ctx, input }): Promise<OnboardingUnderstandingPollingResult> => {
      return ctx.understandingService.revise(input);
    }),

  retryOnboardingUnderstandingSource: understandingServiceProcedure
    .input(retryOnboardingUnderstandingSourceInputSchema)
    .mutation(async ({ ctx, input }): Promise<OnboardingUnderstandingPollingResult> => {
      return ctx.understandingService.retry(input);
    }),

  startOnboardingUnderstanding: understandingServiceProcedure
    .input(startOnboardingUnderstandingInputSchema)
    .mutation(async ({ ctx, input }): Promise<OnboardingUnderstandingPollingResult> => {
      return input.providerIds
        ? ctx.understandingService.start(input.topicId, input.responseLanguage, input.providerIds)
        : ctx.understandingService.start(input.topicId, input.responseLanguage);
    }),

  updateAvatar: userProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    assertSafeAvatarInput(input, ctx.userId);

    // If it's Base64 data, need to upload to S3
    if (input.startsWith('data:image')) {
      try {
        // Extract mimeType, e.g., "image/png"
        const prefix = 'data:';
        const semicolonIndex = input.indexOf(';');
        const mimeType =
          semicolonIndex !== -1 ? input.slice(prefix.length, semicolonIndex) : 'image/png';
        const fileType = mimeType.split('/')[1];

        // Split string to get the Base64 part
        const commaIndex = input.indexOf(',');
        if (commaIndex === -1) {
          throw new Error('Invalid Base64 data');
        }
        const base64Data = input.slice(commaIndex + 1);

        // Create S3 client
        const s3 = new FileS3();

        // Use UUID to generate unique filename to prevent caching issues
        // Get old avatar URL for later deletion
        const userState = await ctx.userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults);
        const oldAvatarUrl = userState.avatar;

        const fileName = `${uuidv4()}.${fileType}`;
        const filePath = `user/avatar/${ctx.userId}/${fileName}`;

        // Convert Base64 data to Buffer and upload to S3
        const buffer = Buffer.from(base64Data, 'base64');

        await s3.uploadBuffer(filePath, buffer, mimeType);

        // Delete old avatar — defense in depth: only touch keys inside the
        // caller's own avatar prefix, never external URLs or traversal paths.
        const ownAvatarWebapiPrefix = `${AVATAR_WEBAPI_PREFIX}user/avatar/${ctx.userId}/`;
        if (
          oldAvatarUrl &&
          oldAvatarUrl.startsWith(ownAvatarWebapiPrefix) &&
          !oldAvatarUrl.includes('..')
        ) {
          const oldFilePath = oldAvatarUrl.slice(AVATAR_WEBAPI_PREFIX.length);
          await s3.deleteFile(oldFilePath);
        }

        const avatarUrl = '/webapi/' + filePath;

        return ctx.userModel.updateUser({ avatar: avatarUrl });
      } catch (error) {
        throw new Error(
          'Error uploading avatar: ' + (error instanceof Error ? error.message : String(error)),
          { cause: error },
        );
      }
    }

    // If it's not Base64 data, directly use URL to update user avatar
    return ctx.userModel.updateUser({ avatar: input });
  }),

  updateFullName: userProcedure
    .input(z.string().trim().max(64, { message: 'FULLNAME_TOO_LONG' }))
    .mutation(async ({ ctx, input }) => {
      return ctx.userModel.updateUser({ fullName: input });
    }),

  updateGuide: userProcedure.input(UserGuideSchema).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updateGuide(input);
  }),

  updateInterests: userProcedure.input(z.array(z.string())).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updateUser({ interests: input });
  }),

  getOrCreateOnboardingState: userProcedure.query(async ({ ctx }) => {
    const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);

    return onboardingService.getOrCreateState();
  }),

  getOnboardingBootstrapState: userProcedure.query(async ({ ctx }) => {
    const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);

    return onboardingService.getBootstrapState();
  }),

  sendOnboardingFirstMessage: userProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);

      return onboardingService.sendOnboardingFirstMessage(input);
    }),

  getOnboardingAgentContext: userProcedure.query(async ({ ctx }) => {
    const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
    const docService = new AgentDocumentsService(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId ?? undefined,
    );
    const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);

    const [state, soulDoc, persona, userInfo] = await Promise.all([
      onboardingService.getState(),
      onboardingService
        .getInboxAgentId()
        .then((inboxAgentId) => docService.getDocumentByFilename(inboxAgentId, 'SOUL.md'))
        .catch(() => null),
      personaModel.getLatestPersonaDocument().catch(() => null),
      onboardingService.getInitialUserInfo().catch(() => undefined),
    ]);

    return {
      discoveryUserMessageCount: state.discoveryUserMessageCount,
      personaContent: persona?.persona || null,
      phaseGuidance: formatWebOnboardingStateMessage(state),
      remainingDiscoveryExchanges: state.remainingDiscoveryExchanges,
      soulContent: soulDoc?.content || null,
      userInfo,
    };
  }),

  saveUserQuestion: userProcedure
    .input(SaveUserQuestionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);

      return onboardingService.saveUserQuestion(input);
    }),

  finishOnboarding: userProcedure.input(z.object({})).mutation(async ({ ctx, input }) => {
    const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
    void input;

    return onboardingService.finishOnboarding();
  }),

  readOnboardingDocument: userProcedure
    .input(z.object({ type: z.enum(['soul', 'persona']) }))
    .query(async ({ ctx, input }) => {
      if (input.type === 'soul') {
        const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
        const docService = new AgentDocumentsService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        const inboxAgentId = await onboardingService.getInboxAgentId();
        const doc = await docService.getDocumentByFilename(inboxAgentId, 'SOUL.md');

        return {
          content: doc?.content || EMPTY_DOCUMENT_MESSAGES.soul,
          id: doc?.id ?? null,
          type: 'soul' as const,
        };
      }

      const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);
      const persona = await personaModel.getLatestPersonaDocument();

      return {
        content: persona?.persona || EMPTY_DOCUMENT_MESSAGES.persona,
        id: persona?.id ?? null,
        type: 'persona' as const,
      };
    }),

  updateOnboardingDocument: userProcedure
    .input(z.object({ content: z.string(), type: z.enum(['soul', 'persona']) }))
    .mutation(async ({ ctx, input }) => {
      if (input.type === 'soul') {
        const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
        const docService = new AgentDocumentsService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        const inboxAgentId = await onboardingService.getInboxAgentId();
        const doc = await docService.upsertDocumentByFilename({
          agentId: inboxAgentId,
          content: input.content,
          filename: 'SOUL.md',
        });

        return { id: doc?.id, type: 'soul' as const };
      }

      const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);
      const result = await personaModel.upsertPersona({
        editedBy: 'agent_tool',
        persona: input.content,
        profile: 'default',
      });

      return { id: result.document.id, type: 'persona' as const };
    }),

  patchOnboardingDocument: userProcedure
    .input(
      z.object({
        hunks: z
          .array(
            z.union([
              z.object({
                mode: z.literal('replace').optional(),
                replace: z.string(),
                replaceAll: z.boolean().optional(),
                search: z.string(),
              }),
              z.object({
                mode: z.literal('delete'),
                replaceAll: z.boolean().optional(),
                search: z.string(),
              }),
              z.object({
                endLine: z.number().int(),
                mode: z.literal('deleteLines'),
                startLine: z.number().int(),
              }),
              z.object({
                content: z.string(),
                line: z.number().int(),
                mode: z.literal('insertAt'),
              }),
              z.object({
                content: z.string(),
                endLine: z.number().int(),
                mode: z.literal('replaceLines'),
                startLine: z.number().int(),
              }),
            ]),
          )
          .min(1),
        type: z.enum(['soul', 'persona']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const readCurrent = async (): Promise<string> => {
        if (input.type === 'soul') {
          const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
          const docService = new AgentDocumentsService(
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          );
          const inboxAgentId = await onboardingService.getInboxAgentId();
          const doc = await docService.getDocumentByFilename(inboxAgentId, 'SOUL.md');
          return doc?.content ?? '';
        }

        const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);
        const persona = await personaModel.getLatestPersonaDocument();
        return persona?.persona ?? '';
      };

      const current = await readCurrent();
      const patched = applyMarkdownPatch(current, input.hunks);
      if (!patched.ok) {
        throw new TRPCError({
          cause: patched.error,
          code: 'BAD_REQUEST',
          message: formatMarkdownPatchError(patched.error),
        });
      }

      if (input.type === 'soul') {
        const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
        const docService = new AgentDocumentsService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        );
        const inboxAgentId = await onboardingService.getInboxAgentId();
        const doc = await docService.upsertDocumentByFilename({
          agentId: inboxAgentId,
          content: patched.content,
          filename: 'SOUL.md',
        });

        return { applied: patched.applied, id: doc?.id, type: 'soul' as const };
      }

      const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);
      const result = await personaModel.upsertPersona({
        editedBy: 'agent_tool',
        persona: patched.content,
        profile: 'default',
      });

      return { applied: patched.applied, id: result.document.id, type: 'persona' as const };
    }),

  resetAgentOnboarding: userProcedure.mutation(async ({ ctx }) => {
    return ctx.createOnboardingService().reset();
  }),

  updateAgentOnboarding: userProcedure
    .input(UserAgentOnboardingSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.userModel.updateUser({ agentOnboarding: input });
    }),

  updateOnboarding: userProcedure.input(UserOnboardingSchema).mutation(async ({ ctx, input }) => {
    return ctx.createOnboardingService().updateOnboarding(input);
  }),

  updatePreference: userProcedure.input(UserPreferenceSchema).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updatePreference(input);
  }),

  updateSettings: userProcedure.input(UserSettingsSchema).mutation(async ({ ctx, input }) => {
    const { keyVaults, ...res } = input as Partial<UserSettings>;
    // presence, not truthiness: `keyVaults: null` is an explicit credential clear
    const hasKeyVaultsUpdate = 'keyVaults' in (input as Partial<UserSettings>);

    // credential-bearing settings: `keyVaults` holds provider/tool credentials,
    // `market` holds Marketplace OAuth access/refresh tokens. A restricted key
    // needs `model:write` on top of the namespace's `user:write` to touch (or
    // clear) either; full-access keys pass through.
    const touchedCredentialFields = ['keyVaults', 'market'].filter(
      (field) => field in (input as Partial<UserSettings>),
    );
    if (
      touchedCredentialFields.length > 0 &&
      ctx.apiKeyScopes !== undefined &&
      !isFullAccessApiKey(ctx.apiKeyScopes) &&
      !hasApiKeyScope(ctx.apiKeyScopes, 'model:write')
    ) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `This API key cannot update credential settings ('${touchedCredentialFields.join("', '")}'): missing required scope 'model:write'.`,
      });
    }

    if (ctx.workspaceId && (hasOwnerSettingChange(res) || hasMemberSettingChange(res))) {
      const rbac = new RbacModel(ctx.serverDB, ctx.userId);
      const allowed = hasOwnerSettingChange(res)
        ? await rbac.hasPermission(WORKSPACE_UPDATE_PERMISSION, {
            workspaceId: ctx.workspaceId,
          })
        : await rbac.hasAnyPermission([...WORKSPACE_CONTENT_PERMISSIONS], {
            workspaceId: ctx.workspaceId,
          });

      if (!allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action.',
        });
      }
    }

    // Encrypt keyVaults; only touch the column when the caller sent the field,
    // so a settings update without `keyVaults` no longer clears stored creds
    const nextValue: Record<string, unknown> = { ...res };

    if (hasKeyVaultsUpdate) {
      let encryptedKeyVaults: string | null = null;

      if (keyVaults) {
        // TODO: better to add a validation
        const data = JSON.stringify(keyVaults);
        const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

        encryptedKeyVaults = await gateKeeper.encrypt(data);
      }

      nextValue.keyVaults = encryptedKeyVaults;
    }

    return ctx.userModel.updateSetting(nextValue);
  }),

  updateUsername: userProcedure.input(usernameSchema).mutation(async ({ ctx, input }) => {
    const existedUser = await UserModel.findByUsername(ctx.serverDB, input);
    if (existedUser && existedUser.id !== ctx.userId) {
      throw new TRPCError({ code: 'CONFLICT', message: 'USERNAME_TAKEN' });
    }

    return ctx.userModel.updateUser({ username: input });
  }),
});

export type UserRouter = typeof userRouter;
