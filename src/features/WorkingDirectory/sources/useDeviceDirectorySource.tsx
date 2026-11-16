import { Text } from '@lobehub/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { deviceService } from '@/services/device';
import { useFetchDeviceDirectory } from '@/store/device/directoryHooks';

import type { DirectoryListing, DirectorySource } from '../directorySource';
import { useManagedDeviceWake } from './useManagedDeviceWake';

/**
 * A connected device's folders, through the device gateway's directory RPCs.
 * Any readable folder may be picked, and a path may be typed in by hand.
 *
 * A sleeping managed cloud device is woken first, and the listing waits for it:
 * without that it answers "unavailable" until the user wakes it elsewhere.
 */
export const useDeviceDirectorySource = (deviceId: string): DirectorySource => {
  const { retry: retryWake, status: wakeStatus } = useManagedDeviceWake(deviceId);

  return useMemo(
    () => ({
      createFolder: (parentPath, name) =>
        deviceService.createDirectory({ deviceId, name, parentPath }),
      editablePath: true,
      useListing: (path?: string): DirectoryListing => {
        const { t } = useTranslation('device');
        const ready = wakeStatus === 'ready';
        const listing = useFetchDeviceDirectory(deviceId, path, ready);

        if (!ready) {
          const wakeEnded = wakeStatus === 'failed' || wakeStatus === 'starting';
          return {
            ...listing,
            entries: [],
            error: wakeEnded ? new Error(`Managed device wake ${wakeStatus}`) : undefined,
            errorLabel: wakeEnded
              ? t(
                  wakeStatus === 'failed'
                    ? 'workingDirectory.deviceWakeFailed'
                    : 'workingDirectory.deviceWakeSlow',
                )
              : undefined,
            isLoading: !wakeEnded,
            loadingLabel: wakeStatus === 'waking' ? t('workingDirectory.deviceWaking') : undefined,
            retry: retryWake,
          };
        }

        return {
          ...listing,
          entries: listing.entries.map((entry) => ({
            description: entry.readable ? undefined : (
              <Text type={'secondary'}>{t('workingDirectory.folderUnreadable')}</Text>
            ),
            disabled: !entry.readable,
            name: entry.name,
            path: entry.path,
          })),
        };
      },
    }),
    [deviceId, retryWake, wakeStatus],
  );
};
