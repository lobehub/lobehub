'use client';

import { Flexbox } from '@lobehub/ui';
import { ClipboardCheckIcon, ListTodoIcon, TargetIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import NavItem from '@/features/NavPanel/components/NavItem';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useParams } from '@/libs/router/navigation';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';
import { routerSelectors, useRouterStore } from '@/store/router';

import { getProjectAcceptancePath, getProjectGoalsPath, getProjectTasksPath } from './navigation';
import ProjectHeader from './ProjectHeader';

const ProjectSidebarContent = memo(() => {
  const { t } = useTranslation('project');
  const { projectId } = useParams<{ projectId: string }>('projectId');
  const navigate = useWorkspaceAwareNavigate();
  const pathname = useRouterStore(routerSelectors.pathname);
  const detail = useCurrentProjectDetail(projectId);
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const projectTasksPath = getProjectTasksPath(projectId!);
  const projectGoalsPath = getProjectGoalsPath(projectId!);
  const projectAcceptancePath = getProjectAcceptancePath(projectId!);

  const header = <ProjectHeader project={detail?.project} />;

  if (detailSWR.error)
    return (
      <SideBarLayout
        body={<AsyncError error={detailSWR.error} variant="inline" onRetry={detailSWR.mutate} />}
        header={header}
      />
    );

  return (
    <SideBarLayout
      header={header}
      body={
        <Flexbox gap={8} paddingInline={4}>
          <NavItem
            active={pathname === projectTasksPath}
            icon={ListTodoIcon}
            title={t('sections.tasks')}
            onClick={() => navigate(projectTasksPath)}
          />
          <NavItem
            active={pathname === projectGoalsPath}
            icon={TargetIcon}
            title={t('sections.goals')}
            onClick={() => navigate(projectGoalsPath)}
          />
          <NavItem
            active={pathname === projectAcceptancePath}
            icon={ClipboardCheckIcon}
            title={t('sections.acceptance')}
            onClick={() => navigate(projectAcceptancePath)}
          />
        </Flexbox>
      }
    />
  );
});

const ProjectSidebar = memo(() => (
  <NavPanelPortal navKey="project">
    <ProjectSidebarContent />
  </NavPanelPortal>
));

ProjectSidebar.displayName = 'ProjectSidebar';

export default ProjectSidebar;
