import { EMPTY_DOCUMENT_MESSAGES } from '@lobechat/builtin-tool-web-onboarding/utils';
import { isDesktop } from '@lobechat/const';
import { applyMarkdownPatch, formatMarkdownPatchError } from '@lobechat/markdown-patch';
import {
  type UserInitializationState,
  type UserPreference,
  type UserSettings,
} from '@lobechat/types';
import {
  Plans,
  SaveUserQuestionInputSchema,
  UserAgentOnboardingSchema,
  UserGuideSchema,
  UserOnboardingSchema,
  UserPreferenceSchema,
  UserSettingsSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { after } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { getReferralStatus, getSubscriptionPlan } from '@/business/server/user';
import { MessageModel } from '@/database/models/message';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { FileS3 } from '@/server/modules/S3';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { FileService } from '@/server/services/file';
import { OnboardingService } from '@/server/services/onboarding';

const usernameSchema = z
  .string()
  .trim()
  .min(1, { message: 'USERNAME_REQUIRED' })
  .max(64, { message: 'USERNAME_TOO_LONG' })
  .regex(/^\w+$/, { message: 'USERNAME_INVALID' });

const AVATAR_WEBAPI_PREFIX = '/webapi/';

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

const userProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  return next({
    ctx: {
      fileService: new FileService(ctx.serverDB, ctx.userId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      sessionModel: new SessionModel(ctx.serverDB, ctx.userId),
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const userRouter = router({
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
          await ctx.userModel.updateUser({ lastActiveAt: new Date() });
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
      settings: state.settings,
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

  getOnboardingState: userProcedure.query(async ({ ctx }) => {
    const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);

    return onboardingService.getState();
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
        const docService = new AgentDocumentsService(ctx.serverDB, ctx.userId);
        const inboxAgentId = await onboardingService.getInboxAgentId();
        const doc = await docService.getDocumentByFilename(inboxAgentId, 'SOUL.md');

        return {
          content: doc?.content || EMPTY_DOCUMENT_MESSAGES.soul,
          id: doc?.id ?? null,
          type: 'soul' as const,
        };
      }

      const { UserPersonaModel } = await import('@/database/models/userMemory/persona');
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
        const docService = new AgentDocumentsService(ctx.serverDB, ctx.userId);
        const inboxAgentId = await onboardingService.getInboxAgentId();
        const doc = await docService.upsertDocumentByFilename({
          agentId: inboxAgentId,
          content: input.content,
          filename: 'SOUL.md',
        });

        return { id: doc?.id, type: 'soul' as const };
      }

      const { UserPersonaModel } = await import('@/database/models/userMemory/persona');
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
            z.object({
              replace: z.string(),
              replaceAll: z.boolean().optional(),
              search: z.string(),
            }),
          )
          .min(1),
        type: z.enum(['soul', 'persona']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const readCurrent = async (): Promise<string> => {
        if (input.type === 'soul') {
          const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);
          const docService = new AgentDocumentsService(ctx.serverDB, ctx.userId);
          const inboxAgentId = await onboardingService.getInboxAgentId();
          const doc = await docService.getDocumentByFilename(inboxAgentId, 'SOUL.md');
          return doc?.content ?? '';
        }

        const { UserPersonaModel } = await import('@/database/models/userMemory/persona');
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
        const docService = new AgentDocumentsService(ctx.serverDB, ctx.userId);
        const inboxAgentId = await onboardingService.getInboxAgentId();
        const doc = await docService.upsertDocumentByFilename({
          agentId: inboxAgentId,
          content: patched.content,
          filename: 'SOUL.md',
        });

        return { applied: patched.applied, id: doc?.id, type: 'soul' as const };
      }

      const { UserPersonaModel } = await import('@/database/models/userMemory/persona');
      const personaModel = new UserPersonaModel(ctx.serverDB, ctx.userId);
      const result = await personaModel.upsertPersona({
        editedBy: 'agent_tool',
        persona: patched.content,
        profile: 'default',
      });

      return { applied: patched.applied, id: result.document.id, type: 'persona' as const };
    }),

  resetAgentOnboarding: userProcedure.mutation(async ({ ctx }) => {
    const onboardingService = new OnboardingService(ctx.serverDB, ctx.userId);

    return onboardingService.reset();
  }),

  updateAgentOnboarding: userProcedure
    .input(UserAgentOnboardingSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.userModel.updateUser({ agentOnboarding: input });
    }),

  updateOnboarding: userProcedure.input(UserOnboardingSchema).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updateUser({ onboarding: input });
  }),

  updatePreference: userProcedure.input(UserPreferenceSchema).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updatePreference(input);
  }),

  updateSettings: userProcedure.input(UserSettingsSchema).mutation(async ({ ctx, input }) => {
    const { keyVaults, ...res } = input as Partial<UserSettings>;

    // Encrypt keyVaults
    let encryptedKeyVaults: string | null = null;

    if (keyVaults) {
      // TODO: better to add a validation
      const data = JSON.stringify(keyVaults);
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

      encryptedKeyVaults = await gateKeeper.encrypt(data);
    }

    const nextValue = { ...res, keyVaults: encryptedKeyVaults };

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
