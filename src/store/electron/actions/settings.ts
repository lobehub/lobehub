import {
  type NetworkProxySettings,
  type ShortcutUpdateResult,
} from '@lobechat/electron-client-ipc';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { mutate } from '@/libs/swr';
import { desktopSettingsService } from '@/services/electron/settings';
import { type StoreSetter } from '@/store/types';

import { type ElectronStore } from '../store';

/**
 * Settings actions
 */

const ELECTRON_PROXY_SETTINGS_KEY = 'electron:getProxySettings';
const ELECTRON_DESKTOP_HOTKEYS_KEY = 'electron:getDesktopHotkeys';

type Setter = StoreSetter<ElectronStore>;
export const settingsSlice = (set: Setter, get: () => ElectronStore, _api?: unknown) =>
  new ElectronSettingsActionImpl(set, get, _api);

export class ElectronSettingsActionImpl {
  readonly #get: () => ElectronStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ElectronStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  refreshDesktopHotkeys = async (): Promise<void> => {
    await mutate(ELECTRON_DESKTOP_HOTKEYS_KEY);
  };

  refreshProxySettings = async (): Promise<void> => {
    await mutate(ELECTRON_PROXY_SETTINGS_KEY);
  };

  setProxySettings = async (values: Partial<NetworkProxySettings>): Promise<void> => {
    try {
      // Update settings
      await desktopSettingsService.setSettings(values);

      // Refresh state
      await this.#get().refreshProxySettings();
    } catch (error) {
      console.error('Proxy settings update failed:', error);
    }
  };

  updateDesktopHotkey = async (id: string, accelerator: string): Promise<ShortcutUpdateResult> => {
    try {
      // Update hotkey configuration
      const result = await desktopSettingsService.updateDesktopHotkey(id, accelerator);

      // If update successful, refresh state
      if (result.success) {
        await this.#get().refreshDesktopHotkeys();
      }

      return result;
    } catch (error) {
      console.error('Desktop hotkey update failed:', error);
      return {
        errorType: 'UNKNOWN' as const,
        success: false,
      };
    }
  };

  useFetchDesktopHotkeys = (): SWRResponse => {
    return useSWR<Record<string, string>>(
      ELECTRON_DESKTOP_HOTKEYS_KEY,
      async () => desktopSettingsService.getDesktopHotkeys(),
      {
        onSuccess: (data) => {
          if (!isEqual(data, this.#get().desktopHotkeys)) {
            this.#set({ desktopHotkeys: data, isDesktopHotkeysInit: true });
          }
        },
      },
    );
  };

  useGetProxySettings = (): SWRResponse => {
    return useSWR<NetworkProxySettings>(
      ELECTRON_PROXY_SETTINGS_KEY,
      async () => desktopSettingsService.getProxySettings(),
      {
        onSuccess: (data) => {
          if (!isEqual(data, this.#get().proxySettings)) {
            this.#set({ proxySettings: data });
          }
        },
      },
    );
  };
}

export type ElectronSettingsAction = Pick<
  ElectronSettingsActionImpl,
  keyof ElectronSettingsActionImpl
>;
