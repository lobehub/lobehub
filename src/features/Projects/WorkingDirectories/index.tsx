import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Select, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { FolderIcon, GitBranchIcon, MonitorIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openBindDirectoryModal } from './BindDirectoryModal';
import { openEnvironmentModal } from './EnvironmentModal';

export function ProjectWorkingDirectories({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project');
  const linked = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const available = useProjectDirectoryStore((s) => s.useFetchEnvironments)();
  const directories = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const attach = useProjectDirectoryStore((s) => s.attachEnvironment);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [failedEnvironmentId, setFailedEnvironmentId] = useState<string>();
  const link = async (id: string) => {
    setFailedEnvironmentId(id);
    setPending(true);
    setError(undefined);
    try {
      await attach(projectId, id);
      setFailedEnvironmentId(undefined);
    } catch (error) {
      console.error('Failed to associate environment', error);
      setError(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <Flexbox gap={24}>
      <Flexbox gap={16}>
        <Flexbox horizontal align="center" gap={12} justify="space-between">
          <Text fontSize={18} style={{ whiteSpace: 'nowrap' }} weight={600}>
            {t('settings.environments')}
          </Text>
          <Flexbox flex="none" width={240}>
            <Select
              aria-label={t('settings.addEnvironment')}
              disabled={pending}
              placeholder={t('settings.addEnvironment')}
              value=""
              options={[
                ...(available.data?.data ?? [])
                  .filter((env) => !linked.data?.data.some((e) => e.id === env.id))
                  .map((env) => ({ label: env.name, value: env.id })),
                {
                  label: (
                    <Flexbox horizontal align="center" gap={8}>
                      <Icon icon={PlusIcon} size={16} />
                      {t('directories.newEnvironment')}
                    </Flexbox>
                  ),
                  value: '__create__',
                },
              ]}
              onChange={(id) =>
                id === '__create__'
                  ? openEnvironmentModal({ onSaved: (env) => link(env.id) })
                  : id && void link(id)
              }
            />
          </Flexbox>
        </Flexbox>
        <Text type="secondary">{t('settings.environmentDescription')}</Text>
        {error || linked.error || available.error || directories.error ? (
          <AsyncError
            error={error || linked.error || available.error || directories.error}
            onRetry={() =>
              failedEnvironmentId
                ? link(failedEnvironmentId)
                : Promise.all([linked.mutate(), available.mutate(), directories.mutate()])
            }
          />
        ) : null}
        {linked.isLoading ? (
          <Text>{t('loading', { ns: 'common' })}</Text>
        ) : !linked.data?.data.length ? (
          <Text type="secondary">{t('settings.noEnvironments')}</Text>
        ) : (
          <Flexbox
            style={{
              border: `1px solid ${cssVar.colorBorderSecondary}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {linked.data.data.map((env, index) => {
              const source = env.configuration.sources?.find((s) => s.kind === 'git');
              const bindings = (directories.data?.data ?? []).filter(
                (d) => d.environmentId === env.id,
              );
              return (
                <Flexbox
                  gap={12}
                  key={env.id}
                  padding={20}
                  style={
                    index ? { borderTop: `1px solid ${cssVar.colorBorderSecondary}` } : undefined
                  }
                >
                  <Flexbox horizontal align="center" gap={12} justify="space-between">
                    <Flexbox horizontal align="center" gap={10}>
                      <Icon icon={source ? GitBranchIcon : FolderIcon} size={20} />
                      <Text weight={600}>{env.name}</Text>
                    </Flexbox>
                    <ActionIcon
                      aria-label={t('directories.editEnvironment')}
                      icon={PencilIcon}
                      title={t('directories.editEnvironment')}
                      onClick={() =>
                        openEnvironmentModal({
                          id: env.id,
                          name: env.name,
                          repositoryUrl: source?.url,
                          onSaved: () => {},
                        })
                      }
                    />
                  </Flexbox>
                  {source ? (
                    <a
                      href={source.url}
                      rel="noreferrer"
                      style={{ color: cssVar.colorTextSecondary, overflowWrap: 'anywhere' }}
                      target="_blank"
                    >
                      {source.url.replace('https://github.com/', 'GitHub · ')}
                    </a>
                  ) : (
                    <Text fontSize={13} type="secondary">
                      {t('settings.noRepository')}
                    </Text>
                  )}
                  <Flexbox gap={8}>
                    {bindings.length ? (
                      bindings.map((d) => (
                        <Flexbox horizontal align="start" gap={8} key={d.id}>
                          <Icon
                            icon={MonitorIcon}
                            size={16}
                            style={{ marginTop: 3, flexShrink: 0 }}
                          />
                          <Flexbox gap={2}>
                            <Text fontSize={13}>{d.deviceName || d.deviceId}</Text>
                            <Text
                              fontSize={12}
                              style={{ overflowWrap: 'anywhere' }}
                              type="secondary"
                            >
                              {d.path}
                            </Text>
                          </Flexbox>
                        </Flexbox>
                      ))
                    ) : (
                      <Text fontSize={13} type="secondary">
                        {t('settings.noDirectories')}
                      </Text>
                    )}
                  </Flexbox>
                </Flexbox>
              );
            })}
          </Flexbox>
        )}
        {(directories.data?.data ?? [])
          .filter((d) => !d.instanceId)
          .map((d) => (
            <Flexbox horizontal justify="space-between" key={d.id}>
              <Text>
                {d.name} · {d.path}
              </Text>
              <ActionIcon
                icon={PlusIcon}
                title={t('directories.bind')}
                onClick={() =>
                  openBindDirectoryModal({ projectId, deviceId: d.deviceId, path: d.path })
                }
              />
            </Flexbox>
          ))}
      </Flexbox>
    </Flexbox>
  );
}
