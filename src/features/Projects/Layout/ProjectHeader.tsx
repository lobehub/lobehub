'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { SettingsIcon } from 'lucide-react';
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
  const { error, isHydrated, isValidating, revalidate } = useProjectStore(
    (s) => s.useFetchProjectList,
  )(true);
  // Rows come from the store; the hook only reports fetch progress.
  const isLoading = !isHydrated || isValidating;

  const items = useMemo<SwitcherItem[]>(
    () =>
      projects.map((item) => ({
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
              error={items.length === 0 ? error : undefined}
              isLoading={isLoading && items.length === 0}
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
      right={
        <ActionIcon
          aria-label={t('settings.title')}
          icon={SettingsIcon}
          size="small"
          title={t('settings.title')}
          onClick={() => navigate(`/project/${project?.slug ?? project?.id}/settings`)}
        />
      }
    />
  );
});

ProjectHeader.displayName = 'ProjectHeader';

export default ProjectHeader;
