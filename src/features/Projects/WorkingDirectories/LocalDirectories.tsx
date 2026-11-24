import type { DeviceListItem } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  confirmModal,
  cssVar,
  Flexbox,
  Icon,
  Tag,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { FolderIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { useSingleton } from '@/hooks/useSingleton';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openAddDirectoryModal } from './AddDirectoryModal';
import {
  type DirectoryEnableAttempt,
  directoryUnavailableReason,
  isMissingDirectoryError,
} from './directoryAvailability';
import { openEditDirectoryModal } from './EditDirectoryModal';

/**
 * Presence as a dot before the device's name — green online, gray offline —
 * with the word on hover. A device row restored from the persisted list
 * (`onlineUnknown`) has not been confirmed yet, so it shows no dot until
 * `listDevices` answers.
 */
const DevicePresence = ({ device }: { device?: DeviceListItem }) => {
  const { t } = useTranslation('project');
  if (device?.onlineUnknown) return null;
  const online = !!device?.online;
  return (
    <Tooltip title={t(online ? 'settings.deviceOnline' : 'settings.deviceOffline')}>
      <span
        aria-label={t(online ? 'settings.deviceOnline' : 'settings.deviceOffline')}
        role="img"
        style={{
          background: online ? cssVar.colorSuccess : cssVar.colorTextQuaternary,
          borderRadius: '50%',
          display: 'inline-block',
          flex: 'none',
          height: 8,
          width: 8,
        }}
      />
    </Tooltip>
  );
};

interface LocalDirectoriesProps {
  canManage: boolean;
  /** The project's environment, which a new folder is linked to. */
  environmentId?: string;
  projectId: string;
}

/**
 * The project's working directory on each device, device by device: where its
 * code already sits on that machine, so a conversation can run there. Every
 * connected device is listed, online ones first: one that has a folder shows
 * it, one that has none offers to set it. A folder on a device no longer in
 * the list stays, so it can still be changed or removed.
 */
