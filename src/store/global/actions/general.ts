import isEqual from 'fast-deep-equal';
import { gt, parse, valid } from 'semver';
import { type SWRResponse } from 'swr';

import { CURRENT_VERSION, isDesktop } from '@/const/version';
import { useOnlyFetchOnceSWR } from '@/libs/swr';
import { globalService } from '@/services/global';
import { getElectronStoreState } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { type SystemStatus } from '@/store/global/initialState';
import { type StoreSetter } from '@/store/types';
import { type LocaleMode } from '@/types/locale';
import { switchLang } from '@/utils/client/switchLang';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { type GlobalStore } from '../store';

const n = setNamespace('g');

type Setter = StoreSetter<GlobalStore>;
export const generalActionSlice = (set: Setter, get: () => GlobalStore, _api?: unknown) =>
  new GlobalGeneralActionImpl(set, get, _api);

export class GlobalGeneralActionImpl {
  readonly #get: () => GlobalStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => GlobalStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  openAgentInNewWindow = async (agentId: string): Promise<void> => {
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
  };

  openTopicInNewWindow = async (agentId: string, topicId: string): Promise<void> => {
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
  };

  switchLocale = (
    locale: LocaleMode,
    { skipBroadcast }: { skipBroadcast?: boolean } = {},
  ): void => {
    this.#get().updateSystemStatus({ language: locale });

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
  };

  updateResourceManagerColumnWidth = (column: 'name' | 'date' | 'size', width: number): void => {
    const currentWidths = this.#get().status.resourceManagerColumnWidths || {
      date: 160,
      name: 574,
      size: 140,
    };

    this.#get().updateSystemStatus({
      resourceManagerColumnWidths: {
        ...currentWidths,
        [column]: width,
      },
    });
  };

  updateSystemStatus = (status: Partial<SystemStatus>, action?: any): void => {
    if (!this.#get().isStatusInit) return;

    const nextStatus = merge(this.#get().status, status);

    if (isEqual(this.#get().status, nextStatus)) return;

    this.#set({ status: nextStatus }, false, action || n('updateSystemStatus'));
    this.#get().statusStorage.saveToLocalStorage(nextStatus);
  };

  useCheckLatestVersion = (enabledCheck: boolean = true): SWRResponse<string> => {
    return useOnlyFetchOnceSWR(
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
            this.#set({ hasNewVersion: true, latestVersion: data }, false, n('checkLatestVersion'));
          }
        },
      },
    );
  };

  useCheckServerVersion = (): SWRResponse<string | null> => {
    return useOnlyFetchOnceSWR(
      isDesktop &&
        // only check server version for self-hosted remote server
        electronSyncSelectors.storageMode(getElectronStoreState()) !== 'cloud'
        ? 'checkServerVersion'
        : null,
      async () => globalService.getServerVersion(),
      {
        onSuccess: (data: string | null) => {
          if (data === null) {
            this.#set({ isServerVersionOutdated: true }, false);
            return;
          }

          this.#set({ serverVersion: data }, false);

          if (!valid(CURRENT_VERSION) || !valid(data)) return;

          const clientVersion = parse(CURRENT_VERSION);
          const serverVersion = parse(data);

          if (!clientVersion || !serverVersion) return;

          const DIFF_THRESHOLD = 5;
          //         Version difference calculation rules
          // ┌─────────────────┬────────┬───────────┐
          // │ Client → Server │  Diff  │  Result   │
          // ├─────────────────┼────────┼───────────┤
          // │ 1.0.5 → 1.0.0   │ 5      │ ⚠️ Too old│
          // ├─────────────────┼────────┼───────────┤
          // │ 1.1.0 → 1.0.5   │ 5      │ ⚠️ Too old│
          // ├─────────────────┼────────┼───────────┤
          // │ 2.0.0 → 1.9.9   │ 91     │ ⚠️ Too old│
          // ├─────────────────┼────────┼───────────┤
          // │ 1.0.4 → 1.0.0   │ 4      │ ✅ Normal │
          // └─────────────────┴────────┴───────────┘
          const versionDiff =
            (clientVersion.major - serverVersion.major) * 100 +
            (clientVersion.minor - serverVersion.minor) * 10 +
            (clientVersion.patch - serverVersion.patch);

          if (versionDiff >= DIFF_THRESHOLD) {
            this.#set({ isServerVersionOutdated: true }, false);
          }
        },
      },
    );
  };

  useInitSystemStatus = (): SWRResponse => {
    return useOnlyFetchOnceSWR<SystemStatus>(
      'initSystemStatus',
      () => this.#get().statusStorage.getFromLocalStorage(),
      {
        onSuccess: (status) => {
          this.#set({ isStatusInit: true }, false, 'setStatusInit');

          // Reset transient UI states that should not persist across page reloads
          const statusWithResetTransientStates = {
            ...status,
            showCommandMenu: false,
            showHotkeyHelper: false,
          };

          this.#get().updateSystemStatus(statusWithResetTransientStates, 'initSystemStatus');
        },
      },
    );
  };
}

export type GlobalGeneralAction = Pick<GlobalGeneralActionImpl, keyof GlobalGeneralActionImpl>;
