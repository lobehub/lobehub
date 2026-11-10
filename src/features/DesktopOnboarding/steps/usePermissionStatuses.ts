import type { GuidedPermission } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useCallback, useEffect, useState } from 'react';

import { ensureElectronIpc } from '@/utils/electron/ipc';

export type PermissionId = 'accessibility' | 'fullDisk' | 'microphone' | 'notification' | 'screen';
export type PermissionStatus = 'granted' | 'idle' | 'incomplete' | 'pending';

export const PERMISSION_IDS: PermissionId[] = [
  'notification',
  'fullDisk',
  'microphone',
  'screen',
  'accessibility',
];

// These open the drag guide inside System Settings; the rest raise a system prompt.
export const GUIDED_PERMISSIONS = new Set<PermissionId>(['accessibility', 'fullDisk', 'screen']);

type PermissionStatuses = Record<PermissionId, PermissionStatus>;

const INITIAL_STATUSES = Object.fromEntries(
  PERMISSION_IDS.map((id) => [id, 'idle']),
) as PermissionStatuses;

const isPermissionId = (value: GuidedPermission): value is GuidedPermission & PermissionId =>
  (PERMISSION_IDS as string[]).includes(value);

const readGranted = async (): Promise<Record<PermissionId, boolean> | undefined> => {
  const ipc = ensureElectronIpc();
  if (!ipc) return undefined;

  const { platform } = await ipc.system.getAppState();
  if (platform !== 'darwin') {
    return Object.fromEntries(PERMISSION_IDS.map((id) => [id, true])) as Record<
      PermissionId,
      boolean
    >;
  }

  const [notification, microphone, screen, accessibility, fullDisk] = await Promise.all([
    ipc.notification.getNotificationPermissionStatus(),
    ipc.system.getMediaAccessStatus('microphone'),
    ipc.system.getMediaAccessStatus('screen'),
    ipc.system.getAccessibilityStatus(),
    ipc.system.getFullDiskAccessStatus(),
  ]);

  return {
    accessibility: !!accessibility,
    fullDisk: !!fullDisk,
    microphone: microphone === 'granted',
    notification: notification === 'authorized',
    screen: screen === 'granted',
  };
};

const requestPermission = async (id: PermissionId) => {
  const ipc = ensureElectronIpc();
  if (!ipc) return;

  switch (id) {
    case 'notification': {
      await ipc.notification.requestNotificationPermission();
      return;
    }
    case 'microphone': {
      await ipc.system.requestMicrophoneAccess();
      return;
    }
    case 'fullDisk': {
      await ipc.system.promptFullDiskAccessIfNotGranted();
      return;
    }
    case 'screen': {
      await ipc.system.requestScreenAccess();
      return;
    }
    case 'accessibility': {
      await ipc.system.requestAccessibilityAccess();
      return;
    }
  }
};

export const usePermissionStatuses = () => {
  const [statuses, setStatuses] = useState<PermissionStatuses>(INITIAL_STATUSES);

  const setStatus = useCallback((id: PermissionId, status: PermissionStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }));
  }, []);

  const refresh = useCallback(async () => {
    const granted = await readGranted();
    if (!granted) return;
    setStatuses((prev) => {
      const next = { ...prev };
      for (const id of PERMISSION_IDS) {
        if (granted[id]) next[id] = 'granted';
        else if (prev[id] === 'granted') next[id] = 'idle';
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useWatchBroadcast('windowFocused', () => {
    void refresh();
  });

  useWatchBroadcast('permissionGuideChanged', ({ permission, status }) => {
    if (!isPermissionId(permission)) return;
    if (status === 'active') setStatus(permission, 'pending');
    else if (status === 'dismissed') setStatus(permission, 'incomplete');
    else void refresh();
  });

  const request = useCallback(
    async (id: PermissionId) => {
      // Guided rows turn pending when the guide reports it opened, so a fallback
      // to the old Settings flow (no guide) leaves the row actionable.
      if (!GUIDED_PERMISSIONS.has(id)) setStatus(id, 'pending');
      await requestPermission(id);
      if (GUIDED_PERMISSIONS.has(id)) {
        await refresh();
        return;
      }
      const granted = await readGranted();
      setStatus(id, granted?.[id] ? 'granted' : 'incomplete');
    },
    [refresh, setStatus],
  );

  return { request, statuses };
};
