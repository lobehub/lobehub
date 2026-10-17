import { isDesktop } from '@lobechat/const';
import { isFullAccessApiKey } from '@lobechat/const/apiKeyScope';
import type { UserInitializationState, UserPreference } from '@lobechat/types';
import { Plans, UserGuideSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import {
  getReferralStatus,
  getSubscriptionPlan,
  onUserActivityForBusiness,
} from '@/business/server/user';
import { UserModel } from '@/database/models/user';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { FileS3 } from '@/server/modules/S3';
import { after } from '@/server/utils/scheduleAfterResponse';

import { userProcedure } from './procedures';

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

export const profileProcedures = {
  getUserActivitySummary: userProcedure.query(async ({ ctx }) => {
    return ctx.userModel.getUserActivitySummary();
  }),
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
  updateUsername: userProcedure.input(usernameSchema).mutation(async ({ ctx, input }) => {
    const existedUser = await UserModel.findByUsername(ctx.serverDB, input);
    if (existedUser && existedUser.id !== ctx.userId) {
      throw new TRPCError({ code: 'CONFLICT', message: 'USERNAME_TAKEN' });
    }

    return ctx.userModel.updateUser({ username: input });
  }),
};
