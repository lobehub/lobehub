'use client';

import { agentDisplayName } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  Center,
  ContextMenuTrigger,
  createStaticStyles,
  cssVar,
  cx,
  type DropdownItem,
  DropdownMenu,
  Empty,
  Flexbox,
  Icon,
  SearchBar,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import dayjs from 'dayjs';
import {
  ArrowDownUpIcon,
  FolderClosedIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchXIcon,
  StarIcon,
  TrashIcon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AgentAvatar from '@/components/AgentAvatar';
import AsyncError from '@/components/AsyncError';
import { PROJECT_STATUS_VISUALS, resolveProjectStatus } from '@/components/ExecutionStatus';
import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import { useFavoriteMenuItem, useFavoriteToggle } from '@/features/Favorites';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import { createDeleteProjectModal } from '@/features/Projects/DeleteProjectModal';
import ProjectDisabled from '@/features/Projects/ProjectDisabled';
import { openRenameProjectModal } from '@/features/Projects/RenameProjectModal';
import { useCanManageProject } from '@/features/Projects/useCanManageProject';
import TopicCreatorAvatar from '@/features/TopicCreatorAvatar';
import UserAvatar from '@/features/User/UserAvatar';
import WideScreenContainer from '@/features/WideScreenContainer';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useGlobalStore } from '@/store/global';
import type { ProjectListSortBy } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useLoadedProjectList, useProjectStore } from '@/store/project';
import type { ProjectListItem } from '@/store/project/store';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { projectFavoriteTarget } from '../projectFavorite';
import { resolveProjectListState } from '../projectListState';
import SortableProjectRows from './SortableProjectRows';
import { sortProjects } from './sortProjects';

