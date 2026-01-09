import { isDesktop } from '@lobechat/const';
import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import useSWR, { type SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';
import type { StateCreator } from 'zustand/vanilla';

import { DEFAULT_PREFERENCE } from '@/const/user';
import { mutate, useOnlyFetchOnceSWR } from '@/libs/swr';
import { userService } from '@/services/user';
import type { UserStore } from '@/store/user';
import type { GlobalServerConfig } from '@/types/serverConfig';
import { type LobeUser, type UserInitializationState } from '@/types/user';
import type { UserSettings } from '@/types/user/settings';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { userGeneralSettingsSelectors } from '../settings/selectors';

const n = setNamespace('common');

const GET_USER_STATE_KEY = 'initUserState';
/**
 * Common actions
 */
export interface CommonAction {
  refreshUserState: () => Promise<void>;
  updateAvatar: (avatar: string) => Promise<void>;
  updateFullName: (fullName: string) => Promise<void>;
  updateInterests: (interests: string[]) => Promise<void>;
  updateKeyVaultConfig: (provider: string, config: any) => Promise<void>;
  updateUsername: (username: string) => Promise<void>;
  useCheckTrace: (shouldFetch: boolean) => SWRResponse;
  useInitUserState: (
    isLogin: boolean | undefined,
    serverConfig: GlobalServerConfig,
    options?: {
      onError?: (error: any) => void;
      onSuccess: (data: UserInitializationState) => void;
    },
  ) => SWRResponse;
}

export const createCommonSlice: StateCreator<
  UserStore,
  [['zustand/devtools', never]],
  [],
  CommonAction
> = (set, get) => ({
  refreshUserState: async () => {
    await mutate(GET_USER_STATE_KEY);
  },
  updateAvatar: async (avatar) => {
    await userService.updateAvatar(avatar);
    await get().refreshUserState();
  },

  updateFullName: async (fullName) => {
    await userService.updateFullName(fullName);
    await get().refreshUserState();
  },

  updateInterests: async (interests) => {
    await userService.updateInterests(interests);
    await get().refreshUserState();
  },

  updateKeyVaultConfig: async (provider, config) => {
    await get().setSettings({ keyVaults: { [provider]: config } });
  },

  updateUsername: async (username) => {
    await userService.updateUsername(username);
    await get().refreshUserState();
  },

  useCheckTrace: (shouldFetch) =>
    useSWR<boolean>(
      shouldFetch ? 'checkTrace' : null,
      () => {
        const telemetry = userGeneralSettingsSelectors.telemetry(get());

        // if user have set the telemetry, return false
        if (typeof telemetry === 'boolean') return Promise.resolve(false);

        return Promise.resolve(get().isUserCanEnableTrace);
      },
      {
        revalidateOnFocus: false,
      },
    ),
  useInitUserState: (isLogin, serverConfig, options) =>
    useOnlyFetchOnceSWR<UserInitializationState>(
      !!isLogin || isDesktop ? GET_USER_STATE_KEY : null,
      () => userService.getUserState(),
      {
        onError: (error) => {
          options?.onError?.(error);
        },
        onSuccess: (data) => {
          options?.onSuccess?.(data);

          if (data) {
            // merge settings
            const serverSettings: PartialDeep<UserSettings> = {
              defaultAgent: serverConfig.defaultAgent,
              image: serverConfig.image,
              systemAgent: serverConfig.systemAgent,
            };

            const defaultSettings = merge(get().defaultSettings, serverSettings);

            // merge preference
            const isEmpty = Object.keys(data.preference || {}).length === 0;
            const preference = isEmpty ? DEFAULT_PREFERENCE : data.preference;

            // if there is avatar or userId (from client DB), update it into user
            const user =
              data.avatar || data.userId
                ? merge(get().user, {
                    avatar: data.avatar,
                    email: data.email,
                    firstName: data.firstName,
                    fullName: data.fullName,
                    id: data.userId,
                    interests: data.interests,
                    latestName: data.lastName,
                    username: data.username,
                  } as LobeUser)
                : get().user;

            set(
              {
                defaultSettings,
                isFreePlan: data.isFreePlan,
                isOnboard: data.isOnboard,
                isShowPWAGuide: data.canEnablePWAGuide,
                isUserCanEnableTrace: data.canEnableTrace,
                isUserHasConversation: data.hasConversation,
                isUserStateInit: true,
                onboarding: data.onboarding,
                preference,
                referralStatus: data.referralStatus,
                settings: data.settings || {},
                subscriptionPlan: data.subscriptionPlan,
                user,
              },
              false,
              n('initUserState'),
            );
            //analytics
            const analytics = getSingletonAnalyticsOptional();
            analytics?.identify(data.userId || '', {
              email: data.email,
              firstName: data.firstName,
              lastName: data.lastName,
              username: data.username,
            });
          }
        },
      },
    ),
});
