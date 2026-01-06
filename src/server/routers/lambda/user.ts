import { type UserJSON } from '@clerk/backend';
import { enableClerk, isDesktop } from '@lobechat/const';
import {
  NextAuthAccountSchame,
  Plans,
  UserGuideSchema,
  type UserInitializationState,
  UserOnboardingSchema,
  type UserPreference,
  UserPreferenceSchema,
  type UserSettings,
  UserSettingsSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { after } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { getIsInWaitList, getReferralStatus, getSubscriptionPlan } from '@/business/server/user';
import { MessageModel } from '@/database/models/message';
import { SessionModel } from '@/database/models/session';
import { UserModel, UserNotFoundError } from '@/database/models/user';
import { ClerkAuth } from '@/libs/clerk-auth';
import { pino } from '@/libs/logger';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { FileS3 } from '@/server/modules/S3';
import { FileService } from '@/server/services/file';
import { NextAuthUserService } from '@/server/services/nextAuthUser';
import { UserService } from '@/server/services/user';

const usernameSchema = z
  .string()
  .trim()
  .min(1, { message: 'USERNAME_REQUIRED' })
  .regex(/^\w+$/, { message: 'USERNAME_INVALID' });

const userProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  return next({
    ctx: {
      clerkAuth: new ClerkAuth(),
      fileService: new FileService(ctx.serverDB, ctx.userId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      nextAuthUserService: new NextAuthUserService(ctx.serverDB),
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

    // Helper function to get or create user state
    const getOrCreateUserState = async () => {
      let state: Awaited<ReturnType<UserModel['getUserState']>> | undefined;

      // get or create first-time user
      while (!state) {
        try {
          state = await ctx.userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults);
        } catch (error) {
          // user not create yet
          if (error instanceof UserNotFoundError) {
            // if in clerk auth mode
            if (enableClerk) {
              const user = await ctx.clerkAuth.getCurrentUser();
              if (user) {
                const userService = new UserService(ctx.serverDB);

                await userService.createUser(user.id, {
                  created_at: user.createdAt,
                  email_addresses: user.emailAddresses.map((e) => ({
                    email_address: e.emailAddress,
                    id: e.id,
                  })),
                  first_name: user.firstName,
                  id: user.id,
                  image_url: user.imageUrl,
                  last_name: user.lastName,
                  phone_numbers: user.phoneNumbers.map((e) => ({
                    id: e.id,
                    phone_number: e.phoneNumber,
                  })),
                  primary_email_address_id: user.primaryEmailAddressId,
                  primary_phone_number_id: user.primaryPhoneNumberId,
                  username: user.username,
                } as UserJSON);

                continue;
              }
            }

            // if in desktop mode, make sure desktop user exist
            else if (isDesktop) {
              await UserModel.makeSureUserExist(ctx.serverDB, ctx.userId);
              pino.info('create desktop user');
              continue;
            }
          }

          console.error('getUserState:', error);
          throw error;
        }
      }

      return state;
    };

    // Run user state fetch and count queries in parallel
    const [state, messageCount, hasExtraSession, referralStatus, subscriptionPlan, isInWaitList] =
      await Promise.all([
        getOrCreateUserState(),
        ctx.messageModel.countUpTo(5),
        ctx.sessionModel.hasMoreThanN(1),
        getReferralStatus(ctx.userId),
        getSubscriptionPlan(ctx.userId),
        getIsInWaitList(ctx.userId),
      ]);

    const hasMoreThan4Messages = messageCount > 4;
    const hasAnyMessages = messageCount > 0;
    /* eslint-disable sort-keys-fix/sort-keys-fix */
    return {
      avatar: state.avatar,
      canEnablePWAGuide: hasMoreThan4Messages,
      canEnableTrace: hasMoreThan4Messages,
      email: state.email,
      firstName: state.firstName,
      fullName: state.fullName,

      // 有消息，或者创建过助理，则认为有 conversation
      hasConversation: hasAnyMessages || hasExtraSession,

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
      isInWaitList,
      isFreePlan: !subscriptionPlan || subscriptionPlan === Plans.Free,
    } satisfies UserInitializationState;
    /* eslint-enable sort-keys-fix/sort-keys-fix */
  }),

  makeUserOnboarded: userProcedure.mutation(async ({ ctx }) => {
    return ctx.userModel.updateUser({ isOnboarded: true });
  }),

  resetSettings: userProcedure.mutation(async ({ ctx }) => {
    return ctx.userModel.deleteSetting();
  }),

  unlinkSSOProvider: userProcedure.input(NextAuthAccountSchame).mutation(async ({ ctx, input }) => {
    const { provider, providerAccountId } = input;
    const account = await ctx.nextAuthUserService.getAccount(providerAccountId, provider);
    // The userId can either get from ctx.nextAuth?.id or ctx.userId
    if (!account || account.userId !== ctx.userId) throw new Error('The account does not exist');
    await ctx.nextAuthUserService.unlinkAccount({ provider, providerAccountId });
  }),

  updateAvatar: userProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    // 如果是 Base64 数据，需要上传到 S3
    if (input.startsWith('data:image')) {
      try {
        // 提取 mimeType，例如 "image/png"
        const prefix = 'data:';
        const semicolonIndex = input.indexOf(';');
        const mimeType =
          semicolonIndex !== -1 ? input.slice(prefix.length, semicolonIndex) : 'image/png';
        const fileType = mimeType.split('/')[1];

        // 分割字符串，获取 Base64 部分
        const commaIndex = input.indexOf(',');
        if (commaIndex === -1) {
          throw new Error('Invalid Base64 data');
        }
        const base64Data = input.slice(commaIndex + 1);

        // 创建 S3 客户端
        const s3 = new FileS3();

        // 使用 UUID 生成唯一文件名，防止缓存问题
        // 获取旧头像 URL, 后面删除该头像
        const userState = await ctx.userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults);
        const oldAvatarUrl = userState.avatar;

        const fileName = `${uuidv4()}.${fileType}`;
        const filePath = `user/avatar/${ctx.userId}/${fileName}`;

        // 将 Base64 数据转换为 Buffer 再上传到 S3
        const buffer = Buffer.from(base64Data, 'base64');

        await s3.uploadBuffer(filePath, buffer, mimeType);

        // 删除旧头像
        if (oldAvatarUrl && oldAvatarUrl.startsWith('/webapi/')) {
          const oldFilePath = oldAvatarUrl.replace('/webapi/', '');
          await s3.deleteFile(oldFilePath);
        }

        const avatarUrl = '/webapi/' + filePath;

        return ctx.userModel.updateUser({ avatar: avatarUrl });
      } catch (error) {
        throw new Error(
          'Error uploading avatar: ' + (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    // 如果不是 Base64 数据，直接使用 URL 更新用户头像
    return ctx.userModel.updateUser({ avatar: input });
  }),

  updateFullName: userProcedure.input(z.string()).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updateUser({ fullName: input });
  }),

  updateGuide: userProcedure.input(UserGuideSchema).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updateGuide(input);
  }),

  updateInterests: userProcedure.input(z.array(z.string())).mutation(async ({ ctx, input }) => {
    return ctx.userModel.updateUser({ interests: input });
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
    const username = input.trim();

    const existedUser = await UserModel.findByUsername(ctx.serverDB, username);
    if (existedUser && existedUser.id !== ctx.userId) {
      throw new TRPCError({ code: 'CONFLICT', message: 'USERNAME_TAKEN' });
    }

    return ctx.userModel.updateUser({ username });
  }),
});

export type UserRouter = typeof userRouter;
