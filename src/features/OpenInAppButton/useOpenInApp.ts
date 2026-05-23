import { isDesktop } from '@lobechat/const';
import type { DetectedApp, OpenInAppId } from '@lobechat/electron-client-ipc';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { message } from '@/components/AntdStaticMethods';
import { electronOpenInAppService } from '@/services/electron/openInApp';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import { resolveDefaultApp } from './apps';

export interface UseOpenInAppResult {
  defaultApp: OpenInAppId;
  installedApps: DetectedApp[];
  launch: (appId: OpenInAppId) => Promise<void>;
  ready: boolean;
}

export const useOpenInApp = (workingDirectory: string): UseOpenInAppResult => {
  const { t } = useTranslation('openInApp');

  // SWR fetch detection once per session; main caches anyway.
  const { data } = useSWR(
    isDesktop ? 'open-in-app/detect' : null,
    () => electronOpenInAppService.detectApps(),
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  );

  const installedApps = useMemo(() => data?.apps.filter((app) => app.installed) ?? [], [data]);
  const installedIds = useMemo(() => new Set(installedApps.map((app) => app.id)), [installedApps]);
  const displayNameMap = useMemo(
    () => new Map(installedApps.map((app) => [app.id, app.displayName])),
    [installedApps],
  );

  const userDefault = useUserStore(preferenceSelectors.defaultOpenInApp);
  const updatePreference = useUserStore((s) => s.updatePreference);

  const defaultApp = useMemo(
    () => resolveDefaultApp(userDefault, installedIds, window.lobeEnv?.platform ?? 'darwin'),
    [userDefault, installedIds],
  );

  const launch = useCallback(
    async (appId: OpenInAppId): Promise<void> => {
      const appName = displayNameMap.get(appId) ?? appId;
      const result = await electronOpenInAppService.openInApp({
        appId,
        path: workingDirectory,
      });

      if (result.success) {
        if (appId !== userDefault) {
          await updatePreference({ defaultOpenInApp: appId });
        }
        return;
      }

      const err = result.error ?? '';
      if (err.startsWith('Path not found')) {
        message.error(t('errors.pathNotFound', { path: workingDirectory }));
      } else if (err.includes('is not installed')) {
        message.error(t('errors.appNotInstalled', { appName }));
      } else {
        message.error(t('errors.launchFailed', { appName, error: err || t('errors.unknown') }));
      }
    },
    [displayNameMap, workingDirectory, userDefault, updatePreference, t],
  );

  return { defaultApp, installedApps, launch, ready: !!data };
};
