import type { DeviceAppUpdateStateResult } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import { useEffect, useState } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { deviceService } from '@/services/device';

import { refreshDeviceList } from '../const';
import {
  type AppUpdateInstall,
  deriveAppUpdateView,
  isAppUpdatePolling,
} from './deriveAppUpdateView';

const PROGRESS_POLL_MS = 1000;
/** A restart takes tens of seconds; asking faster only piles up timeouts. */
const RESTART_POLL_MS = 3000;
/** How long to wait for the device to come back after the restart. */
const RESTART_TIMEOUT_MS = 5 * 60_000;

interface UseDeviceAppUpdateParams {
  deviceId: string;
  /** Whether the device can take a remote update request right now. */
  enabled: boolean;
  /** Whether `lh connect` shares this device with the desktop app. */
  hasCliChannel: boolean;
}

/**
 * Drive a remote desktop-app update on one device: read where its update
 * stands, start a check, and restart it into the downloaded version — then
 * follow it until it reconnects on that version.
 */
export const useDeviceAppUpdate = ({
  deviceId,
  enabled,
  hasCliChannel,
}: UseDeviceAppUpdateParams) => {
  const workspaceId = useActiveWorkspaceId();
  const [install, setInstall] = useState<AppUpdateInstall | null>(null);
  const [requesting, setRequesting] = useState(false);

  const { data, mutate } = useClientDataSWR<DeviceAppUpdateStateResult>(
    // A restart in flight keeps polling even while the device drops offline.
    enabled || install ? deviceKeys.appUpdateState(workspaceId, deviceId) : null,
    () => deviceService.getAppUpdateState({ deviceId }),
    {
      refreshInterval: (latest) => {
        if (!isAppUpdatePolling(deriveAppUpdateView(latest, install, hasCliChannel))) return 0;
        return install ? RESTART_POLL_MS : PROGRESS_POLL_MS;
      },
      revalidateOnFocus: false,
    },
  );

  const view = deriveAppUpdateView(data, install, hasCliChannel);

  useEffect(() => {
    if (!install || install.timedOut) return;
    const timer = setTimeout(
      () => setInstall((current) => current && { ...current, timedOut: true }),
      RESTART_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [install]);

  // The device re-registered on connect, so the list now carries its new version.
  const updated = view.kind === 'updated';
  useEffect(() => {
    if (updated) refreshDeviceList();
  }, [updated]);

  const request = async (run: () => Promise<void>) => {
    setRequesting(true);
    try {
      await run();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRequesting(false);
    }
  };

  const check = () =>
    request(async () => {
      setInstall(null);
      const result = await deviceService.checkAppUpdate({ deviceId });
      await mutate(result, { revalidate: false });
    });

  const installUpdate = () =>
    request(async () => {
      const result = await deviceService.installAppUpdate({ deviceId });
      if (result.status === 'ok') {
        setInstall({ targetVersion: result.targetVersion, timedOut: false });
        return;
      }
      // Show why the device refused (outdated client, offline) in place.
      await mutate(result, { revalidate: false });
    });

  return {
    check,
    /** What the device itself says it runs, when it answered. */
    currentVersion: data?.status === 'ok' ? data.state.currentVersion : undefined,
    install: installUpdate,
    requesting,
    view,
  };
};
