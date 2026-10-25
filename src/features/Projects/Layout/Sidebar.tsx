'use client';

import { Flexbox } from '@lobehub/ui';
import {
  ClipboardCheckIcon,
  HouseIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  SettingsIcon,
  TargetIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { useDashboardFeature } from '@/features/Dashboard/hooks/useDashboardFeature';
import NavItem from '@/features/NavPanel/components/NavItem';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

import { ProjectDirectoryTopics } from '../WorkingDirectories/SidebarTopics';
import {
  getProjectAcceptancePath,
  getProjectDashboardPath,
  getProjectGoalsPath,
  getProjectHomePath,
  getProjectTasksPath,
  isProjectSectionActive,
  toProjectPathname,
} from './navigation';
import ProjectHeader from './ProjectHeader';

const ProjectSidebarContent = memo(() => {
  const { t } = useTranslation('project');
  const { projectId } = useActiveRouteParams<{ projectId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const pathname = toProjectPathname(useLocation().pathname);
  const detail = useCurrentProjectDetail(projectId);
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const { enabled: dashboardEnabled } = useDashboardFeature();
  const projectHomePath = getProjectHomePath(projectId!);
  const projectTasksPath = getProjectTasksPath(projectId!);
  const projectGoalsPath = getProjectGoalsPath(projectId!);
  const projectAcceptancePath = getProjectAcceptancePath(projectId!);
  const projectDashboardPath = getProjectDashboardPath(projectId!);

  const header = <ProjectHeader project={detail?.project} />;

  if (detailSWR.error && !detail)
    return (
      <SideBarLayout
        header={header}
        body={
          <AsyncError error={detailSWR.error} variant="inline" onRetry={detailSWR.revalidate} />
        }
      />
    );

  return (
    <SideBarLayout
      header={header}
      body={
        <Flexbox gap={1} paddingInline={4}>
          <NavItem
            active={pathname === projectHomePath}
            icon={HouseIcon}
            title={t('sections.home')}
            onClick={() => navigate(projectHomePath)}
          />
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
          {dashboardEnabled && (
            <NavItem
              active={isProjectSectionActive(pathname, projectDashboardPath)}
              icon={LayoutDashboardIcon}
              title={t('sections.dashboard')}
              onClick={() => navigate(projectDashboardPath)}
            />
          )}
          <NavItem
            active={isProjectSectionActive(pathname, projectAcceptancePath)}
            icon={ClipboardCheckIcon}
            title={t('sections.acceptance')}
            onClick={() => navigate(projectAcceptancePath)}
          />
          <NavItem
            active={pathname.includes(`/project/${projectId}/settings`)}
            icon={SettingsIcon}
            title={t('topics.settings')}
            onClick={() => navigate(`/project/${projectId}/settings/general`)}
          />
          {detail?.project && (
            <ProjectDirectoryTopics
              coordinatorAgentId={detail.project.coordinatorAgentId}
              projectId={detail.project.id}
            />
          )}
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
