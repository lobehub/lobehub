import { Block, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Button, DropdownMenu, Text } from '@lobehub/ui/base-ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
import { ChevronDownIcon, FolderIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openEnvironmentModal } from './EnvironmentModal';

export function ProjectWorkingDirectories({ projectId }: { projectId: string }) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
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
  const unlinked = (available.data?.data ?? []).filter(
    (env) => !linked.data?.data.some((item) => item.id === env.id),
  );
  const requestError = error || linked.error || available.error || directories.error;
  return (
    <Flexbox gap={20}>
      <Flexbox gap={12}>
        <Flexbox horizontal align="center" gap={12} justify="space-between">
          <Text fontSize={16} weight={600}>
            {t('settings.environments')}
          </Text>
          <Flexbox horizontal gap={8}>
            {!!unlinked.length && (
              <DropdownMenu
                items={unlinked.map((env) => ({
                  key: env.id,
                  label: env.name,
                  onClick: () => void link(env.id),
                }))}
              >
                <Button disabled={pending} icon={ChevronDownIcon}>
                  {t('settings.reuseEnvironment')}
                </Button>
              </DropdownMenu>
            )}
            <Button
              disabled={pending}
              icon={PlusIcon}
              type="primary"
              onClick={() => openEnvironmentModal({ onSaved: (env) => link(env.id) })}
            >
              {t('directories.newEnvironment')}
            </Button>
          </Flexbox>
        </Flexbox>
        <Text type="secondary">{t('settings.environmentDescription')}</Text>
      </Flexbox>
      {requestError ? (
        <AsyncError
          error={requestError}
          onRetry={() =>
            failedEnvironmentId
              ? link(failedEnvironmentId)
              : Promise.all([linked.mutate(), available.mutate(), directories.mutate()])
          }
        />
      ) : linked.isLoading || directories.isLoading ? (
        <Text>{t('loading', { ns: 'common' })}</Text>
      ) : !linked.data?.data.length ? (
        <Text type="secondary">{t('settings.noEnvironments')}</Text>
      ) : (
        <Block padding={0} variant="outlined">
          {linked.data.data.map((env, index) => {
            const source = env.configuration.sources?.find((source) => source.kind === 'git');
            const count = (directories.data?.data ?? []).filter(
              (d) => d.environmentId === env.id,
            ).length;
            return (
              <Flexbox
                horizontal
                align="center"
                gap={16}
                justify="space-between"
                key={env.id}
                padding={16}
                style={
                  index ? { borderTop: `1px solid ${cssVar.colorBorderSecondary}` } : undefined
                }
              >
                <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
                  <Text weight={500}>{env.name}</Text>
                  <Flexbox horizontal align="center" gap={6}>
                    <Icon icon={source ? GithubIcon : FolderIcon} size={14} />
                    {source ? (
                      <a
                        href={source.url}
                        rel="noreferrer"
                        target="_blank"
                        style={{
                          color: cssVar.colorTextSecondary,
                          overflowWrap: 'anywhere',
                          fontSize: 13,
                        }}
                      >
                        {source.url.replace('https://github.com/', '')}
                      </a>
                    ) : (
                      <Text fontSize={13} type="secondary">
                        {t('settings.noRepository')}
                      </Text>
                    )}
                  </Flexbox>
                </Flexbox>
                <Flexbox horizontal align="center" flex="none" gap={12}>
                  <Button
                    size="small"
                    onClick={() =>
                      navigate(`/project/${projectId}/settings/directories?environment=${env.id}`)
                    }
                  >
                    {t(count ? 'settings.viewDirectories' : 'settings.configureDirectory', {
                      count,
                    })}
                  </Button>
                  <ActionIcon
                    aria-label={t('directories.editEnvironment')}
                    icon={PencilIcon}
                    size="small"
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
              </Flexbox>
            );
          })}
        </Block>
      )}
    </Flexbox>
  );
}
