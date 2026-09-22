import isEqual from 'fast-deep-equal';
import type { PartialDeep } from 'type-fest';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { shareService } from '@/services/share';
import { userService } from '@/services/user';
import type { StoreSetter } from '@/store/types';
import type { UserStore } from '@/store/user';
import type { LobeAgentSettings } from '@/types/session';
import type {
  SystemAgentItem,
  UserGeneralConfig,
  UserKeyVaults,
  UserServiceModelConfigKey,
  UserSettings,
  UserSystemAgentConfigKey,
} from '@/types/user/settings';
import { difference } from '@/utils/difference';
import { merge } from '@/utils/merge';

import { settingsSelectors } from './selectors/settings';

type Setter = StoreSetter<UserStore>;

type SystemAgentDiff = Partial<Record<string, unknown>>;

export const createSettingsSlice = (set: Setter, get: () => UserStore, _api?: unknown) =>
  new UserSettingsActionImpl(set, get, _api);

export class UserSettingsActionImpl {
  readonly #get: () => UserStore;
  readonly #set: Setter;

  /**
   * Top-level settings columns touched by a `setSettings` call whose server
   * write has not succeeded yet. A later call aborts the in-flight one via
   * `internal_createSignal`, so these columns must ride along on the next
   * payload or the aborted change would silently never persist.
   */
  readonly #pendingSettingKeys = new Set<string>();

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  addToolToAllowList = async (toolKey: string): Promise<void> => {
    const currentAllowList = this.#get().settings.tool?.humanIntervention?.allowList || [];

    if (currentAllowList.includes(toolKey)) return;

    // Optimistic local update, then a server-side merge write. The server
    // unions against the DB row, so this tab's possibly-stale snapshot cannot
    // clobber sibling `tool` keys changed from other tabs (see setSettings).
    this.#set(
      {
        settings: merge(this.#get().settings, {
          tool: { humanIntervention: { allowList: [...currentAllowList, toolKey] } },
        }),
      },
      false,
      'optimistic_addToolToAllowList',
    );

    await userService.updateToolIntervention({ appendAllowList: [toolKey] });
    await this.#get().refreshUserState();
  };

  importAppSettings = async (importAppSettings: UserSettings): Promise<void> => {
    const { setSettings } = this.#get();

    await setSettings(importAppSettings);
  };

  importUrlShareSettings = async (settingsParams: string | null): Promise<void> => {
    if (settingsParams) {
      const importSettings = shareService.decodeShareSettings(settingsParams);
      if (importSettings?.message || !importSettings?.data) {
        // handle some error
        return;
      }

      await this.#get().setSettings(importSettings.data);
    }
  };

  internal_createSignal = (): AbortController => {
    const abortController = this.#get().updateSettingsSignal;
    if (abortController && !abortController.signal.aborted)
      abortController.abort(MESSAGE_CANCEL_FLAT);

    const newSignal = new AbortController();

    this.#set({ updateSettingsSignal: newSignal }, false, 'signalForUpdateSettings');

    return newSignal;
  };

  resetSettings = async (): Promise<void> => {
    await userService.resetUserSettings();
    await this.#get().refreshUserState();
  };

  setSettings = async (settings: PartialDeep<UserSettings>): Promise<void> => {
    const { settings: prevSetting, defaultSettings } = this.#get();

    const nextSettings = merge(prevSetting, settings);

    if (isEqual(prevSetting, nextSettings)) return;

    const diffs = difference(nextSettings, defaultSettings);
    const isEmptyObjectDiff = (value: unknown): boolean =>
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0;

    // When user resets a field to default value, we need to explicitly include it in diffs
    // to override the previously saved non-default value in the backend
    const changedFields = difference(nextSettings, prevSetting);
    for (const key of Object.keys(changedFields)) {
      // Only handle fields that were previously set by user (exist in prevSetting)
      const keyDiff = (diffs as any)[key];
      if (key in prevSetting && (!(key in diffs) || isEmptyObjectDiff(keyDiff))) {
        (diffs as any)[key] = (changedFields as any)[key];
      }
    }

    const nextDefaultAgentConfig = nextSettings.defaultAgent?.config;
    const changedDefaultAgentConfig = changedFields.defaultAgent?.config;
    const hasDefaultAgentModelProviderChange =
      !!changedDefaultAgentConfig &&
      ('model' in changedDefaultAgentConfig || 'provider' in changedDefaultAgentConfig);
    const defaultAgentModelProviderDiffersFromDefault =
      nextDefaultAgentConfig?.model !== defaultSettings.defaultAgent?.config?.model ||
      nextDefaultAgentConfig?.provider !== defaultSettings.defaultAgent?.config?.provider;

    if (
      hasDefaultAgentModelProviderChange &&
      (defaultAgentModelProviderDiffersFromDefault || 'defaultAgent' in prevSetting) &&
      nextDefaultAgentConfig?.model &&
      nextDefaultAgentConfig.provider
    ) {
      const defaultAgentDiff = diffs.defaultAgent || {};
      const configDiff = defaultAgentDiff.config || {};

      diffs.defaultAgent = {
        ...defaultAgentDiff,
        config: {
          ...configDiff,
          model: nextDefaultAgentConfig.model,
          provider: nextDefaultAgentConfig.provider,
        },
      };
    }

    const changedSystemAgent = changedFields.systemAgent as SystemAgentDiff | undefined;
    const nextSystemAgent = nextSettings.systemAgent;
    const previousSystemAgent = prevSetting.systemAgent;
    const defaultSystemAgent = defaultSettings.systemAgent;

    if (changedSystemAgent && nextSystemAgent) {
      const mutableDiffs = diffs as PartialDeep<UserSettings> & { systemAgent?: SystemAgentDiff };

      for (const key of Object.keys(changedSystemAgent)) {
        const changedSystemAgentItem = changedSystemAgent[key];
        if (
          !changedSystemAgentItem ||
          typeof changedSystemAgentItem !== 'object' ||
          Array.isArray(changedSystemAgentItem) ||
          (!('model' in changedSystemAgentItem) && !('provider' in changedSystemAgentItem))
        )
          continue;

        const taskKey = key as UserSystemAgentConfigKey;
        const nextSystemAgentItem = nextSystemAgent[taskKey];
        const defaultSystemAgentItem = defaultSystemAgent?.[taskKey];
        const systemAgentModelProviderDiffersFromDefault =
          nextSystemAgentItem?.model !== defaultSystemAgentItem?.model ||
          nextSystemAgentItem?.provider !== defaultSystemAgentItem?.provider;

        if (
          (!systemAgentModelProviderDiffersFromDefault &&
            (!previousSystemAgent || !Object.hasOwn(previousSystemAgent, taskKey))) ||
          !nextSystemAgentItem?.model ||
          !nextSystemAgentItem.provider
        )
          continue;

        const systemAgentDiff = mutableDiffs.systemAgent || {};
        const systemAgentItemDiff = systemAgentDiff[taskKey] || {};

        mutableDiffs.systemAgent = {
          ...systemAgentDiff,
          [taskKey]: {
            ...systemAgentItemDiff,
            model: nextSystemAgentItem.model,
            provider: nextSystemAgentItem.provider,
          },
        };
      }
    }

    this.#set({ settings: diffs }, false, 'optimistic_updateSettings');

    // Only send the top-level columns this call actually touched. The server
    // replaces whole jsonb columns, and this tab's settings may be hours stale
    // (user state is fetched once per tab) — sending every diffed column would
    // rewrite untouched ones with stale values. E.g. the hourly market token
    // refresh calling setSettings({ market }) used to carry a stale `tool`
    // column and revert approvalMode changed from another tab.
    //
    // `internal_createSignal` aborts any in-flight settings write, so a column
    // touched by an aborted call would be lost if the next call didn't resend
    // it. `#pendingSettingKeys` keeps every touched-but-not-yet-persisted
    // column in the payload until a write for it succeeds; the optimistic
    // local state already carries the aborted call's values.
    for (const key of Object.keys(changedFields)) this.#pendingSettingKeys.add(key);
    const payloadKeys = new Set(this.#pendingSettingKeys);
    const payload = Object.fromEntries(
      Object.entries(diffs).filter(([key]) => payloadKeys.has(key)),
    ) as PartialDeep<UserSettings>;

    const abortController = this.#get().internal_createSignal();
    await userService.updateUserSettings(payload, abortController.signal);
    for (const key of payloadKeys) this.#pendingSettingKeys.delete(key);
    await this.#get().refreshUserState();
  };

  updateDefaultAgent = async (defaultAgent: PartialDeep<LobeAgentSettings>): Promise<void> => {
    const config = defaultAgent.config;
    const shouldNormalizeModelProvider =
      config && (config.model !== undefined || config.provider !== undefined);

    if (!shouldNormalizeModelProvider) {
      await this.#get().setSettings({ defaultAgent });
      return;
    }

    const currentConfig = settingsSelectors.defaultAgentConfig(this.#get());

    await this.#get().setSettings({
      defaultAgent: {
        ...defaultAgent,
        config: {
          ...config,
          model: config.model ?? currentConfig.model,
          provider: config.provider ?? currentConfig.provider,
        },
      },
    });
  };

  updateGeneralConfig = async (general: Partial<UserGeneralConfig>): Promise<void> => {
    await this.#get().setSettings({ general });
  };

  updateHumanIntervention = async (config: {
    approvalMode?: 'auto-run' | 'allow-list' | 'manual';
  }): Promise<void> => {
    // Optimistic local update, then a server-side merge write. Routing this
    // through setSettings would replace the whole `tool` column with this
    // tab's snapshot — with several tabs open that reverts changes made
    // elsewhere (the reported "approve mode flips back to manual" bug).
    this.#set(
      {
        settings: merge(this.#get().settings, { tool: { humanIntervention: config } }),
      },
      false,
      'optimistic_updateHumanIntervention',
    );

    await userService.updateToolIntervention(config);
    await this.#get().refreshUserState();
  };

  updateKeyVaults = async (keyVaults: Partial<UserKeyVaults>): Promise<void> => {
    await this.#get().setSettings({ keyVaults });
  };

  updateSystemAgent = async (
    key: UserServiceModelConfigKey,
    value: Partial<SystemAgentItem>,
  ): Promise<void> => {
    await this.#get().setSettings({
      systemAgent: { [key]: { ...value } },
    });
  };
}

export type UserSettingsAction = Pick<UserSettingsActionImpl, keyof UserSettingsActionImpl>;
