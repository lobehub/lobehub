'use client';

import type { SidebarAgentItem } from '@lobechat/types';
import { Accordion, AccordionItem, Flexbox, Text } from '@lobehub/ui';
import {
  BadgeCheckIcon,
  BookOpenIcon,
  ListTodoIcon,
  MessageSquareIcon,
  PlusIcon,
  TargetIcon,
} from 'lucide-react';
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
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';

import {
  getProjectAcceptancePath,
  getProjectConversationPath,
  getProjectGoalsPath,
  getProjectLibraryPath,
  getProjectTasksPath,
} from './navigation';
import ProjectHeader from './ProjectHeader';

const ProjectSidebarContent = memo(() => {
  const { t } = useTranslation('project');
  const { id, projectId } = useActiveRouteParams<{ id?: string; projectId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { pathname } = useLocation();
  const detail = useCurrentProjectDetail(projectId);
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const projectLibraries = detail?.knowledgeBases ?? [];
  const coordinatorAgentId = detail?.project.coordinatorAgentId;
  const useFetchTopics = useChatStore((s) => s.useFetchTopics);
  const conversations = useChatStore((s) =>
    coordinatorAgentId ? topicSelectors.getTopicsByAgentId(coordinatorAgentId)(s) : undefined,
  );
  const conversationSWR = useFetchTopics(!!coordinatorAgentId, {
    agentId: coordinatorAgentId,
    excludeTriggers: ['cron', 'eval'],
    pageSize: 10,
  });
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
            icon={BadgeCheckIcon}
            title={t('sections.acceptance')}
            onClick={() => navigate(projectAcceptancePath)}
          />
          <Accordion defaultExpandedKeys={['conversations', 'agents', 'libraries']} gap={4}>
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
              itemKey="conversations"
              paddingInline="8px 4px"
              title={
                <Text ellipsis fontSize={12} type="secondary" weight={500}>
                  {t('sections.conversations')}
                </Text>
              }
            >
              {coordinatorAgentId && (
                <NavItem
                  active={pathname === getProjectConversationPath(projectId!)}
                  icon={PlusIcon}
                  title={t('sidebar.newConversation')}
                  onClick={() => navigate(getProjectConversationPath(projectId!))}
                />
              )}
              {conversationSWR.error ? (
                <AsyncError
                  error={conversationSWR.error}
                  variant="inline"
                  onRetry={() => void conversationSWR.mutate()}
                />
              ) : conversationSWR.isLoading && !conversations ? (
                <SkeletonList rows={3} />
              ) : conversations?.length ? (
                conversations.map((conversation) => (
                  <NavItem
                    active={pathname === getProjectConversationPath(projectId!, conversation.id)}
                    icon={MessageSquareIcon}
                    key={conversation.id}
                    title={conversation.title || t('sidebar.untitledConversation')}
                    onClick={() =>
                      navigate(getProjectConversationPath(projectId!, conversation.id))
                    }
                  />
                ))
              ) : (
                <Text fontSize={12} style={{ padding: 8 }} type="secondary">
                  {t('sidebar.conversationsEmpty')}
                </Text>
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
