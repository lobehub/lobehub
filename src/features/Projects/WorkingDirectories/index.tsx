import {
  Button,
  Center,
  confirmModal,
  DropdownMenu,
  Empty,
  Flexbox,
  Icon,
  Tag,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ContainerIcon,
  FolderIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PlusIcon,
  UnlinkIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { openCreateEnvironmentModal } from '@/features/EnvironmentManager/CreateEnvironmentModal';
import EnvironmentDetailPanel from '@/features/EnvironmentManager/EnvironmentDetailPanel';
import EnvironmentItem from '@/features/EnvironmentManager/EnvironmentItem';
import { EnvironmentListSkeleton } from '@/features/EnvironmentManager/Skeleton';
import { useEnvironments } from '@/features/EnvironmentManager/useEnvironmentData';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import {
  useProjectDirectories,
  useProjectDirectoryStore,
  useProjectEnvironments,
} from '@/store/projectWorkingDirectory';
import type { SandboxEnvironment } from '@/store/sandbox';

import { openAddEnvironmentModal } from '../AddEnvironmentModal';
import { environmentRepositoryUrl } from '../environmentSource';
import { hasEditedEnvironment, projectEnvironmentRows } from './projectEnvironmentRows';

/** The frames the environment settings use, so both lists read as one. */
const styles = stylex.create({
  detailCol: {
    alignSelf: 'stretch',
    minWidth: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
  },
  listCol: {
    overflow: 'hidden',
    minWidth: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
  },
  unlistedRow: {
    paddingBlock: '12px',
    paddingInline: '12px',
  },
  unlistedTile: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
});

interface ProjectWorkingDirectoriesProps {
  /** Whether the caller may change which environments the project links. */
  canManage?: boolean;
  projectId: string;
  /**
   * A workspace-public project: its conversations run a public agent, which
   * applies published environments only.
   */
  shared?: boolean;
}

/**
 * The environments a project works with. They are the environments configured
 * in settings — the same rows, the same detail panel — linked to the project:
 * linking one, making a new one here or unlinking one never makes a second copy
 * of a specification, so an edit made on either page is the edit.
 */
export function ProjectWorkingDirectories({
  canManage,
  projectId,
  shared,
}: ProjectWorkingDirectoriesProps) {
  const { t } = useTranslation(['project', 'common']);
  const navigate = useWorkspaceAwareNavigate();
  const linkedRequest = useProjectDirectoryStore((s) => s.useFetchEnvironments)(projectId);
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const attachEnvironment = useProjectDirectoryStore((s) => s.attachEnvironment);
  const detachEnvironment = useProjectDirectoryStore((s) => s.detachEnvironment);
  const linked = useProjectEnvironments(projectId);
  const directories = useProjectDirectories(projectId);
  const configured = useEnvironments();
  const [selectedId, setSelectedId] = useState<string>();

  const requestError = linkedRequest.error || directoriesRequest.error;
  const loading =
    !linkedRequest.hasData ||
    !directoriesRequest.hasData ||
    (!configured.settled && !configured.error);

  const { configured: rows, unlisted: unlistedRows } = projectEnvironmentRows(
    linked,
    configured.environments ?? [],
  );
  // Until the configured list has answered, "not in it" is not an answer yet.
  const unlisted = configured.settled ? unlistedRows : [];
  const selected = rows.find((environment) => environment.id === selectedId);

  // The detail panel saves through the settings store; the project's own
  // projections (directory rows carry the environment's name) follow when a
  // linked environment's name or visibility changes there.
  const refreshEnvironments = useProjectDirectoryStore((s) => s.refreshEnvironments);
  const lastRows = useRef<SandboxEnvironment[]>(undefined);
  useEffect(() => {
    const previous = lastRows.current;
    lastRows.current = rows;
    if (previous && hasEditedEnvironment(previous, rows)) void refreshEnvironments();
  }, [rows, refreshEnvironments]);

  const link = () =>
    openAddEnvironmentModal({
      defaultSource: 'existing',
      onAdded: (environmentId) => {
        setSelectedId(environmentId);
        // A repository added from GitHub may have made a new environment.
        void configured.revalidate();
      },
      projectId,
      publish: shared,
    });

  const create = () =>
    openCreateEnvironmentModal(
      shared ? 'public' : undefined,
      async (created) => {
        try {
          await attachEnvironment(projectId, created.id);
          setSelectedId(created.id);
        } catch (error) {
          console.error('Failed to link the new environment to the project', error);
          toast.error(t('environment.add.failed'));
        }
      },
      t('environment.create'),
    );

  const unlink = (environment: { id: string; name: string }) =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('environment.unlinkConfirm.desc'),
      okText: t('environment.unlink'),
      onOk: async () => {
        try {
          await detachEnvironment(projectId, environment.id);
          setSelectedId((current) => (current === environment.id ? undefined : current));
        } catch (error) {
          console.error('Failed to unlink the environment from the project', error);
          toast.error(t('environment.unlinkFailed'));
        }
      },
      title: t('environment.unlinkConfirm.title', { name: environment.name }),
    });

  const projectMenu = (environment: { id: string; name: string }) =>
    canManage
      ? [
          {
            icon: <Icon icon={UnlinkIcon} />,
            key: 'unlink',
            label: t('environment.unlink'),
            onClick: () => unlink(environment),
          },
        ]
      : [];

  /** What the project adds to a row: its folders, and whether it can be used. */
  const projectFacts = (environment: { id: string; visibility?: string | null }): ReactNode => {
    const count = directories.filter((d) => d.environmentId === environment.id).length;
    // The project's conversations never check a private one out.
    const unusable = shared && environment.visibility !== 'public';
    return (
      <Flexbox horizontal align="center" gap={8}>
        {unusable && (
          <Tooltip title={t('environment.privateInSharedTooltip')}>
            <Tag color="warning" size="small">
              {t('environment.privateInShared')}
            </Tag>
          </Tooltip>
        )}
        <Button
          size="small"
          onClick={() =>
            navigate(`/project/${projectId}/settings/directories?environment=${environment.id}`)
          }
        >
          {t(count ? 'settings.viewDirectories' : 'settings.configureDirectory', { count })}
        </Button>
      </Flexbox>
    );
  };

  const actions = canManage && (
    <Flexbox horizontal align="center" gap={8} style={{ flex: 'none' }}>
      <Button icon={<Icon icon={LinkIcon} />} onClick={link}>
        {t('environment.link')}
      </Button>
      <Button icon={<Icon icon={PlusIcon} />} type="primary" onClick={create}>
        {t('environment.create')}
      </Button>
    </Flexbox>
  );

  let content: ReactNode;
  if (requestError) {
    content = (
      <AsyncError
        error={requestError}
        onRetry={() => Promise.all([linkedRequest.revalidate(), directoriesRequest.revalidate()])}
      />
    );
  } else if (loading) {
    content = <EnvironmentListSkeleton />;
  } else if (!linked.length) {
    content = (
      <Flexbox {...stylex.props(styles.listCol)}>
        <Center paddingBlock={48} width="100%">
          <Empty
            action={canManage && <Button onClick={link}>{t('environment.link')}</Button>}
            description={t('settings.environmentDescription')}
            descriptionProps={{ fontSize: 13 }}
            icon={ContainerIcon}
            style={{ maxWidth: 360 }}
            title={t('settings.noEnvironments')}
          />
        </Center>
      </Flexbox>
    );
  } else {
    content = (
      <Flexbox horizontal align="flex-start" gap={16} wrap="wrap">
        <Flexbox {...stylex.props(styles.listCol)} flex="1 1 320px">
          {!!configured.error && !configured.settled && (
            <AsyncError error={configured.error} onRetry={() => configured.revalidate()} />
          )}
          <Flexbox gap={2} padding={4}>
            {rows.map((environment) => (
              <EnvironmentItem
                environment={environment}
                extra={projectFacts(environment)}
                key={environment.id}
                menuItems={projectMenu(environment)}
                selected={environment.id === selectedId}
                onSelect={() =>
                  setSelectedId((current) =>
                    current === environment.id ? undefined : environment.id,
                  )
                }
              />
            ))}
            {unlisted.map((environment) => {
              const repository = environmentRepositoryUrl(environment);
              return (
                <Flexbox
                  horizontal
                  align="center"
                  {...stylex.props(styles.unlistedRow)}
                  gap={16}
                  key={environment.id}
                >
                  <div {...stylex.props(styles.unlistedTile)}>
                    <FolderIcon size={20} />
                  </div>
                  <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                    <Text ellipsis fontSize={15} weight={500}>
                      {environment.name}
                    </Text>
                    <Text ellipsis fontSize={12} type="secondary">
                      {repository?.replace('https://github.com/', '') ?? t('settings.noRepository')}
                    </Text>
                  </Flexbox>
                  <Flexbox horizontal align="center" gap={8} style={{ flex: 'none' }}>
                    {projectFacts(environment)}
                    {canManage && (
                      <DropdownMenu items={projectMenu(environment)} placement="bottomRight">
                        <Button
                          aria-label={t('more', { ns: 'common' })}
                          icon={MoreHorizontalIcon}
                        />
                      </DropdownMenu>
                    )}
                  </Flexbox>
                </Flexbox>
              );
            })}
          </Flexbox>
        </Flexbox>
        {selected && (
          <Flexbox {...stylex.props(styles.detailCol)} flex="2 1 480px">
            <EnvironmentDetailPanel
              environment={selected}
              key={selected.id}
              onClose={() => setSelectedId(undefined)}
            />
          </Flexbox>
        )}
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={16}>
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
          <Text fontSize={16} weight={600}>
            {t('settings.environments')}
          </Text>
          {actions}
        </Flexbox>
        <Text type="secondary">{t('settings.environmentDescription')}</Text>
      </Flexbox>
      {content}
    </Flexbox>
  );
}