export function LocalDirectories({ canManage, environmentId, projectId }: LocalDirectoriesProps) {
  const { t } = useTranslation('project');
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const directories = useProjectDirectories(projectId);
  const deviceRequest = useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const isDeviceListLoaded = useDeviceStore(deviceSelectors.isDeviceListLoaded);
  const removeDirectory = useProjectDirectoryStore((s) => s.removeDirectory);
  const bind = useProjectDirectoryStore((s) => s.bind);

  // A folder registered before environments existed is not enabled for the
  // project's environment yet, so nothing can start in it. There is nothing to
  // choose — a project has one environment — so it is enabled here, once,
  // while its device is online, by someone who may change the project.
  const [attempts, setAttempts] = useState<Record<string, DirectoryEnableAttempt>>({});
  // Tried once per page visit; a folder whose enable is in flight shows nothing.
  const tried = useSingleton(() => new Set<string>());
  useEffect(() => {
    if (!canManage || !environmentId) return;
    for (const directory of directories) {
      if (directory.instanceId || tried.has(directory.id)) continue;
      const device = devices.find((item) => item.deviceId === directory.deviceId);
      if (!device?.online || device.onlineUnknown) continue;
      tried.add(directory.id);
      bind({
        deviceId: directory.deviceId,
        environmentId,
        name: directory.name,
        path: directory.path,
        projectId,
      }).catch((error: unknown) => {
        console.error('Failed to enable project directory', error);
        setAttempts((current) => ({
          ...current,
          [directory.id]: isMissingDirectoryError(error) ? 'missing' : 'failed',
        }));
      });
    }
  }, [bind, canManage, devices, directories, environmentId, projectId, tried]);
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

  const setDirectory = (deviceId: string) =>
    openAddDirectoryModal(projectId, environmentId, { deviceId });

  /**
   * One device on one line: its name, the folder it holds for the project —
   * cut short with the whole path on hover — then on the right its state
   * (an availability tag, the presence dot) and its actions.
   */
  const row = (
    key: string,
    head: ReactNode,
    path: ReactNode,
    status: ReactNode,
    actions: ReactNode,
  ) => (
    <Flexbox
      horizontal
      align="center"
      gap={16}
      key={key}
      paddingBlock={8}
      paddingInline={12}
      style={{ background: cssVar.colorFillQuaternary, borderRadius: cssVar.borderRadius }}
    >
      <Flexbox horizontal align="center" gap={8} style={{ flex: 'none', maxWidth: '45%' }}>
        {head}
      </Flexbox>
      <Flexbox horizontal align="center" flex={1} gap={6} style={{ minWidth: 0 }}>
        <Icon
          icon={FolderIcon}
          size={14}
          style={{ color: cssVar.colorTextTertiary, flex: 'none' }}
        />
        {path}
      </Flexbox>
      <Flexbox horizontal align="center" gap={8} style={{ flex: 'none' }}>
        {status}
      </Flexbox>
      <Flexbox horizontal align="center" gap={4} style={{ flex: 'none' }}>
        {actions}
      </Flexbox>
    </Flexbox>
  );

  const deviceHead = (device: DeviceListItem | undefined, fallbackName: string) => (
    <>
      {getDeviceIcon(device?.platform, 16)}
      <Text ellipsis weight={500}>
        {device?.friendlyName || device?.hostname || fallbackName}
      </Text>
    </>
  );
  // A folder nothing can start in yet, said only when it needs something from
  // the person: a device to come online, a path to fix, or someone who may.
  const unavailableBadge = (directory: ProjectDirectory, device?: DeviceListItem) => {
    const reason = directoryUnavailableReason({
      attempt: attempts[directory.id],
      canManage,
      enabled: !!directory.instanceId,
      online: !!device?.online,
      presenceUnknown: !!device?.onlineUnknown,
    });
    if (!reason) return null;
    return (
      <Tooltip title={t(`settings.directoryUnavailable_${reason}`)}>
        <Tag color="warning" size="small">
          {t('settings.directoryUnavailableTag')}
        </Tag>
      </Tooltip>
    );
  };

  if (error)
    return (
      <AsyncError
        error={error}
        onRetry={() => Promise.all([directoriesRequest.revalidate(), deviceRequest.revalidate()])}
      />
    );
  if (!directoriesRequest.hasData || !isDeviceListLoaded)
    return <Text type="secondary">{t('loading', { ns: 'common' })}</Text>;

  const online = (deviceId: string) =>
    !!devices.find((device) => device.deviceId === deviceId)?.online;
  const withFolders = [...directories]
    .sort((a, b) => Number(online(b.deviceId)) - Number(online(a.deviceId)))
    .map((directory) => {
      const device = devices.find((d) => d.deviceId === directory.deviceId);
      return row(
        directory.id,
        deviceHead(device, directory.deviceName || directory.deviceId),
        <Text
          ellipsis={{ tooltip: directory.path, tooltipWhenOverflow: true }}
          fontSize={12}
          type="secondary"
        >
          {directory.path}
        </Text>,
        <>
          {unavailableBadge(directory, device)}
          <DevicePresence device={device} />
        </>,
        <>
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
        </>,
      );
    });

  const withoutFolder = devices
    .filter((device) => !directories.some((directory) => directory.deviceId === device.deviceId))
    .sort((a, b) => Number(!!b.online) - Number(!!a.online))
    .map((device) =>
      row(
        device.deviceId,
        deviceHead(device, device.deviceId),
        <Text fontSize={12} type="secondary">
          {t('settings.deviceNoDirectory')}
        </Text>,
        <DevicePresence device={device} />,
        canManage ? (
          <Button size="small" onClick={() => setDirectory(device.deviceId)}>
            {t('settings.setDeviceDirectory')}
          </Button>
        ) : null,
      ),
    );

  return (
    <Flexbox gap={8} style={{ marginTop: 8 }}>
      {withFolders.length + withoutFolder.length === 0 ? (
        <Text fontSize={13} type="secondary">
          {t('settings.noDevices')}
        </Text>
      ) : (
        [...withFolders, ...withoutFolder]
      )}
    </Flexbox>
  );
}