const SORT_BYS: ProjectListSortBy[] = ['manual', 'createdAt', 'updatedAt'];

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    flex: none;
    opacity: 0;
    transition: opacity ${cssVar.motionDurationFast};

    @media (hover: none) {
      opacity: 1;
    }
  `,
  identifier: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  link: css`
    display: flex;
    flex: 1;
    gap: 8px;
    align-items: center;

    min-width: 0;

    color: inherit;
  `,
  favorited: css`
    opacity: 1;
  `,
  owner: css`
    display: flex;
    flex: none;
    width: 20px;
  `,
  row: css`
    padding-block: 7px;
    padding-inline: 4px 12px;
    border-radius: ${cssVar.borderRadiusLG};
    color: inherit;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:hover .project-row-actions,
    &:focus-within .project-row-actions {
      opacity: 1;
    }
  `,
  updatedAt: css`
    flex: none;

    min-width: 88px;

    color: ${cssVar.colorTextQuaternary};
    text-align: end;
    white-space: nowrap;
  `,
}));

const ProjectOwnerAvatar = memo<{ userId: string }>(({ userId }) => {
  const activeWorkspaceId = useActiveWorkspaceId();

  return (
    <span className={styles.owner}>
      {activeWorkspaceId ? (
        <TopicCreatorAvatar size={20} userId={userId} />
      ) : (
        <UserAvatar size={20} />
      )}
    </span>
  );
});

ProjectOwnerAvatar.displayName = 'ProjectOwnerAvatar';

const ProjectCoordinatorAvatar = memo<{ project: ProjectListItem }>(({ project }) => {
  const { coordinatorAgent } = project;
  const label = coordinatorAgent ? agentDisplayName(coordinatorAgent) : undefined;

  return (
    <span className={styles.owner}>
      {coordinatorAgent && label ? (
        <Tooltip title={label}>
          <span style={{ display: 'inline-flex' }}>
            <AgentAvatar
              agentId={project.coordinatorAgentId}
              avatar={coordinatorAgent.avatar}
              background={coordinatorAgent.backgroundColor || cssVar.colorBgContainer}
              name={label}
              shape={'circle'}
              size={20}
              variant={'outlined'}
            />
          </span>
        </Tooltip>
      ) : (
        // Rows without joined meta (a cleared main agent, which resolves to LobeAI,
        // or a row inserted from a create response before the list refreshes).
        <AssigneeAvatar tooltip agentId={project.coordinatorAgentId} size={20} />
      )}
    </span>
  );
});

ProjectCoordinatorAvatar.displayName = 'ProjectCoordinatorAvatar';

/**
 * Row star. Unlike `FavoriteButton` it does not take the favorite hotkey: the
 * hotkey toggles the open page, not one row in a list.
 */
const ProjectFavoriteStar = memo<{ project: ProjectListItem }>(({ project }) => {
  const { t } = useTranslation('common');
  const { isFavorite, isReady, toggle } = useFavoriteToggle(projectFavoriteTarget(project));
  const label = t(isFavorite ? 'favorite.remove' : 'favorite.add');

  return (
    // A favorited star stays visible so the row shows it is pinned. It sits
    // inside the row link, so its click must not open the project.
    <span
      data-row-action
      className={cx(styles.actions, 'project-row-actions', isFavorite && styles.favorited)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <ActionIcon
        aria-label={label}
        aria-pressed={isFavorite}
        color={isFavorite ? cssVar.colorWarning : undefined}
        disabled={!isReady}
        fill={isFavorite ? cssVar.colorWarning : 'none'}
        icon={StarIcon}
        size={'small'}
        title={label}
        onClick={() => void toggle()}
      />
    </span>
  );
});

ProjectFavoriteStar.displayName = 'ProjectFavoriteStar';

const ProjectRow = memo<{ project: ProjectListItem }>(({ project }) => {
  const { t } = useTranslation(['project', 'common']);
  const [deleting, setDeleting] = useState(false);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const canManage = useCanManageProject();
  const favoriteMenuItem = useFavoriteMenuItem(projectFavoriteTarget(project), {
    showHotkey: false,
  });
  const status = resolveProjectStatus(project.status);
  const statusVisual = PROJECT_STATUS_VISUALS[status];

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteProject(project.id);
    } catch (error) {
      // On success the row unmounts, so only a failure re-enables it.
      setDeleting(false);
      throw error;
    }
    toast.success(t('list.deleteSuccess', { name: project.name }));
  };

  const menuItems: DropdownItem[] = [
    ...(favoriteMenuItem ? [favoriteMenuItem] : []),
    ...(canManage
      ? ([
          { type: 'divider' },
          {
            icon: <Icon icon={PencilIcon} />,
            key: 'rename',
            label: t('rename.action'),
            onClick: () => openRenameProjectModal(project),
          },
          {
            danger: true,
            icon: <Icon icon={TrashIcon} />,
            key: 'delete',
            label: t('list.deleteAction'),
            onClick: () => {
              createDeleteProjectModal({
                onConfirm: handleDelete,
                project: { id: project.id, name: project.name },
              });
            },
          },
        ] satisfies DropdownItem[])
      : []),
  ];

  const row = (
    <Flexbox horizontal align={'center'} className={styles.row} gap={8}>
      <WorkspaceLink className={styles.link} to={`/project/${project.slug ?? project.id}`}>
        <Tooltip title={t(`acceptance.status.${status}`)}>
          <Icon color={statusVisual.color} icon={statusVisual.icon} size={16} />
        </Tooltip>
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {project.name}
          </Text>
          <Text className={styles.identifier} fontSize={12}>
            {project.identifier}
          </Text>
          <ProjectFavoriteStar project={project} />
        </Flexbox>
        <Flexbox horizontal align={'center'} flex={'none'} gap={4}>
          <ProjectOwnerAvatar userId={project.userId} />
          <ProjectCoordinatorAvatar project={project} />
        </Flexbox>
        <Text
          className={styles.updatedAt}
          fontSize={12}
          title={dayjs(project.updatedAt).format('YYYY-MM-DD HH:mm')}
        >
          {dayjs(project.updatedAt).fromNow()}
        </Text>
      </WorkspaceLink>
      <span data-row-action className={cx(styles.actions, 'project-row-actions')}>
        <DropdownMenu items={menuItems} placement={'bottomRight'}>
          <ActionIcon
            icon={MoreHorizontalIcon}
            loading={deleting}
            size={'small'}
            title={t('list.moreActions')}
          />
        </DropdownMenu>
      </span>
    </Flexbox>
  );

  return <ContextMenuTrigger items={menuItems}>{row}</ContextMenuTrigger>;
});

ProjectRow.displayName = 'ProjectRow';

const ProjectListPage = memo(() => {
  const { t } = useTranslation('project');
  const [keyword, setKeyword] = useState('');
  const enabled = useUserStore(labPreferSelectors.enableProjects);
  const projects = useLoadedProjectList();
  const { error, isHydrated, isValidating, revalidate } = useProjectStore(
    (s) => s.useFetchProjectList,
  )(enabled);
  const listState = resolveProjectListState({ error, isHydrated, isValidating, projects });
  const sortBy = useGlobalStore(systemStatusSelectors.projectListSortBy);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  // The custom order is shared by the workspace, so only editors may change it.
  const canManage = useCanManageProject();
  const normalizedKeyword = keyword.trim().toLocaleLowerCase();

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    const sorted = sortProjects(projects, sortBy);
    return normalizedKeyword
      ? sorted.filter((project) =>
          [project.name, project.identifier, project.description]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(normalizedKeyword)),
        )
      : sorted;
  }, [normalizedKeyword, projects, sortBy]);

  const sortMenuItems = SORT_BYS.map((by) => ({
    checked: sortBy === by,
    key: by,
    label: t(`sidebar.sort.${by}`),
    onCheckedChange: () => updateSystemStatus({ projectListSortBy: by }),
    type: 'checkbox' as const,
  }));

  // A drop inside search results would reorder only the matches, so dragging
  // waits for the full list.
  const draggable = sortBy === 'manual' && canManage && !normalizedKeyword;

  if (!enabled) return <ProjectDisabled />;

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={
          <Text style={{ paddingInlineStart: 4 }} weight={500}>
            {t('list.title')}
          </Text>
        }
      />
      <WideScreenContainer
        fullWidth
        gap={16}
        paddingBlock={16}
        paddingInline={16}
        wrapperStyle={{ flex: 1, overflowY: 'auto' }}
      >
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <SearchBar
            allowClear
            placeholder={t('list.searchPlaceholder')}
            // Natural width as before on wide screens; only shrinks when the row is tight.
            style={{ flex: '0 1 auto', maxWidth: 280, minWidth: 0 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
            <DropdownMenu items={sortMenuItems} placement={'bottomRight'}>
              <Button icon={ArrowDownUpIcon} title={t('sidebar.sort.title')}>
                {t(`sidebar.sort.${sortBy}`)}
              </Button>
            </DropdownMenu>
            <Button icon={PlusIcon} onClick={() => openCreateProjectModal()}>
              {t('create.action')}
            </Button>
          </Flexbox>
        </Flexbox>
        {listState === 'error' ? (
          <AsyncError error={error} onRetry={() => revalidate()} />
        ) : listState === 'loading' ? (
          <SkeletonList rows={8} />
        ) : filteredProjects.length === 0 ? (
          <Center flex={1} padding={48}>
            <Empty
              description={keyword.trim() ? t('list.searchEmpty') : t('list.emptyDescription')}
              icon={keyword.trim() ? SearchXIcon : FolderClosedIcon}
            />
          </Center>
        ) : (
          <Flexbox gap={4}>
            {draggable ? (
              <SortableProjectRows
                projects={filteredProjects}
                renderRow={(project) => <ProjectRow project={project} />}
              />
            ) : (
              filteredProjects.map((project) => <ProjectRow key={project.id} project={project} />)
            )}
          </Flexbox>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
});

ProjectListPage.displayName = 'ProjectListPage';

export default ProjectListPage;
