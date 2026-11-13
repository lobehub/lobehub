import type { DeviceListItem } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  confirmModal,
  cssVar,
  Flexbox,
  Icon,
  Select,
  Text,
  toast,
} from '@lobehub/ui';
import { FolderIcon, LinkIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import {
  useProjectDirectories,
  useProjectDirectoryStore,
  useProjectEnvironments,
} from '@/store/projectWorkingDirectory';

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

export function WorkingDirectorySettings({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const [params, setParams] = useSearchParams();
  const environmentId = params.get('environment') ?? '';
  useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const project = useCurrentProjectDetail(projectId);
  const environmentsRequest = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const environments = useProjectEnvironments(projectId);
  const directories = useProjectDirectories(projectId);
  const deviceRequest = useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const isDeviceListLoaded = useDeviceStore(deviceSelectors.isDeviceListLoaded);
  const items = directories.filter((d) => !environmentId || d.environmentId === environmentId);
  const error = environmentsRequest.error || directoriesRequest.error || deviceRequest.error;
  const removeDirectory = useProjectDirectoryStore((s) => s.removeDirectory);
  const canManage = project?.permissions?.canManage ?? false;
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
  return (
    <Flexbox gap={20}>
      <Flexbox gap={6}>
        <Text fontSize={16} weight={600}>
          {t('settings.workLocations')}
        </Text>
        <Text type="secondary">{t('settings.directoryListDescription')}</Text>
      </Flexbox>
      <Flexbox horizontal gap={12} justify="space-between">
        <Select
          aria-label={t('directories.environment')}
          value={environmentId || '__all__'}
          options={[
            { label: t('settings.allEnvironments'), value: '__all__' },
            ...environments.map((env) => ({ label: env.name, value: env.id })),
          ]}
          onChange={(id) => setParams(id && id !== '__all__' ? { environment: id } : {})}
        />
        <Button
          icon={PlusIcon}
          type="primary"
          onClick={() =>
            environments.length
              ? openAddDirectoryModal(projectId, environmentId || undefined)
              : navigate(`/project/${projectId}/settings/environments`)
          }
        >
          {t('settings.addDirectory')}
        </Button>
      </Flexbox>
      {error ? (
        <AsyncError
          error={error}
          onRetry={() =>
            Promise.all([
              environmentsRequest.revalidate(),
              directoriesRequest.revalidate(),
              deviceRequest.revalidate(),
            ])
          }
        />
      ) : null}
      {error ? null : !directoriesRequest.hasData ||
        !environmentsRequest.hasData ||
        !isDeviceListLoaded ? (
        <Text>{t('loading', { ns: 'common' })}</Text>
      ) : !items.length ? (
        <Flexbox gap={12} paddingBlock={24}>
          <Text type="secondary">{t('settings.noDirectories')}</Text>
          {!environments.length && (
            <Button onClick={() => navigate(`/project/${projectId}/settings/environments`)}>
              {t('settings.addEnvironment')}
            </Button>
          )}
        </Flexbox>
      ) : (
        <Flexbox>
          {items.map((directory, index) => (
            <Flexbox
              key={directory.id}
              paddingBlock={12}
              style={index ? { borderTop: `1px solid ${cssVar.colorBorderSecondary}` } : undefined}
            >
              <Flexbox horizontal align="center" gap={16} justify="space-between">
                <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
                  <Flexbox horizontal align="center" gap={8}>
                    <Icon icon={FolderIcon} size={18} />
                    <Text style={{ overflowWrap: 'anywhere' }} weight={500}>
                      {directory.path}
                    </Text>
                  </Flexbox>
                  <Flexbox horizontal align="center" gap={8} wrap="wrap">
                    {getDeviceIcon(
                      devices.find((d) => d.deviceId === directory.deviceId)?.platform,
                      14,
                    )}
                    <Text fontSize={12}>{directory.deviceName || directory.deviceId}</Text>
                    <DevicePresence
                      device={devices.find((d) => d.deviceId === directory.deviceId)}
                    />
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
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
}
