import {
  type NetworkProxySettings,
  type ShortcutUpdateResult,
} from '@lobechat/electron-client-ipc';
import isEqual from 'fast-deep-equal';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { mutate } from '@/libs/swr';
import { electronKeys } from '@/libs/swr/keys';
import { desktopSettingsService } from '@/services/electron/settings';
import { type StoreSetter } from '@/store/types';

import { type ElectronStore } from '../store';

/**
 * Settings actions
 */

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
    await mutate(electronKeys.desktopHotkeys());
  };

  refreshAppTrayVisible = async (): Promise<void> => {
    await mutate(electronKeys.appTrayVisible());
  };

  refreshProxySettings = async (): Promise<void> => {
    await mutate(electronKeys.proxySettings());
  };

  setAppTrayVisible = async (visible: boolean): Promise<void> => {
    await desktopSettingsService.setAppTrayVisible(visible);
    this.#set({ appTrayVisible: visible });
    await this.#get().refreshAppTrayVisible();
  };

  setProxySettings = async (values: Partial<NetworkProxySettings>): Promise<void> => {
    await desktopSettingsService.setSettings(values);
    await this.#get().refreshProxySettings();
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
      electronKeys.desktopHotkeys(),
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

  useGetAppTrayVisible = (enabled = true): SWRResponse => {
    return useSWR<boolean>(
      enabled ? electronKeys.appTrayVisible() : null,
      async () => desktopSettingsService.getAppTrayVisible(),
      {
        onSuccess: (data) => {
          if (data !== this.#get().appTrayVisible) {
            this.#set({ appTrayVisible: data });
          }
        },
      },
    );
  };

  useGetProxySettings = (): SWRResponse => {
    return useSWR<NetworkProxySettings>(
      electronKeys.proxySettings(),
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
