import { isDesktop } from '@lobechat/const';
import type { ReplicaSlice } from '@lobechat/replica/zustand';
import type { UserGeneralConfig } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';
import { type PartialDeep } from 'type-fest';

import { DEFAULT_PREFERENCE } from '@/const/user';
import { analyticsClient } from '@/libs/analytics/client';
import { createReplicaSlice, type ReplicaLens, type ReplicaSyncResult } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { taskTemplateKeys, userKeys } from '@/libs/swr/keys';
import { userService } from '@/services/user';
import { type StoreSetter } from '@/store/types';
import { type UserStore } from '@/store/user';
import { type GlobalServerConfig } from '@/types/serverConfig';
import { type LobeUser, type UserInitializationState } from '@/types/user';
import { type UserSettings } from '@/types/user/settings';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { writeUserDisplaySnapshot } from '../../displaySnapshot';
import { userGeneralSettingsSelectors } from '../settings/selectors';
import type { CommonState } from './initialState';
import { createUserStateResource, USER_STATE_KEY } from './projection';

const n = setNamespace('common');

/**
 * The fields the bootstrap projection owns. Resetting drops the replica view
 * (so a scope switch re-gates on the new identity's response) without touching
 * `user` / `settings` / `preference`, which other slices also write.
 */
const EMPTY_BOOTSTRAP: Partial<CommonState> = {
  isUserStateInit: false,
  isUserStateInitError: undefined,
  userState: undefined,
};

const USER_STATE_PARAMS = {} as Record<string, never>;

type UserStateReplica = ReplicaSlice<UserStore, Record<string, never>, UserInitializationState>;

/**
 * Common actions
 */

type Setter = StoreSetter<UserStore>;
export const createCommonSlice = (set: Setter, get: () => UserStore, _api?: unknown) =>
  new CommonActionImpl(set, get, _api);

export const isTaskTemplateRecommendationKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === taskTemplateKeys.listDailyRecommend.root;

export class CommonActionImpl {
  readonly #get: () => UserStore;
  readonly #set: Setter;
  /**
   * Replica of the bootstrap payload; the flat flags below are its view.
   * Created on first use — the resource lives on the user store, which the
   * replica wiring itself reads back (see `createUserStateResource`).
   */
  #userState?: UserStateReplica;
  /**
   * The server config of the current app instance. It is not part of the
   * replica value (it is a boot-time global, not user data), so the projection
   * reads it from the latest `useInitUserState` call.
   */
  #serverConfig?: GlobalServerConfig;

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  /**
   * Project the confirmed bootstrap payload onto the flat store fields every
   * selector already reads. Mirrors the previous hand-written `#set` block.
   */
  #project = (state: UserStore, data: UserInitializationState): Partial<UserStore> => {
    // merge settings
    const serverSettings: PartialDeep<UserSettings> = {
      defaultAgent: this.#serverConfig?.defaultAgent,
      image: this.#serverConfig?.image,
      systemAgent: this.#serverConfig?.systemAgent,
    };

    const defaultSettings = merge(state.defaultSettings, serverSettings);

    // merge preference
    const isEmpty = Object.keys(data.preference || {}).length === 0;
    const preference = isEmpty ? DEFAULT_PREFERENCE : data.preference;

    // if there is avatar or userId (from client DB), update it into user
    const user =
      data.avatar || data.userId
        ? merge(state.user, {
            avatar: data.avatar,
            email: data.email,
            firstName: data.firstName,
            fullName: data.fullName,
            id: data.userId,
            interests: data.interests,
            latestName: data.lastName,
            username: data.username,
          } as LobeUser)
        : state.user;

