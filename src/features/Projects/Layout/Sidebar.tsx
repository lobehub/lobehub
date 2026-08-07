'use client';

import { Accordion, AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { BookOpenIcon, FolderKanbanIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProjectStore } from '@/store/project';

const ProjectSidebarContent = memo(() => {
  const { t } = useTranslation('project');
  const { id, projectId } = useParams<{ id?: string; projectId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const detail = useProjectStore((s) => (projectId ? s.projectDetails[projectId] : undefined));
  const detailSWR = useProjectStore((s) => s.useFetchProjectDetail)(projectId);
  const projectLibraries = detail?.knowledgeBases ?? [];

  const header = (
    <SideBarHeaderLayout
      breadcrumb={[
        {
          href: `/project/${projectId}`,
          title: detail?.project.name || t('sidebar.title'),
        },
      ]}
    />
  );

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
            active={!id}
            icon={FolderKanbanIcon}
            title={t('overview.title')}
            onClick={() => navigate(`/project/${projectId}`)}
          />
          <Accordion defaultExpandedKeys={['libraries']} gap={4}>
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
                    onClick={() => navigate(`/project/${projectId}/library/${knowledgeBase.id}`)}
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
    <ProjectSidebarContent />
  </NavPanelPortal>
));

ProjectSidebar.displayName = 'ProjectSidebar';

export default ProjectSidebar;
