import {
  type NetworkProxySettings,
  type ShortcutUpdateResult,
} from '@lobechat/electron-client-ipc';
import isEqual from 'fast-deep-equal';
import useSWR, { type SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { mutate } from '@/libs/swr';
import { desktopSettingsService } from '@/services/electron/settings';

import type { ElectronStore } from '../store';

/**
 * 设置操作
 */
export interface ElectronSettingsAction {
  refreshAutoCheckUpdate: () => Promise<void>;
  refreshDesktopHotkeys: () => Promise<void>;
  refreshProxySettings: () => Promise<void>;
  setAutoCheckUpdate: (enabled: boolean) => Promise<void>;
  setProxySettings: (params: Partial<NetworkProxySettings>) => Promise<void>;
  updateDesktopHotkey: (id: string, accelerator: string) => Promise<ShortcutUpdateResult>;
  useFetchAutoCheckUpdate: () => SWRResponse<boolean>;
  useFetchDesktopHotkeys: () => SWRResponse;
  useGetProxySettings: () => SWRResponse;
}

const ELECTRON_PROXY_SETTINGS_KEY = 'electron:getProxySettings';
const ELECTRON_DESKTOP_HOTKEYS_KEY = 'electron:getDesktopHotkeys';
const ELECTRON_AUTO_CHECK_UPDATE_KEY = 'electron:getAutoCheckUpdate';

export const settingsSlice: StateCreator<
  ElectronStore,
  [['zustand/devtools', never]],
  [],
  ElectronSettingsAction
> = (set, get) => ({
  refreshAutoCheckUpdate: async () => {
    await mutate(ELECTRON_AUTO_CHECK_UPDATE_KEY);
  },

  refreshDesktopHotkeys: async () => {
    await mutate(ELECTRON_DESKTOP_HOTKEYS_KEY);
  },

  refreshProxySettings: async () => {
    await mutate(ELECTRON_PROXY_SETTINGS_KEY);
  },

  setAutoCheckUpdate: async (enabled) => {
    try {
      await desktopSettingsService.setAutoCheckUpdate(enabled);
      await get().refreshAutoCheckUpdate();
    } catch (error) {
      console.error('Auto check update setting update failed:', error);
    }
  },

  setProxySettings: async (values) => {
    try {
      // 更新设置
      await desktopSettingsService.setSettings(values);

      // 刷新状态
      await get().refreshProxySettings();
    } catch (error) {
      console.error('代理设置更新失败:', error);
    }
  },

  updateDesktopHotkey: async (id, accelerator) => {
    try {
      // 更新热键配置
      const result = await desktopSettingsService.updateDesktopHotkey(id, accelerator);

      // 如果更新成功，刷新状态
      if (result.success) {
        await get().refreshDesktopHotkeys();
      }

      return result;
    } catch (error) {
      console.error('桌面热键更新失败:', error);
      return {
        errorType: 'UNKNOWN' as const,
        success: false,
      };
    }
  },

  useFetchAutoCheckUpdate: () =>
    useSWR<boolean>(
      ELECTRON_AUTO_CHECK_UPDATE_KEY,
      async () => desktopSettingsService.getAutoCheckUpdate(),
      {
        onSuccess: (data) => {
          if (data !== get().autoCheckUpdate) {
            set({ autoCheckUpdate: data });
          }
        },
      },
    ),

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
