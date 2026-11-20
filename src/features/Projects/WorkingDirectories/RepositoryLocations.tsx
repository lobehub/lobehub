import type { DeviceListItem } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

/** Where a repository sits inside a project folder: the folder itself, or its subfolder. */
export const repositoryLocalPath = (
  directory: Pick<ProjectDirectory, 'path' | 'platform'>,
  folder: string | undefined,
) => {
  if (!folder) return directory.path;
  const separator = directory.platform === 'win32' ? '\\' : '/';
  return `${directory.path.replace(/[\\/]+$/, '')}${separator}${folder}`;
};

interface RepositoryLocationsProps {
  devices: DeviceListItem[];
  /** The project's folders, in device priority. */
  directories: ProjectDirectory[];
  /** The repository's folder inside each project folder; none when it sits at the top. */
  folder?: string;
  localOnly?: boolean;
}

/**
 * Where one repository is checked out on the project's devices, in device
 * priority. A project folder holds every repository of its environment — side
 * by side when there are several — so each repository's place is that folder
 * or its subfolder. The order and the folders themselves are managed once,
 * under the repositories; this only says where each one lands.
 */
export const RepositoryLocations = ({
  devices,
  directories,
  folder,
  localOnly,
}: RepositoryLocationsProps) => {
  const { t } = useTranslation('project');

  if (!directories.length)
    return localOnly ? (
      <Text fontSize={12} type="warning">
        {t('settings.repositoryLocalOnlyWithoutFolder')}
      </Text>
    ) : null;

  return (
    <Flexbox gap={4}>
      {directories.map((directory, index) => {
        const device = devices.find((item) => item.deviceId === directory.deviceId);
        return (
          <Flexbox horizontal align="center" gap={6} key={directory.id} style={{ minWidth: 0 }}>
            {getDeviceIcon(device?.platform ?? directory.platform, 12)}
            <Text fontSize={12} style={{ flex: 'none' }}>
              {device?.friendlyName || directory.deviceName || directory.deviceId}
            </Text>
            <Text ellipsis fontSize={12} type="secondary">
              {repositoryLocalPath(directory, folder)}
            </Text>
            {index === 0 && directories.length > 1 && (
              <Text fontSize={12} style={{ flex: 'none' }} type="secondary">
                {t('settings.preferredDevice')}
              </Text>
            )}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
};
