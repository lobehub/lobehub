'use client';

import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import {
  SidebarHeaderSelectPopover,
  SidebarHeaderSelectTrigger,
} from '@/features/NavPanel/SidebarHeaderSelect';
import type { SwitcherItem } from '@/features/NavPanel/switcher/switcherItems';
import SwitcherMenu from '@/features/NavPanel/switcher/SwitcherMenu';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectListItem } from '@/store/project';
import { useLoadedProjectList, useProjectStore } from '@/store/project';

import { resolveProjectListState } from '../projectListState';

interface ProjectHeaderProps {
  project?: ProjectListItem;
}

const ProjectHeader = memo<ProjectHeaderProps>(({ project }) => {
  const { t } = useTranslation(['project', 'common']);
  const navigate = useWorkspaceAwareNavigate();
  const projects = useLoadedProjectList();
  const { error, isHydrated, isValidating, revalidate } = useProjectStore(
    (s) => s.useFetchProjectList,
  )(true);
  const listState = resolveProjectListState({ error, isHydrated, isValidating, projects });

  const items = useMemo<SwitcherItem[]>(
    () =>
      (projects ?? []).map((item) => ({
        // No logo: the row's Avatar generates one from the project name.
        avatar: item.avatar || undefined,
        id: item.slug ?? item.id,
        private: item.visibility === 'private',
        title: item.name,
      })),
    [projects],
  );

  const handleSelect = useCallback(
    (projectSlug: string) => navigate(`/project/${projectSlug}`),
    [navigate],
  );

  return (
    <SideBarHeaderLayout
      backTo="/"
      left={
        <SidebarHeaderSelectPopover
          content={
            <SwitcherMenu
              activeId={project?.slug ?? project?.id}
              error={listState === 'error' ? error : undefined}
              isLoading={listState === 'loading'}
              items={items}
              kind={'project'}
              searchPlaceholder={t('navPanel.searchProject', { ns: 'common' })}
              onRetry={() => revalidate()}
              onSelect={handleSelect}
            />
          }
        >
          <SidebarHeaderSelectTrigger
            avatar={project?.avatar || undefined}
            name={project?.name || t('sidebar.title')}
            title={project?.name || t('sidebar.title')}
          />
        </SidebarHeaderSelectPopover>
      }
    />
  );
});

ProjectHeader.displayName = 'ProjectHeader';

export default ProjectHeader;
