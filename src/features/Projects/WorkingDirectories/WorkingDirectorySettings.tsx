import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Button, Select, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { FolderIcon, MessageSquarePlusIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useDeviceStore } from '@/store/device';
import { useProjectStore } from '@/store/project';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openAddDirectoryModal } from './AddDirectoryModal';
import { openBindDirectoryModal } from './BindDirectoryModal';
import { openProjectTopicModal } from './SidebarTopics';

export function WorkingDirectorySettings({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const [params, setParams] = useSearchParams();
  const environmentId = params.get('environment') ?? '';
  const project = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const environments = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const directories = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const deviceRequest = useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore((s) => s.devices);
  const items = (directories.data?.data ?? []).filter(
    (d) => !environmentId || d.environmentId === environmentId,
  );
  const error = environments.error || directories.error || deviceRequest.error;
  return (
    <Flexbox gap={20}>
      <Flexbox gap={6}>
        <Text fontSize={16} weight={600}>
          {t('settings.workLocations')}
        </Text>
        <Text type="secondary">{t('settings.directoryDescription')}</Text>
      </Flexbox>
      <Flexbox horizontal gap={12} justify="space-between">
        <Select
          aria-label={t('directories.environment')}
          value={environmentId || '__all__'}
          options={[
            { label: t('settings.allEnvironments'), value: '__all__' },
            ...(environments.data?.data ?? []).map((env) => ({ label: env.name, value: env.id })),
          ]}
          onChange={(id) => setParams(id && id !== '__all__' ? { environment: id } : {})}
        />
        <Button
          icon={PlusIcon}
          type="primary"
          onClick={() =>
            environments.data?.data.length
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
            Promise.all([environments.mutate(), directories.mutate(), deviceRequest.mutate()])
          }
        />
      ) : null}
      {error ? null : directories.isLoading || environments.isLoading || deviceRequest.isLoading ? (
        <Text>{t('loading', { ns: 'common' })}</Text>
      ) : !items.length ? (
        <Flexbox gap={12} paddingBlock={24}>
          <Text type="secondary">{t('settings.noDirectories')}</Text>
          {!environments.data?.data.length && (
            <Button onClick={() => navigate(`/project/${projectId}/settings/environments`)}>
              {t('settings.addEnvironment')}
            </Button>
          )}
        </Flexbox>
      ) : (
        <Block padding={0} variant="outlined">
          {items.map((directory, index) => (
            <Flexbox
              key={directory.id}
              padding={16}
              style={index ? { borderTop: `1px solid ${cssVar.colorBorderSecondary}` } : undefined}
            >
              <Flexbox horizontal align="center" gap={16} justify="space-between">
                <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
                  <Flexbox horizontal align="center" gap={8}>
                    <Icon icon={FolderIcon} size={18} />
                    <Text weight={500}>
                      {directory.path.split(/[\\/]/).findLast(Boolean) || directory.name}
                    </Text>
                  </Flexbox>
                  <Text fontSize={12} style={{ overflowWrap: 'anywhere' }} type="secondary">
                    {directory.path}
                  </Text>
                  <Flexbox horizontal align="center" gap={8} wrap="wrap">
                    {getDeviceIcon(
                      devices.find((d) => d.deviceId === directory.deviceId)?.platform,
                      14,
                    )}
                    <Text fontSize={12}>{directory.deviceName || directory.deviceId}</Text>
                    <Text fontSize={12} type="secondary">
                      {t(
                        devices.find((d) => d.deviceId === directory.deviceId)?.online
                          ? 'settings.deviceOnline'
                          : 'settings.deviceOffline',
                      )}
                    </Text>
                    <Text fontSize={12} type="secondary">
                      · {directory.environmentName || t('directories.noEnvironment')}
                    </Text>
                  </Flexbox>
                </Flexbox>
                <Button
                  icon={MessageSquarePlusIcon}
                  size="small"
                  disabled={
                    Boolean(directory.instanceId) && !project.data?.data.project.coordinatorAgentId
                  }
                  onClick={() =>
                    !directory.instanceId
                      ? openBindDirectoryModal({
                          projectId,
                          deviceId: directory.deviceId,
                          path: directory.path,
                        })
                      : openProjectTopicModal({
                          projectId,
                          coordinatorAgentId: project.data!.data.project.coordinatorAgentId,
                          directories: directories.data?.data ?? [],
                          initialDirectoryId: directory.id,
                          title: t('directories.start'),
                        })
                  }
                >
                  {t(
                    directory.instanceId
                      ? 'settings.startDirectoryConversation'
                      : 'directories.bind',
                  )}
                </Button>
              </Flexbox>
            </Flexbox>
          ))}
        </Block>
      )}
    </Flexbox>
  );
}
