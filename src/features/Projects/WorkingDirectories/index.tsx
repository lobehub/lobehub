import { ActionIcon, Block, Button, cssVar, Flexbox, Tag, Text, Tooltip } from '@lobehub/ui';
import { FolderIcon, PencilIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import RepositoryAvatar from '@/components/RepositoryAvatar';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import {
  useProjectDirectories,
  useProjectDirectoryStore,
  useProjectEnvironments,
} from '@/store/projectWorkingDirectory';

import { openAddEnvironmentModal } from '../AddEnvironmentModal';
import { openEnvironmentModal } from './EnvironmentModal';

interface ProjectWorkingDirectoriesProps {
  projectId: string;
  /**
   * A workspace-public project: its conversations run a public agent, which
   * applies published environments only.
   */
  shared?: boolean;
}

export function ProjectWorkingDirectories({ projectId, shared }: ProjectWorkingDirectoriesProps) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const linkedRequest = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const linked = useProjectEnvironments(projectId);
  const directories = useProjectDirectories(projectId);
  const requestError = linkedRequest.error || directoriesRequest.error;
  return (
    <Flexbox gap={20}>
      <Flexbox gap={12}>
        <Flexbox horizontal align="center" gap={12} justify="space-between">
          <Text fontSize={16} weight={600}>
            {t('settings.environments')}
          </Text>
          <Button
            icon={PlusIcon}
            type="primary"
            onClick={() => openAddEnvironmentModal({ projectId, publish: shared })}
          >
            {t('environment.add.title')}
          </Button>
        </Flexbox>
        <Text type="secondary">{t('settings.environmentDescription')}</Text>
      </Flexbox>
      {requestError ? (
        <AsyncError
          error={requestError}
          onRetry={() => Promise.all([linkedRequest.revalidate(), directoriesRequest.revalidate()])}
        />
      ) : !linkedRequest.hasData || !directoriesRequest.hasData ? (
        <Text>{t('loading', { ns: 'common' })}</Text>
      ) : !linked.length ? (
        <Text type="secondary">{t('settings.noEnvironments')}</Text>
      ) : (
        <Block padding={0} variant="outlined">
          {linked.map((env, index) => {
            const source = env.configuration.sources?.find((source) => source.kind === 'git');
            const count = directories.filter((d) => d.environmentId === env.id).length;
            // The project's conversations never check a private one out.
            const unusable = shared && env.visibility !== 'public';
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
                <Flexbox horizontal align="center" flex={1} gap={12} style={{ minWidth: 0 }}>
                  {source ? (
                    <RepositoryAvatar size={36} url={source.url} />
                  ) : (
                    <Block
                      align="center"
                      height={36}
                      justify="center"
                      style={{ borderRadius: '50%', flex: 'none' }}
                      variant="filled"
                      width={36}
                    >
                      <FolderIcon size={16} />
                    </Block>
                  )}
                  <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
                    <Flexbox horizontal align="center" gap={8}>
                      <Text ellipsis weight={500}>
                        {env.name}
                      </Text>
                      {unusable && (
                        <Tooltip title={t('environment.privateInSharedTooltip')}>
                          <Tag color="warning" size="small">
                            {t('environment.privateInShared')}
                          </Tag>
                        </Tooltip>
                      )}
                    </Flexbox>
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
