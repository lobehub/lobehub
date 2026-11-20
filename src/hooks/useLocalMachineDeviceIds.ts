import { isDesktop } from '@lobechat/const';
import { useMemo } from 'react';
import useSWR from 'swr';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { electronKeys } from '@/libs/swr/keys';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useElectronStore } from '@/store/electron';

/**
 * The device identities this desktop is registered under: its personal device
 * first, then its device in the active workspace (the one `lh connect
 * --workspace` or a desktop share enrolls). The ids are separate on purpose —
 * the server cannot link them — but only this machine can derive both, so it
 * is the one place topics run through either can be shown as the same machine.
 * Empty off-desktop.
 */
export const useLocalMachineDeviceIds = (): string[] => {
  useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
  const personalDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const workspaceId = useActiveWorkspaceId();
  const { data: workspaceDeviceId } = useSWR(
    isDesktop && workspaceId ? electronKeys.workspaceDeviceId(workspaceId) : null,
    () => gatewayConnectionService.getWorkspaceDeviceId(workspaceId!),
    { revalidateOnFocus: false },
  );

  return useMemo(
    () =>
      personalDeviceId ? [personalDeviceId, ...(workspaceDeviceId ? [workspaceDeviceId] : [])] : [],
    [personalDeviceId, workspaceDeviceId],
  );
};
