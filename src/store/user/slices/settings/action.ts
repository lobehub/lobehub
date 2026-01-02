import isEqual from 'fast-deep-equal';
import type { PartialDeep } from 'type-fest';
import type { StateCreator } from 'zustand/vanilla';

import { MESSAGE_CANCEL_FLAT } from '@/const/message';
import { shareService } from '@/services/share';
import { userService } from '@/services/user';
import type { UserStore } from '@/store/user';
import { type LobeAgentSettings } from '@/types/session';
import {
  type SystemAgentItem,
  type UserGeneralConfig,
  type UserKeyVaults,
  type UserSettings,
  type UserSystemAgentConfigKey,
} from '@/types/user/settings';
import { difference } from '@/utils/difference';
import { merge } from '@/utils/merge';

export interface UserSettingsAction {
  addToolToAllowList: (toolKey: string) => Promise<void>;
  importAppSettings: (settings: UserSettings) => Promise<void>;
  importUrlShareSettings: (settingsParams: string | null) => Promise<void>;
  internal_createSignal: () => AbortController;
  resetSettings: () => Promise<void>;
  setSettings: (settings: PartialDeep<UserSettings>) => Promise<void>;
  updateDefaultAgent: (agent: PartialDeep<LobeAgentSettings>) => Promise<void>;
  updateGeneralConfig: (settings: Partial<UserGeneralConfig>) => Promise<void>;
  updateHumanIntervention: (config: {
    allowList?: string[];
    approvalMode?: 'auto-run' | 'allow-list' | 'manual';
  }) => Promise<void>;
  updateKeyVaults: (settings: Partial<UserKeyVaults>) => Promise<void>;

  updateSystemAgent: (
    key: UserSystemAgentConfigKey,
    value: Partial<SystemAgentItem>,
  ) => Promise<void>;
}

export const createSettingsSlice: StateCreator<
  UserStore,
  [['zustand/devtools', never]],
  [],
  UserSettingsAction
> = (set, get) => ({
  addToolToAllowList: async (toolKey) => {
    const currentAllowList = get().settings.tool?.humanIntervention?.allowList || [];

    if (currentAllowList.includes(toolKey)) return;

    await get().setSettings({
      tool: {
        humanIntervention: {
          allowList: [...currentAllowList, toolKey],
        },
      },
    });
  },

  importAppSettings: async (importAppSettings) => {
    const { setSettings } = get();

    await setSettings(importAppSettings);
  },

  /**
   * Import settings from a string in json format
   */
  importUrlShareSettings: async (settingsParams: string | null) => {
    if (settingsParams) {
      const importSettings = shareService.decodeShareSettings(settingsParams);
      if (importSettings?.message || !importSettings?.data) {
        // handle some error
        return;
      }

      await get().setSettings(importSettings.data);
    }
  },

  internal_createSignal: () => {
    const abortController = get().updateSettingsSignal;
    if (abortController && !abortController.signal.aborted)
      abortController.abort(MESSAGE_CANCEL_FLAT);

    const newSignal = new AbortController();

    set({ updateSettingsSignal: newSignal }, false, 'signalForUpdateSettings');

    return newSignal;
  },

  resetSettings: async () => {
    await userService.resetUserSettings();
    await get().refreshUserState();
  },
  setSettings: async (settings) => {
    const { settings: prevSetting, defaultSettings } = get();

    const nextSettings = merge(prevSetting, settings);

    if (isEqual(prevSetting, nextSettings)) return;

    const diffs = difference(nextSettings, defaultSettings);
    set({ settings: diffs }, false, 'optimistic_updateSettings');

    const abortController = get().internal_createSignal();
    await userService.updateUserSettings(diffs, abortController.signal);
    await get().refreshUserState();
  },
  updateDefaultAgent: async (defaultAgent) => {
    await get().setSettings({ defaultAgent });
  },
  updateGeneralConfig: async (general) => {
    await get().setSettings({ general });
  },
  updateHumanIntervention: async (config) => {
    const current = get().settings.tool?.humanIntervention || {};
    await get().setSettings({
      tool: {
        humanIntervention: { ...current, ...config },
      },
    });
  },
  updateKeyVaults: async (keyVaults) => {
    await get().setSettings({ keyVaults });
  },
  updateSystemAgent: async (key, value) => {
    await get().setSettings({
      systemAgent: { [key]: { ...value } },
    });
  },
});