    return {
      defaultSettings,
      isFreePlan: data.isFreePlan,
      isIdentityResolved: true,
      isOnboard: data.isOnboard,
      isShowPWAGuide: data.canEnablePWAGuide,
      isSignedIn: Boolean(data.userId) || state.isSignedIn,
      isUserCanEnableTrace: data.canEnableTrace,
      isUserHasConversation: data.hasConversation,
      isUserStateInit: true,
      isUserStateInitError: undefined,
      onboarding: data.onboarding,
      preference,
      referralStatus: data.referralStatus,
      settings: data.settings || {},
      subscriptionPlan: data.subscriptionPlan,
      user,
      userState: data,
    };
  };

  #ensureUserState = (): UserStateReplica => {
    if (!this.#userState) {
      const view: ReplicaLens<UserStore, UserInitializationState> = {
        clear: () => EMPTY_BOOTSTRAP,
        get: (state) => state.userState,
        keys: (state) => (state.userState ? [USER_STATE_KEY] : []),
        set: (state, _key, data) => (data ? this.#project(state, data) : EMPTY_BOOTSTRAP),
      };

      this.#userState = createReplicaSlice(createUserStateResource(), {
        actionPrefix: n('userState'),
        fetcher: () => userService.getUserState(),
        get: this.#get,
        // An unchanged payload must not re-render every `user` / `settings`
        // consumer on a refresh.
        merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
        set: this.#set,
        stateKey: 'userStateReplica',
        view,
      });
    }

    return this.#userState;
  };

  /**
   * Re-run the bootstrap fetch for the active identity. The replica owns the
   * request, so `revalidate` only matches the current scope's entry — a switch
   * that is still in flight is never answered with another identity's payload.
   */
  refreshUserState = async (): Promise<void> => {
    await this.#ensureUserState().revalidate();
  };

  updateAvatar = async (avatar: string): Promise<void> => {
    await userService.updateAvatar(avatar);
    await this.#get().refreshUserState();
  };

  updateFullName = async (fullName: string): Promise<void> => {
    await userService.updateFullName(fullName);
    await this.#get().refreshUserState();
  };

  /**
   * Optimistic: the interests row repaints before the write resolves. There is
   * no list to reconcile — only this one user field — so it patches `user`
   * directly and lets the bootstrap revalidation confirm it.
   */
  updateInterests = async (interests: string[]): Promise<void> => {
    const previousUser = this.#get().user;
    if (previousUser) {
      this.#set({ user: { ...previousUser, interests } }, false, n('updateInterests/optimistic'));
    }
    await userService.updateInterests(interests);
    void mutate(isTaskTemplateRecommendationKey).catch((error) => {
      console.error('[taskTemplate:recommendationCache:invalidate]', error);
    });
    await this.#get().refreshUserState();
  };

  updateKeyVaultConfig = async (provider: string, config: any): Promise<void> => {
    await this.#get().setSettings({ keyVaults: { [provider]: config } });
  };

  updateUsername = async (username: string): Promise<void> => {
    await userService.updateUsername(username);
    await this.#get().refreshUserState();
  };

  useCheckTrace = (shouldFetch: boolean): SWRResponse<any> => {
    return useSWR<boolean>(
      shouldFetch ? userKeys.checkTrace() : null,
      () => {
        const telemetry = userGeneralSettingsSelectors.telemetry(this.#get());

        // if user have set the telemetry, return false
        if (typeof telemetry === 'boolean') return Promise.resolve(false);

        return Promise.resolve(this.#get().isUserCanEnableTrace);
      },
      {
        revalidateOnFocus: false,
      },
    );
  };

  /**
   * Fetch orchestration for the bootstrap entry: returns the replica's sync
   * flags, never the data. Read `isUserStateInit` / `user` / `settings` from
   * the store — the projection writes them.
   */
  useInitUserState = (
    isLogin: boolean | undefined,
    serverConfig: GlobalServerConfig,
    options?: {
      onError?: (error: any) => void;
      onSuccess?: (data: UserInitializationState) => void;
    },
  ): ReplicaSyncResult => {
    this.#serverConfig = serverConfig;

    return this.#ensureUserState().useSync(USER_STATE_PARAMS, {
      enabled: !!isLogin || isDesktop,
      onError: (error) => {
        // Record the init failure so gated tabs (Advanced / ServiceModel) can
        // render error + Retry instead of a permanent skeleton.
        this.#set({ isUserStateInitError: error }, false, n('initUserState/error'));
        options?.onError?.(error);
      },
      onSuccess: (data) => {
        options?.onSuccess?.(data);

        if (data) {
          writeUserDisplaySnapshot(data.userId, {
            avatar: data.avatar ?? '',
            preference: this.#get().preference,
          });

          const autoDetectedGeneralConfig: Partial<UserGeneralConfig> = {};
          const currentGeneralSettings = data.settings?.general;

          // Auto-detect and sync browser timezone on first load
          if (!currentGeneralSettings?.timezone && typeof Intl !== 'undefined') {
            const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (detectedTimezone) autoDetectedGeneralConfig.timezone = detectedTimezone;
          }

          // Keep reply language aligned with the browser locale until the user makes a choice.
          // Only auto-fill once onboarding has finished — otherwise it pre-empts the
          // language step in the onboarding flow, skipping past the user's explicit choice.
          const hasFinishedOnboarding = !!data.onboarding?.finishedAt;
          if (
            hasFinishedOnboarding &&
            !currentGeneralSettings?.responseLanguage &&
            typeof navigator !== 'undefined'
          ) {
            autoDetectedGeneralConfig.responseLanguage =
              userGeneralSettingsSelectors.currentResponseLanguage(this.#get());
          }

          if (Object.keys(autoDetectedGeneralConfig).length > 0) {
            this.#get()
              .updateGeneralConfig(autoDetectedGeneralConfig)
              .catch(() => {});
          }

          analyticsClient.identify(data.userId || '', {
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            username: data.username,
          });
        }
      },
    });
  };
}

export type CommonAction = Pick<CommonActionImpl, keyof CommonActionImpl>;
