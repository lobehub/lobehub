import type { DeviceListItem } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  confirmModal,
  Flexbox,
  Icon,
  SortableList,
  Text,
  toast,
} from '@lobehub/ui';
import { FolderIcon, LinkIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openAddDirectoryModal } from './AddDirectoryModal';
import { openBindDirectoryModal } from './BindDirectoryModal';
import { openEditDirectoryModal } from './EditDirectoryModal';

/**
 * A device row restored from the persisted list (`onlineUnknown`) has not been
 * confirmed yet, so its presence is left unsaid until `listDevices` answers.
 */
const DevicePresence = ({ device }: { device?: DeviceListItem }) => {
  const { t } = useTranslation('project');
  if (device?.onlineUnknown) return null;
  return (
    <Text fontSize={12} type="secondary">
      {t(device?.online ? 'settings.deviceOnline' : 'settings.deviceOffline')}
    </Text>
  );
};

interface LocalDirectoriesProps {
  canManage: boolean;
  /** The project's environment, which a new folder is linked to. */
  environmentId?: string;
  projectId: string;
}

/**
 * The project's folders on its devices, as one section of its environment:
 * where the repositories are checked out locally, and in which order the
 * devices are tried. The order is the project's device priority — a new
 * conversation starts in the first folder whose device is online — so it is
 * dragged here, not set anywhere else.
 */
export function LocalDirectories({ canManage, environmentId, projectId }: LocalDirectoriesProps) {
  const { t } = useTranslation('project');
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const directories = useProjectDirectories(projectId);
  const deviceRequest = useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const isDeviceListLoaded = useDeviceStore(deviceSelectors.isDeviceListLoaded);
  const removeDirectory = useProjectDirectoryStore((s) => s.removeDirectory);
  const reorderDirectories = useProjectDirectoryStore((s) => s.reorderDirectories);
  const error = directoriesRequest.error || deviceRequest.error;

  const remove = (directory: ProjectDirectory) =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('settings.removeDirectoryConfirmDescription', {
        device: directory.deviceName || directory.deviceId,
        path: directory.path,
      }),
      okButtonProps: { danger: true },
      okText: t('settings.removeDirectory'),
      onOk: async () => {
        try {
          await removeDirectory(projectId, directory.id);
        } catch (error) {
          console.error('Failed to remove project directory', error);
          toast.error(t('settings.removeDirectoryFailed'));
        }
      },
      title: t('settings.removeDirectoryConfirmTitle', { name: directory.name }),
    });

  const reorder = async (next: ProjectDirectory[]) => {
    try {
      await reorderDirectories(
        projectId,
        next.map((directory) => directory.id),
      );
    } catch (error) {
      console.error('Failed to reorder project directories', error);
      toast.error(t('settings.reorderDirectoriesFailed'));
    }
  };

  const renderRow = (directory: ProjectDirectory, index: number) => {
    const device = devices.find((d) => d.deviceId === directory.deviceId);
    return (
      <Flexbox horizontal align="center" flex={1} gap={16} justify="space-between">
        <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={8}>
            <Icon icon={FolderIcon} size={16} />
            <Text style={{ overflowWrap: 'anywhere' }} weight={500}>
              {directory.path}
            </Text>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8} wrap="wrap">
            {getDeviceIcon(device?.platform, 14)}
            <Text fontSize={12}>{directory.deviceName || directory.deviceId}</Text>
            <DevicePresence device={device} />
            {index === 0 && directories.length > 1 && (
              <Text fontSize={12} type="secondary">
                {t('settings.preferredDevice')}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={8}>
          {/* A legacy row has no environment yet, so linking it is still its next step. */}
          {!directory.instanceId && (
            <Button
              icon={LinkIcon}
              size="small"
              onClick={() =>
                openBindDirectoryModal({
                  projectId,
                  deviceId: directory.deviceId,
                  path: directory.path,
                })
              }
            >
              {t('directories.bind')}
            </Button>
          )}
          {canManage && (
            <ActionIcon
              icon={PencilIcon}
              size="small"
              title={t('settings.editDirectory')}
              onClick={() => openEditDirectoryModal(projectId, directory)}
            />
          )}
          {canManage && (
            <ActionIcon
              icon={Trash2Icon}
              size="small"
              title={t('settings.removeDirectory')}
              onClick={() => remove(directory)}
            />
          )}
        </Flexbox>
      </Flexbox>
    );
  };

  let content;
  if (error) {
    content = (
      <AsyncError
        error={error}
        onRetry={() => Promise.all([directoriesRequest.revalidate(), deviceRequest.revalidate()])}
      />
    );
  } else if (!directoriesRequest.hasData || !isDeviceListLoaded) {
    content = <Text type="secondary">{t('loading', { ns: 'common' })}</Text>;
  } else if (!directories.length) {
    content = (
      <Text fontSize={13} type="secondary">
        {t('settings.noDirectories')}
      </Text>
    );
  } else if (canManage && directories.length > 1) {
    content = (
      <SortableList
        gap={8}
        items={directories}
        renderItem={(directory: ProjectDirectory) => (
          <SortableList.Item id={directory.id} variant="filled">
            <SortableList.DragHandle />
            {renderRow(directory, directories.indexOf(directory))}
          </SortableList.Item>
        )}
        onChange={reorder}
      />
    );
  } else {
    content = (
      <Flexbox gap={8}>
        {directories.map((directory, index) => (
          <Flexbox horizontal key={directory.id} paddingBlock={8}>
            {renderRow(directory, index)}
          </Flexbox>
        ))}
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={12} style={{ marginTop: 8 }}>
      <Flexbox gap={4}>
        <Text weight={500}>{t('settings.localDirectories')}</Text>
        <Text fontSize={12} type="secondary">
          {t('settings.localDirectoriesHint')}
        </Text>
      </Flexbox>
      {content}
      {canManage && (
        <Flexbox horizontal>
          <Button
            icon={<Icon icon={PlusIcon} />}
            size="small"
            onClick={() => openAddDirectoryModal(projectId, environmentId)}
          >
            {t('settings.addDirectory')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
}
