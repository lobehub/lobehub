'use client';

import type { SidebarAgentItem } from '@lobechat/types';
import { Accordion, AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { BookOpenIcon, LayoutDashboardIcon, ListTodoIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import AsyncError from '@/components/AsyncError';
import AgentItem from '@/features/HomeSidebar/Body/Agent/List/AgentItem';
import { AgentModalProvider } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useProjectStore } from '@/store/project';

import { getProjectLibraryPath, getProjectTasksPath } from './navigation';
import ProjectHeader from './ProjectHeader';

const ProjectSidebarContent = memo(() => {
  const { t } = useTranslation('project');
  const { id, projectId } = useActiveRouteParams<{ id?: string; projectId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { pathname } = useLocation();
  const detail = useProjectStore((s) => (projectId ? s.projectDetails[projectId] : undefined));
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const projectLibraries = detail?.knowledgeBases ?? [];
  const projectAgentItems = useMemo(
    () =>
      (detail?.agents ?? []).map(({ agent, binding }) => ({
        binding,
        item: {
          avatar: agent.avatar,
          backgroundColor: agent.backgroundColor,
          description: agent.description,
          id: agent.id,
          name: agent.name,
          pinned: agent.pinned ?? false,
          slug: agent.slug,
          title: agent.title,
          type: 'agent',
          updatedAt: agent.updatedAt,
          userId: agent.userId,
          visibility: agent.visibility,
        } satisfies SidebarAgentItem,
      })),
    [detail?.agents],
  );
  const projectRootPath = `/project/${projectId}`;
  const projectTasksPath = getProjectTasksPath(projectId!);

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
            active={pathname === projectRootPath}
            icon={LayoutDashboardIcon}
            title={t('overview.title')}
            onClick={() => navigate(`/project/${projectId}`)}
          />
          <NavItem
            active={pathname === projectTasksPath}
            icon={ListTodoIcon}
            title={t('sections.tasks')}
            onClick={() => navigate(projectTasksPath)}
          />
          <Accordion defaultExpandedKeys={['agents', 'libraries']} gap={4}>
            <AccordionItem
              itemKey="agents"
              paddingInline="8px 4px"
              title={
                <Text ellipsis fontSize={12} type="secondary" weight={500}>
                  {t('sections.agents')}
                </Text>
              }
            >
              {detailSWR.isLoading ? (
                <SkeletonList rows={3} />
              ) : projectAgentItems.length === 0 ? (
                <Text fontSize={12} style={{ padding: 8 }} type="secondary">
                  {t('sidebar.agentsEmpty')}
                </Text>
              ) : (
                projectAgentItems.map(({ item, binding }) => (
                  <AgentItem item={item} key={item.id} secondaryLabel={binding.role} />
                ))
              )}
            </AccordionItem>
            <AccordionItem
              itemKey="libraries"
              paddingInline="8px 4px"
              title={
                <Text ellipsis fontSize={12} type="secondary" weight={500}>
                  {t('sections.knowledgeBases')}
                </Text>
              }
            >
              {detailSWR.isLoading ? (
                <SkeletonList rows={3} />
              ) : projectLibraries.length === 0 ? (
                <Text fontSize={12} style={{ padding: 8 }} type="secondary">
                  {t('sidebar.librariesEmpty')}
                </Text>
              ) : (
                projectLibraries.map(({ knowledgeBase }) => (
                  <NavItem
                    active={id === knowledgeBase.id}
                    icon={BookOpenIcon}
                    key={knowledgeBase.id}
                    title={knowledgeBase.name}
                    onClick={() => navigate(getProjectLibraryPath(projectId!, knowledgeBase.id))}
                  />
                ))
              )}
            </AccordionItem>
          </Accordion>
        </Flexbox>
      }
    />
  );
});

const ProjectSidebar = memo(() => (
  <NavPanelPortal navKey="project">
    <AgentModalProvider>
      <ProjectSidebarContent />
    </AgentModalProvider>
  </NavPanelPortal>
));

ProjectSidebar.displayName = 'ProjectSidebar';

export default ProjectSidebar;
