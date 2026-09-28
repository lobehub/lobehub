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
import type { ProjectDetail } from '@/store/project';
import { useCurrentProjectList, useProjectStore } from '@/store/project';

interface ProjectHeaderProps {
  project?: ProjectDetail['project'];
}

const ProjectHeader = memo<ProjectHeaderProps>(({ project }) => {
  const { t } = useTranslation(['project', 'common']);
  const navigate = useWorkspaceAwareNavigate();
  const projects = useCurrentProjectList();
  const { error, isLoading, mutate } = useProjectStore((s) => s.useFetchProjectList)(true);

  const items = useMemo<SwitcherItem[]>(
    () =>
      projects.map((item) => ({
        avatar: item.avatar || item.name,
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
              error={error}
              isLoading={isLoading && items.length === 0}
              items={items}
              kind={'project'}
              searchPlaceholder={t('navPanel.searchProject', { ns: 'common' })}
              onRetry={() => mutate()}
              onSelect={handleSelect}
            />
          }
        >
          <SidebarHeaderSelectTrigger
            avatar={project?.avatar || project?.name || t('sidebar.title')}
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
