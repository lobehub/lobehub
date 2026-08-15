'use client';

import { Center, Empty, Flexbox, Icon, SearchBar, Text, Tooltip } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { PlusIcon, SearchXIcon, SquareKanbanIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AsyncError from '@/components/AsyncError';
import { PROJECT_STATUS_VISUALS, resolveProjectStatus } from '@/components/ExecutionStatus';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import ProjectDisabled from '@/features/Projects/ProjectDisabled';
import TopicCreatorAvatar from '@/features/TopicCreatorAvatar';
import UserAvatar from '@/features/User/UserAvatar';
import WideScreenContainer from '@/features/WideScreenContainer';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useCurrentProjectList, useProjectStore } from '@/store/project';
import type { ProjectListItem } from '@/store/project/store';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  identifier: css`
    flex: none;
    min-width: 72px;
    color: ${cssVar.colorTextTertiary};
  `,
  owner: css`
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

const ProjectRow = memo<{ project: ProjectListItem }>(({ project }) => {
  const { t } = useTranslation('project');
  const status = resolveProjectStatus(project.status);
  const statusVisual = PROJECT_STATUS_VISUALS[status];

  return (
    <WorkspaceLink to={`/project/${project.id}`}>
      <Flexbox horizontal align={'center'} className={styles.row} gap={8}>
        <Tooltip title={t(`acceptance.status.${status}`)}>
          <Icon color={statusVisual.color} icon={statusVisual.icon} size={16} />
        </Tooltip>
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Text ellipsis weight={500}>
            {project.name}
          </Text>
        </Flexbox>
        <Text className={styles.identifier} fontSize={12}>
          {project.identifier}
        </Text>
        <ProjectOwnerAvatar userId={project.userId} />
        <Text
          className={styles.updatedAt}
          fontSize={12}
          title={dayjs(project.updatedAt).format('YYYY-MM-DD HH:mm')}
        >
          {dayjs(project.updatedAt).fromNow()}
        </Text>
      </Flexbox>
    </WorkspaceLink>
  );
});

ProjectRow.displayName = 'ProjectRow';

const ProjectListPage = memo(() => {
  const { t } = useTranslation('project');
  const [keyword, setKeyword] = useState('');
  const enabled = useUserStore(labPreferSelectors.enableProjects);
  const projects = useCurrentProjectList();
  const { error, isLoading, mutate } = useProjectStore((s) => s.useFetchProjectList)(enabled);

  const filteredProjects = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
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
            style={{ maxWidth: 280 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Button icon={PlusIcon} onClick={openCreateProjectModal}>
            {t('create.action')}
          </Button>
        </Flexbox>
        {error ? (
          <AsyncError error={error} onRetry={() => mutate()} />
        ) : isLoading && projects.length === 0 ? (
          <SkeletonList rows={8} />
        ) : filteredProjects.length === 0 ? (
          <Center flex={1} padding={48}>
            <Empty
              description={keyword.trim() ? t('list.searchEmpty') : t('list.emptyDescription')}
              icon={keyword.trim() ? SearchXIcon : SquareKanbanIcon}
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
