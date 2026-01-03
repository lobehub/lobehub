import { type ThemeMode } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { gt, parse, valid } from 'semver';
import { type SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';

import { LOBE_THEME_APPEARANCE } from '@/const/theme';
import { CURRENT_VERSION, isDesktop } from '@/const/version';
import { useOnlyFetchOnceSWR } from '@/libs/swr';
import { globalService } from '@/services/global';
import type { SystemStatus } from '@/store/global/initialState';
import { type LocaleMode } from '@/types/locale';
import { setCookie } from '@/utils/client/cookie';
import { switchLang } from '@/utils/client/switchLang';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import type { GlobalStore } from '../store';

const n = setNamespace('g');

export interface GlobalGeneralAction {
  openAgentInNewWindow: (agentId: string) => Promise<void>;
  openTopicInNewWindow: (agentId: string, topicId: string) => Promise<void>;
  switchLocale: (locale: LocaleMode, params?: { skipBroadcast?: boolean }) => void;
  switchThemeMode: (themeMode: ThemeMode, params?: { skipBroadcast?: boolean }) => void;
  updateSystemStatus: (status: Partial<SystemStatus>, action?: any) => void;
  useCheckLatestVersion: (enabledCheck?: boolean) => SWRResponse<string>;
  useInitSystemStatus: () => SWRResponse;
}

export const generalActionSlice: StateCreator<
  GlobalStore,
  [['zustand/devtools', never]],
  [],
  GlobalGeneralAction
> = (set, get) => ({
  openAgentInNewWindow: async (agentId: string) => {
    const url = `/agent/${agentId}${isDesktop ? '?mode=single' : ''}`;

    if (isDesktop) {
      try {
        const { ensureElectronIpc } = await import('@/utils/electron/ipc');
        const path = `/agent/${agentId}?mode=single`;

        const result = await ensureElectronIpc().windows.createMultiInstanceWindow({
          path,
          templateId: 'chatSingle',
          uniqueId: `chat_${agentId}`,
        });

        if (!result.success) {
          console.error('Failed to open agent in new window:', result.error);
        }
      } catch (error) {
        console.error('Error opening agent in new window:', error);
      }
    } else {
      // Open in popup window for browser
      const width = 1200;
      const height = 800;
      const left = (window.screen.width - width) / 2;
      const top = (window.screen.height - height) / 2;
      const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`;
      window.open(url, `agent_${agentId}`, features);
    }
  },

  openTopicInNewWindow: async (agentId: string, topicId: string) => {
    const url = `/agent/${agentId}?topic=${topicId}${isDesktop ? '&mode=single' : ''}`;

    if (isDesktop) {
      try {
        const { ensureElectronIpc } = await import('@/utils/electron/ipc');
        const path = `/agent/${agentId}?topic=${topicId}&mode=single`;

        const result = await ensureElectronIpc().windows.createMultiInstanceWindow({
          path,
          templateId: 'chatSingle',
          uniqueId: `chat_${agentId}_${topicId}`,
        });

        if (!result.success) {
          console.error('Failed to open topic in new window:', result.error);
        }
      } catch (error) {
        console.error('Error opening topic in new window:', error);
      }
    } else {
      // Open in popup window for browser
      const width = 1200;
      const height = 800;
      const left = (window.screen.width - width) / 2;
      const top = (window.screen.height - height) / 2;
      const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`;
      window.open(url, `agent_${agentId}_topic_${topicId}`, features);
    }
  },

  switchLocale: (locale, { skipBroadcast } = {}) => {
    get().updateSystemStatus({ language: locale });

    switchLang(locale);

    if (isDesktop && !skipBroadcast) {
      (async () => {
        try {
          const { ensureElectronIpc } = await import('@/utils/electron/ipc');

          await ensureElectronIpc().system.updateLocale(locale);
        } catch (error) {
          console.error('Failed to update locale in main process:', error);
        }
      })();
    }
  },
  switchThemeMode: (themeMode, { skipBroadcast } = {}) => {
    get().updateSystemStatus({ themeMode });

    setCookie(LOBE_THEME_APPEARANCE, themeMode === 'auto' ? undefined : themeMode);

    if (isDesktop && !skipBroadcast) {
      (async () => {
        try {
          const { ensureElectronIpc } = await import('@/utils/electron/ipc');

          await ensureElectronIpc().system.updateThemeModeHandler(themeMode);
        } catch (error) {
          console.error('Failed to update theme in main process:', error);
        }
      })();
    }
  },
  updateSystemStatus: (status, action) => {
    if (!get().isStatusInit) return;

    const nextStatus = merge(get().status, status);

    if (isEqual(get().status, nextStatus)) return;

    set({ status: nextStatus }, false, action || n('updateSystemStatus'));
    get().statusStorage.saveToLocalStorage(nextStatus);
  },

  useCheckLatestVersion: (enabledCheck = true) =>
    useOnlyFetchOnceSWR(
      enabledCheck ? 'checkLatestVersion' : null,
      async () => globalService.getLatestVersion(),
      {
        focusThrottleInterval: 1000 * 60 * 30,
        onSuccess: (data: string) => {
          if (!valid(CURRENT_VERSION) || !valid(data)) return;

          const currentVersion = parse(CURRENT_VERSION);
          const latestVersion = parse(data);

          if (!currentVersion || !latestVersion) return;

          const currentMajorMinor = `${currentVersion.major}.${currentVersion.minor}.0`;
          const latestMajorMinor = `${latestVersion.major}.${latestVersion.minor}.0`;

          if (gt(latestMajorMinor, currentMajorMinor)) {
            set({ hasNewVersion: true, latestVersion: data }, false, n('checkLatestVersion'));
          }
        },
      },
    ),

  useInitSystemStatus: () =>
    useOnlyFetchOnceSWR<SystemStatus>(
      'initSystemStatus',
      () => get().statusStorage.getFromLocalStorage(),
      {
        onSuccess: (status) => {
          set({ isStatusInit: true }, false, 'setStatusInit');

          // Reset transient UI states that should not persist across page reloads
          const statusWithResetTransientStates = {
            ...status,
            showCommandMenu: false,
            showHotkeyHelper: false,
          };

          get().updateSystemStatus(statusWithResetTransientStates, 'initSystemStatus');
        },
      },
    ),
});
