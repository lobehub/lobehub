import { Flexbox, Icon } from '@lobehub/ui';
import {
  Avatar,
  Button,
  createModal,
  ModalFooter,
  Select,
  Text,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { FolderIcon, MonitorIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useDeviceStore } from '@/store/device';
import { useProjectStore } from '@/store/project';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openCreateProjectModal } from '../CreateProjectModal';
import { openEnvironmentModal } from './EnvironmentModal';
import { useBindDirectory } from './useBindDirectory';

export interface BindDirectoryOptions {
  agentId?: string;
  deviceId: string;
  environmentId?: string;
  path: string;
  projectId?: string;
  repositoryUrl?: string;
  topicIds?: string[];
}
const CREATE = '__create__';
function BindDirectoryContent(options: BindDirectoryOptions) {
  const { t } = useTranslation('project');
  const { close } = useModalContext();
  const [environmentId, setEnvironmentId] = useState(options.environmentId ?? '');
  const [projectId, setProjectId] = useState(options.projectId ?? '');
  const name = options.path.split(/[\\/]/).findLast(Boolean) ?? '';
  const { pending, error, save: bindDirectory } = useBindDirectory(options, close);
  const projects = useProjectStore((s) => s.useFetchProjectList)();
  const devices = useDeviceStore((s) => s.devices);
  const deviceName =
    devices.find((d) => d.deviceId === options.deviceId)?.friendlyName ?? options.deviceId;
  const environments = useProjectDirectoryStore((s) => s.useFetchEnvironments)();
  const save = () => bindDirectory(projectId, environmentId);
  return (
    <>
      <Flexbox
        gap={12}
        padding={16}
        style={{ maxHeight: 'calc(100dvh - 200px)', overflowY: 'auto' }}
      >
        <Text type="secondary">{t('directories.bindDescription')}</Text>
        <Flexbox gap={4}>
          <Flexbox horizontal align="center" gap={8}>
            <Icon icon={MonitorIcon} size={16} />
            <Text>{deviceName}</Text>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8}>
            <Icon icon={FolderIcon} size={16} />
            <Text style={{ overflowWrap: 'anywhere' }} type="secondary">
              {options.path}
            </Text>
          </Flexbox>
        </Flexbox>
        <Text>{t('directories.project')}</Text>
        {projects.error ? (
          <AsyncError error={projects.error} onRetry={projects.mutate} />
        ) : (
          <Select
            aria-label={t('directories.project')}
            disabled={pending || !!options.projectId}
            placeholder={t('directories.project')}
            value={projectId}
            options={[
              ...(projects.data?.data ?? []).map((project) => ({
                label: (
                  <Flexbox horizontal align="center" gap={8}>
                    <Avatar avatar={project.avatar || '📁'} size={20} />
                    {project.name}
                  </Flexbox>
                ),
                value: project.id,
              })),
              {
                label: (
                  <Flexbox horizontal align="center" gap={8}>
                    <Icon icon={PlusIcon} size={16} />
                    {t('directories.createProject')}
                  </Flexbox>
                ),
                value: CREATE,
              },
            ]}
            onChange={(value) =>
              value === CREATE
                ? openCreateProjectModal({ onCreated: (project) => setProjectId(project.id) })
                : setProjectId(value ?? '')
            }
          />
        )}
        <Text>{t('directories.environment')}</Text>
        {environments.error ? (
          <AsyncError error={environments.error} onRetry={environments.mutate} />
        ) : (
          <Select
            aria-label={t('directories.environment')}
            disabled={pending}
            placeholder={t('directories.environment')}
            value={environmentId}
            optionRender={(option) => {
              const env = environments.data?.data.find((env) => env.id === option.value);
              const source = env?.configuration.sources?.find((source) => source.kind === 'git');
              return (
                <Flexbox horizontal align="center" gap={8}>
                  <Text>{option.label}</Text>
                  {source && (
                    <Text fontSize={12} type="secondary">
                      {source.url.replace('https://github.com/', 'GitHub · ')}
                    </Text>
                  )}
                </Flexbox>
              );
            }}
            options={[
              ...(environments.data?.data ?? []).map((env) => ({
                label: env.name,
                value: env.id,
              })),
              {
                label: (
                  <Flexbox horizontal align="center" gap={8}>
                    <Icon icon={PlusIcon} size={16} />
                    {t('directories.newEnvironment')}
                  </Flexbox>
                ),
                value: CREATE,
              },
            ]}
            onChange={(value) =>
              value === CREATE
                ? openEnvironmentModal({
                    name,
                    repositoryUrl: options.repositoryUrl,
                    deviceId: options.deviceId,
                    path: options.path,
                    onSaved: (env) => setEnvironmentId(env.id),
                  })
                : setEnvironmentId(value ?? '')
            }
          />
        )}
        {!!options.topicIds?.length && (
          <Text fontSize={12} type="secondary">
            {t('directories.autoFileTopics', { count: options.topicIds.length })}
          </Text>
        )}
        {error ? (
          <AsyncError
            description={error instanceof Error ? error.message : undefined}
            error={error}
            onRetry={save}
          />
        ) : null}
      </Flexbox>
      <ModalFooter>
        <Button disabled={pending} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          disabled={!projectId || !environmentId || !name.trim()}
          loading={pending}
          type="primary"
          onClick={save}
        >
          {t('directories.bind')}
        </Button>
      </ModalFooter>
    </>
  );
}
export const openBindDirectoryModal = (options: BindDirectoryOptions) =>
  createModal({
    title: t('directories.bind', { ns: 'project' }),
    content: <BindDirectoryContent {...options} />,
    footer: null,
    styles: { content: { padding: 0 } },
    width: 520,
  });
