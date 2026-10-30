'use client';

import { agentDisplayName } from '@lobechat/types';
import { Center, ContextMenuTrigger, Empty, Flexbox, Icon, SearchBar, Tooltip } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  Text,
  toast,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import {
  FolderClosedIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchXIcon,
  TrashIcon,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AgentAvatar from '@/components/AgentAvatar';
import AsyncError from '@/components/AsyncError';
import { PROJECT_STATUS_VISUALS, resolveProjectStatus } from '@/components/ExecutionStatus';
import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import ProjectDisabled from '@/features/Projects/ProjectDisabled';
import { useCanManageProject } from '@/features/Projects/useCanManageProject';
import TopicCreatorAvatar from '@/features/TopicCreatorAvatar';
import UserAvatar from '@/features/User/UserAvatar';
import WideScreenContainer from '@/features/WideScreenContainer';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useLoadedProjectList, useProjectStore } from '@/store/project';
import type { ProjectListItem } from '@/store/project/store';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { resolveProjectListState } from '../projectListState';

const styles = stylex.create({
  actions: {
    flex: 'none',
    opacity: {
      'default': 0,
      '@media (hover: none)': 1,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
    },
    transition: `opacity ${cssVar.motionDurationFast}`,
  },
  identifier: { flex: 'none', color: cssVar.colorTextTertiary },
  link: {
    display: 'flex',
    flex: '1',
    gap: '8px',
    alignItems: 'center',
    minWidth: '0',
    color: 'inherit',
  },
  owner: { display: 'flex', flex: 'none', width: '20px' },
  row: {
    paddingBlockStart: '7px',
    paddingBlockEnd: '7px',
    paddingInlineStart: '4px',
    paddingInlineEnd: '12px',
    borderRadius: cssVar.borderRadiusLG,
    color: 'inherit',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  updatedAt: {
    flex: 'none',
    minWidth: '88px',
    color: cssVar.colorTextQuaternary,
    textAlign: 'end',
    whiteSpace: 'nowrap',
  },
});

const ProjectOwnerAvatar = memo<{ userId: string }>(({ userId }) => {
  const activeWorkspaceId = useActiveWorkspaceId();

  return (
    <span {...stylex.props(styles.owner)}>
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
    <span className={stylex.props(styles.owner).className}>
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

const ProjectRow = memo<{ project: ProjectListItem }>(({ project }) => {
  const { t } = useTranslation(['project', 'common']);
  const [deleting, setDeleting] = useState(false);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const canDelete = useCanManageProject();
  const status = resolveProjectStatus(project.status);
  const statusVisual = PROJECT_STATUS_VISUALS[status];

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteProject(project.id);
      toast.success(t('list.deleteSuccess', { name: project.name }));
    } catch (error) {
      console.error('Failed to delete project', error);
      toast.error(t('list.deleteError'));
      setDeleting(false);
    }
  };

  const menuItems: DropdownItem[] = [
    {
      danger: true,
      icon: <Icon icon={TrashIcon} />,
      key: 'delete',
      label: t('list.deleteAction'),
      onClick: () => {
        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: t('list.deleteConfirmDescription', { name: project.name }),
          okButtonProps: { danger: true },
          okText: t('delete', { ns: 'common' }),
          onOk: () => void handleDelete(),
          title: t('list.deleteConfirmTitle'),
        });
      },
    },
  ];

  const row = (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.row, stylex.defaultMarker()).className}
      gap={8}
    >
      <WorkspaceLink
        className={stylex.props(styles.link).className}
        to={`/project/${project.slug ?? project.id}`}
      >
        <Tooltip title={t(`acceptance.status.${status}`)}>
          <Icon color={statusVisual.color} icon={statusVisual.icon} size={16} />
        </Tooltip>
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {project.name}
          </Text>
          <Text className={stylex.props(styles.identifier).className} fontSize={12}>
            {project.identifier}
          </Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} flex={'none'} gap={4}>
          <ProjectOwnerAvatar userId={project.userId} />
          <ProjectCoordinatorAvatar project={project} />
        </Flexbox>

        <Text
          className={stylex.props(styles.updatedAt).className}
          fontSize={12}
          title={dayjs(project.updatedAt).format('YYYY-MM-DD HH:mm')}
        >
          {dayjs(project.updatedAt).fromNow()}
        </Text>
      </WorkspaceLink>
      {canDelete && (
        <span {...stylex.props(styles.actions)}>
          <DropdownMenu items={menuItems} placement={'bottomRight'}>
            <ActionIcon
              icon={MoreHorizontalIcon}
              loading={deleting}
              size={'small'}
              title={t('list.moreActions')}
            />
          </DropdownMenu>
        </span>
      )}
    </Flexbox>
  );

  return canDelete ? <ContextMenuTrigger items={menuItems}>{row}</ContextMenuTrigger> : row;
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

  const filteredProjects = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    if (!projects) return [];
    return normalizedKeyword
      ? projects.filter((project) =>
          [project.name, project.identifier, project.description]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(normalizedKeyword)),
        )
      : projects;
  }, [keyword, projects]);

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
      <WideScreenContainer gap={16} paddingBlock={16} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <SearchBar
            allowClear
            placeholder={t('list.searchPlaceholder')}
            // Natural width as before on wide screens; only shrinks when the row is tight.
            style={{ flex: '0 1 auto', maxWidth: 280, minWidth: 0 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Button icon={PlusIcon} style={{ flex: 'none' }} onClick={() => openCreateProjectModal()}>
            {t('create.action')}
          </Button>
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
            {filteredProjects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </Flexbox>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
});

ProjectListPage.displayName = 'ProjectListPage';

export default ProjectListPage;
