'use client';

import { toast } from '@lobehub/ui';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useIsWorkspaceViewer } from '@/business/client/hooks/useIsWorkspaceViewer';
import { useLocalMachineDeviceIds } from '@/hooks/useLocalMachineDeviceIds';
import { useSingleton } from '@/hooks/useSingleton';
import { createWorkspaceLambdaClient } from '@/libs/trpc/client';
import { useDeviceList } from '@/store/device';
import { useElectronStore } from '@/store/electron';

import {
  autoEnrollStorageKey,
  decideAutoEnroll,
  isPermanentEnrollRefusal,
  readAutoEnrollHandled,
  writeAutoEnrollHandled,
} from './decide';

/**
 * Puts this desktop into the active workspace as the member's private device,
 * so a workspace agent or Task can run on it through the gateway instead of
 * only through the in-app `local` path.
 *
 * Runs on each workspace switch, for that workspace only. Reuses the manual
 * "share to workspace" flow (`device.shareDeviceToWorkspace`), so the server's
 * conflict checks, rollback and the desktop's persisted reconnect all apply.
 * Silent except for one toast on success; refusals are not reported.
 */
const AutoEnrollWorkspaceDevice = memo(() => {
  const { t } = useTranslation('electron');
  const workspaceId = useActiveWorkspaceId();
  const isViewer = useIsWorkspaceViewer();
  const isGatewayConnected = useElectronStore((s) => s.gatewayConnectionStatus === 'connected');
  const [personalDeviceId, workspaceDeviceId] = useLocalMachineDeviceIds();
  const { data: devices, isConfirmed, mutate: refreshDevices } = useDeviceList();
  // One attempt per workspace per app session: a failure that may pass (the
  // device dropped offline, a network error) is retried on the next launch,
  // not on every device-list refresh.
  const attempted = useSingleton(() => new Set<string>());

  const storageKey =
    personalDeviceId && workspaceId ? autoEnrollStorageKey(personalDeviceId, workspaceId) : '';

  useEffect(() => {
    if (!storageKey || attempted.has(storageKey)) return;

    const decision = decideAutoEnroll({
      confirmedDevices: isConfirmed ? devices : undefined,
      handled: readAutoEnrollHandled(storageKey),
      isGatewayConnected,
      isViewer,
      personalDeviceId,
      workspaceDeviceId,
      workspaceId,
    });

    if (decision === 'markHandled') writeAutoEnrollHandled(storageKey);
    if (decision !== 'enroll') return;

    attempted.add(storageKey);
    void (async () => {
      try {
        const result = await createWorkspaceLambdaClient(
          workspaceId!,
        ).device.shareDeviceToWorkspace.mutate({
          deviceId: personalDeviceId!,
          visibility: 'private',
        });
        writeAutoEnrollHandled(storageKey);
        // `alreadyEnrolled`: the row appeared after the list was read. Never
        // overwrite it — its visibility is a choice someone already made.
        if (result.success) toast.success(t('gateway.autoEnroll.success'));
        await refreshDevices();
      } catch (error) {
        if (isPermanentEnrollRefusal(error)) writeAutoEnrollHandled(storageKey);
        else console.warn('[AutoEnrollWorkspaceDevice] enroll failed:', error);
      }
    })();
  }, [
    attempted,
    devices,
    isConfirmed,
    isGatewayConnected,
    isViewer,
    personalDeviceId,
    refreshDevices,
    storageKey,
    t,
    workspaceDeviceId,
    workspaceId,
  ]);

  return null;
});

AutoEnrollWorkspaceDevice.displayName = 'AutoEnrollWorkspaceDevice';

export default AutoEnrollWorkspaceDevice;
