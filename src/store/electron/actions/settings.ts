import { type NetworkProxySettings, type ShortcutUpdateResult } from '@lobechat/electron-client-ipc';
import isEqual from 'fast-deep-equal';
import useSWR, { type SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { mutate } from '@/libs/swr';
import { desktopSettingsService } from '@/services/electron/settings';

import type { ElectronStore } from '../store';

/**
 * Settings actions
 */
export interface ElectronSettingsAction {
  refreshDesktopHotkeys: () => Promise<void>;
  refreshProxySettings: () => Promise<void>;
  setProxySettings: (params: Partial<NetworkProxySettings>) => Promise<void>;
  updateDesktopHotkey: (id: string, accelerator: string) => Promise<ShortcutUpdateResult>;
  useFetchDesktopHotkeys: () => SWRResponse;
  useGetProxySettings: () => SWRResponse;
}

const ELECTRON_PROXY_SETTINGS_KEY = 'electron:getProxySettings';
const ELECTRON_DESKTOP_HOTKEYS_KEY = 'electron:getDesktopHotkeys';

export const settingsSlice: StateCreator<
  ElectronStore,
  [['zustand/devtools', never]],
  [],
  ElectronSettingsAction
> = (set, get) => ({
  refreshDesktopHotkeys: async () => {
    await mutate(ELECTRON_DESKTOP_HOTKEYS_KEY);
  },

  refreshProxySettings: async () => {
    await mutate(ELECTRON_PROXY_SETTINGS_KEY);
  },

  setProxySettings: async (values) => {
    try {
      // Update settings
      await desktopSettingsService.setSettings(values);

      // Refresh state
      await get().refreshProxySettings();
    } catch (error) {
      console.error('Proxy settings update failed:', error);
    }
  },

  updateDesktopHotkey: async (id, accelerator) => {
    try {
      // Update hotkey configuration
      const result = await desktopSettingsService.updateDesktopHotkey(id, accelerator);

      // If update successful, refresh state
      if (result.success) {
        await get().refreshDesktopHotkeys();
      }

      return result;
    } catch (error) {
      console.error('Desktop hotkey update failed:', error);
      return {
        errorType: 'UNKNOWN' as const,
        success: false,
      };
    }
  },

  useFetchDesktopHotkeys: () =>
    useSWR<Record<string, string>>(
      ELECTRON_DESKTOP_HOTKEYS_KEY,
      async () => desktopSettingsService.getDesktopHotkeys(),
      {
        onSuccess: (data) => {
          if (!isEqual(data, get().desktopHotkeys)) {
            set({ desktopHotkeys: data, isDesktopHotkeysInit: true });
          }
        },
      },
    ),

  useGetProxySettings: () =>
    useSWR<NetworkProxySettings>(
      ELECTRON_PROXY_SETTINGS_KEY,
      async () => desktopSettingsService.getProxySettings(),
      {
        onSuccess: (data) => {
          if (!isEqual(data, get().proxySettings)) {
            set({ proxySettings: data });
          }
        },
      },
    ),
});
