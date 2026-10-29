import { Text } from '@lobehub/ui';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { deviceService } from '@/services/device';
import { useFetchDeviceDirectory } from '@/store/device/directoryHooks';

import type { DirectoryListing, DirectorySource } from '../directorySource';

/**
 * A connected device's folders, through the device gateway's directory RPCs.
 * Any readable folder may be picked, and a path may be typed in by hand.
 */
export const useDeviceDirectorySource = (deviceId: string): DirectorySource =>
  useMemo(
    () => ({
      createFolder: (parentPath, name) =>
        deviceService.createDirectory({ deviceId, name, parentPath }),
      editablePath: true,
      useListing: (path?: string): DirectoryListing => {
        const { t } = useTranslation('device');
        const listing = useFetchDeviceDirectory(deviceId, path);

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
    [deviceId],
  );
